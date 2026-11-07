from pathlib import Path
import json
import shutil
from copy import deepcopy

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app import database
from app.database import CarrierRow, OrderLineRow, OrderRow, ProductRow, ShipmentRow, shipment_order_lines
from app.routes import shipping as shipping_routes
from app.main import app
from app.shipping_service import _quotes
import time


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    database.configure_database(f"sqlite:///{tmp_path / 'test-oms.db'}")
    with TestClient(app) as test_client:
        yield test_client


def payload(**override):
    value = {
        "order_date": "2026-11-06",
        "company_name": "Example Health",
        "customer": {"name": "Alex Example", "phone": "0400000000", "email": "alex@example.com"},
        "shipping_address": {"street": "1 Main Street", "suburb": "Ryde", "state": "NSW", "postcode": "2111", "country": "Australia"},
        "line_items": [{"sku": "AURPUR10", "quantity": 2, "tracking_group": "Shipment 1"}],
        "shipments": [{"tracking_group": "Shipment 1", "carrier": "Australia Post / StarTrack", "tracking_number": "TEST-TRACK-1"}],
    }
    value.update(override)
    return value


def test_startrack_quote_ignores_rate_capability_but_tnt_stays_blocked(client, monkeypatch):
    created = client.post("/api/orders", json=payload(
        line_items=[{"sku": "AURPUR10", "quantity": 1, "tracking_group": ""}],
        shipments=[],
    ))
    assert created.status_code == 201
    order = created.json()
    with database.SessionLocal() as session:
        startrack = session.scalar(select(CarrierRow).where(CarrierRow.code == "STARTRACK"))
        tnt = session.scalar(select(CarrierRow).where(CarrierRow.code == "TNT"))
        assert startrack is not None and startrack.rate_capability == "NOT_IMPLEMENTED"
        assert tnt is not None
        startrack_id, tnt_id = startrack.id, tnt.id

    captured = {}
    # 确认能力标记为 NOT_IMPLEMENTED 的 StarTrack 记录仍会进入共享澳邮适配器。
    monkeypatch.setattr(shipping_routes, "get_rates", lambda data: (captured.update(data=data) or [{"quote_id": "test-quote"}]))
    request = {
        "carrier_id": startrack_id,
        "order_line_ids": [order["line_items"][0]["id"]],
        "origin": {"type": "MERCHANT_LOCATION", "lines": [], "suburb": "RICHMOND", "state": "VIC", "postcode": "3121", "country": "AU"},
        "destination": {"type": "STANDARD_ADDRESS", "lines": [], "suburb": "Sydney", "state": "NSW", "postcode": "2000", "country": "AU"},
        "packages": [{"weight_kg": 0.5, "length_cm": 10, "width_cm": 10, "height_cm": 10}],
    }
    response = client.post(f"/api/shipping/orders/{order['order_id']}/quotes/preview", json=request)
    assert response.status_code == 200
    assert response.json()["rates"] == [{"quote_id": "test-quote"}]
    assert captured["data"]["carrier"] == "StarTrack"

    request["carrier_id"] = tnt_id
    response = client.post(f"/api/shipping/orders/{order['order_id']}/quotes/preview", json=request)
    assert response.status_code == 501
    assert response.json()["detail"]["code"] == "NOT_IMPLEMENTED"


def test_seed_data_persists_and_repeated_initialization_is_idempotent(client):
    assert len(client.get("/api/products").json()) == 9
    orders = client.get("/api/orders").json()
    assert {o["order_id"] for o in orders} == {"PO-20251130-00072", "PO-20251203-00046"}
    assert sorted(len(o["line_items"]) for o in orders) == [4, 5]
    assert sorted(len(o["shipments"]) for o in orders) == [1, 2]
    database.init_db()
    with database.SessionLocal() as session:
        assert len(session.scalars(select(ProductRow)).all()) == 9
        assert len(session.scalars(select(OrderRow)).all()) == 2


def test_previous_json_created_orders_are_migrated_without_duplicates(tmp_path, monkeypatch, client):
    source = Path(__file__).resolve().parents[2] / "data"
    data_dir = tmp_path / "seed-project" / "data"
    data_dir.mkdir(parents=True)
    shutil.copy(source / "products.json", data_dir / "products.json")
    shutil.copy(source / "orders.json", data_dir / "orders.json")
    dataset = json.loads((data_dir / "orders.json").read_text())
    created = deepcopy(dataset["orders"][0])
    created["order_id"] = "PO-MIGRATED-LEGACY-01"
    (data_dir / "created_orders.json").write_text(json.dumps({"currency": "AUD", "orders": [created]}))
    monkeypatch.setattr(database, "PROJECT_ROOT", tmp_path / "seed-project")
    database.configure_database(f"sqlite:///{tmp_path / 'migration.db'}")
    database.init_db()
    database.init_db()
    with database.SessionLocal() as session:
        assert session.scalar(select(OrderRow).where(OrderRow.order_no == "PO-MIGRATED-LEGACY-01")) is not None
        assert len(session.scalars(select(OrderRow)).all()) == 3


def test_order_amounts_are_seeded_from_decimal_price_snapshots(client):
    orders = {o["order_id"]: o for o in client.get("/api/orders").json()}
    assert orders["PO-20251130-00072"]["status"] == "completed"
    # 现在按含税订单行总额计算并舍入 GST，未税金额由差额得出，不再先舍入单价。
    assert orders["PO-20251130-00072"]["summary"]["subtotal_ex_gst"] == "1937.28"
    assert orders["PO-20251130-00072"]["summary"]["gst_amount"] == "193.72"
    assert orders["PO-20251130-00072"]["summary"]["shipment_fee"] == "10.99"
    assert orders["PO-20251130-00072"]["summary"]["total"] == "2141.99"
    assert orders["PO-20251203-00046"]["status"] == "in_transit"
    assert orders["PO-20251203-00046"]["summary"]["subtotal_ex_gst"] == "1504.55"
    assert orders["PO-20251203-00046"]["summary"]["total"] == "1655.00"
    track_groups = {s["tracking_group"]: set(s["related_skus"]) for s in orders["PO-20251203-00046"]["shipments"]}
    assert track_groups == {"Track 2": {"AURPUR10"}, "Track 3": {"HALGEO15", "MCMW10", "MCBO30"}}


def test_catalog_price_changes_only_affect_new_orders(client):
    with database.SessionLocal.begin() as session:
        product = session.get(ProductRow, "TBAMET10")
        product.rrp_incl_gst_cents = 12000
    historical = client.get("/api/orders/PO-20251130-00072").json()
    historical_line = next(line for line in historical["line_items"] if line["sku"] == "TBAMET10")
    assert historical_line["rrp_incl_gst"] == "99.00"
    new_payload = payload(line_items=[{"sku": "TBAMET10", "quantity": 1, "tracking_group": "Shipment 1"}])
    new_order = client.post("/api/orders", json=new_payload)
    assert new_order.status_code == 201
    assert new_order.json()["line_items"][0]["rrp_incl_gst"] == "120.00"


def test_create_order_defaults_draft_and_survives_reload(client):
    response = client.post("/api/orders", json=payload())
    assert response.status_code == 201, response.text
    order = response.json()
    assert order["status"] == "draft"
    assert order["line_items"][0]["rrp_incl_gst"] == "99.00"
    assert order["summary"]["subtotal_ex_gst"] == "180.00"
    assert order["summary"]["gst_amount"] == "18.00"
    assert order["summary"]["total"] == "198.00"
    assert client.get(f"/api/orders/{order['order_id']}").json()["order_id"] == order["order_id"]


def test_draft_line_rrp_can_be_edited_and_is_saved_as_price_snapshot(client):
    body = payload(line_items=[{"sku": "AURPUR10", "quantity": 2,
        "tracking_group": "Shipment 1", "rrp_incl_gst": "110.55"}])
    created_response = client.post("/api/orders", json=body)
    assert created_response.status_code == 201, created_response.text
    created = created_response.json()
    assert created["line_items"][0]["rrp_incl_gst"] == "110.55"
    assert created["line_items"][0]["ex_gst_unit_price"] == "100.50"
    assert created["summary"]["subtotal_ex_gst"] == "201.00"
    body["line_items"][0]["rrp_incl_gst"] = "123.45"
    updated_response = client.patch(f"/api/orders/{created['order_id']}", json=body)
    assert updated_response.status_code == 200, updated_response.text
    updated = updated_response.json()
    assert updated["line_items"][0]["rrp_incl_gst"] == "123.45"
    assert updated["line_items"][0]["ex_gst_unit_price"] == "112.23"
    # 行总价为 A$246.90；GST 舍入到 A$22.45，未税金额为差额 A$224.45。
    assert updated["summary"]["subtotal_ex_gst"] == "224.45"
    assert updated["summary"]["gst_amount"] == "22.45"
    assert updated["summary"]["total"] == "246.90"


def test_order_line_rrp_must_be_positive(client):
    bad = payload(line_items=[{"sku": "AURPUR10", "quantity": 1,
        "tracking_group": "Shipment 1", "rrp_incl_gst": "0"}])
    assert client.post("/api/orders", json=bad).status_code == 422


def test_invalid_sku_rolls_back_order_and_lines(client):
    bad = payload(line_items=[{"sku": "UNKNOWN-SKU", "quantity": 1, "tracking_group": "Shipment 1"}])
    response = client.post("/api/orders", json=bad)
    assert response.status_code == 422
    assert "UNKNOWN-SKU" in response.json()["detail"]
    assert len(client.get("/api/orders").json()) == 2


@pytest.mark.parametrize("quantity", [0, -1, 1.2, "2"])
def test_quantity_must_be_positive_integer(client, quantity):
    bad = payload(line_items=[{"sku": "AURPUR10", "quantity": quantity, "tracking_group": "Shipment 1"}])
    assert client.post("/api/orders", json=bad).status_code == 422


def test_status_machine_requires_sequential_manual_transitions(client):
    created = client.post("/api/orders", json=payload()).json()
    order_no = created["order_id"]
    assert client.patch(f"/api/orders/{order_no}/status", json={"status": "completed"}).status_code == 422
    assert client.patch(f"/api/orders/{order_no}/status", json={"status": "confirmed"}).status_code == 200
    assert client.patch(f"/api/orders/{order_no}/status", json={"status": "in_transit"}).status_code == 200
    assert client.patch(f"/api/orders/{order_no}/status", json={"status": "completed"}).status_code == 200


def test_confirmed_and_in_transit_orders_can_be_reverted_to_draft_but_completed_cannot(client):
    created = client.post("/api/orders", json=payload()).json()
    order_no = created["order_id"]
    assert client.patch(f"/api/orders/{order_no}/status", json={"status": "confirmed"}).status_code == 200
    reverted = client.patch(f"/api/orders/{order_no}/status", json={"status": "draft"})
    assert reverted.status_code == 200
    assert reverted.json()["status"] == "draft"
    assert client.patch(f"/api/orders/{order_no}/status", json={"status": "confirmed"}).status_code == 200
    assert client.patch(f"/api/orders/{order_no}/status", json={"status": "in_transit"}).status_code == 200
    assert client.patch(f"/api/orders/{order_no}/status", json={"status": "draft"}).json()["status"] == "draft"
    assert client.patch(f"/api/orders/{order_no}/status", json={"status": "confirmed"}).status_code == 200
    assert client.patch(f"/api/orders/{order_no}/status", json={"status": "in_transit"}).status_code == 200
    assert client.patch(f"/api/orders/{order_no}/status", json={"status": "completed"}).status_code == 200
    assert client.patch(f"/api/orders/{order_no}/status", json={"status": "draft"}).status_code == 422


def test_confirmed_order_can_save_shipment_tracking_number(client):
    created = client.post("/api/orders", json=payload(shipments=[{
        "tracking_group": "Shipment 1", "carrier": "Australia Post / StarTrack", "tracking_number": "",
    }])).json()
    order_no = created["order_id"]
    shipment_id = created["shipments"][0]["id"]
    assert client.patch(f"/api/orders/{order_no}/status", json={"status": "confirmed"}).status_code == 200
    updated = client.patch(f"/api/shipments/{shipment_id}", json={"tracking_number": "NEW-TRACK-123"})
    assert updated.status_code == 200
    assert updated.json()["status"] == "confirmed"
    assert updated.json()["shipments"][0]["tracking_number"] == "NEW-TRACK-123"
    assert client.patch(f"/api/shipments/{shipment_id}", json={"tracking_number": " "}).status_code == 422
    restricted = client.patch(f"/api/shipments/{shipment_id}", json={"tracking_number": "OTHER", "carrier": "TNT"})
    assert restricted.status_code == 422


def test_lines_can_only_be_assigned_once_and_foreign_keys_are_enabled(client):
    database.init_db()
    with database.SessionLocal() as session:
        assert session.connection().exec_driver_sql("PRAGMA foreign_keys").scalar_one() == 1
        assert "shipment_order_lines" in database.Base.metadata.tables
        assert {"shipment_id", "order_line_id"} <= set(shipment_order_lines.c.keys())


def test_shipment_endpoint_rejects_cross_order_and_duplicate_line_assignment(client):
    first = client.post("/api/orders", json=payload()).json()
    second_payload = payload(company_name="Second Company", customer={"name": "Taylor", "phone": "0400000001", "email": "taylor@example.com"}, shipments=[], line_items=[{"sku": "AURPUR10", "quantity": 2, "tracking_group": None}])
    second = client.post("/api/orders", json=second_payload).json()
    foreign_line_id = second["line_items"][0]["id"]
    cross_order = client.post(f"/api/orders/{first['order_id']}/shipments", json={
        "carrier": "TNT", "tracking_number": "TNT-2", "tracking_group": "Shipment 2", "order_line_ids": [foreign_line_id]})
    assert cross_order.status_code == 422
    own_line_id = first["line_items"][0]["id"]
    duplicate = client.post(f"/api/orders/{first['order_id']}/shipments", json={
        "carrier": "TNT", "tracking_number": "TNT-3", "tracking_group": "Shipment 2", "order_line_ids": [own_line_id]})
    assert duplicate.status_code == 422


def test_editing_a_seeded_non_draft_order_is_rejected(client):
    order = client.get("/api/orders/PO-20251130-00072").json()
    body = payload(order_date=order["order_date"], company_name=order["company_name"], customer=order["customer"],
        shipping_address={**order["shipping_address"], "address_line2": order.get("address_line2")},
        line_items=[{"sku": l["sku"], "quantity": l["quantity"], "tracking_group": l["tracking_group"]} for l in order["line_items"]],
        shipments=[{"tracking_group": s["tracking_group"], "carrier": s["carrier"], "tracking_number": s["tracking_number"]} for s in order["shipments"]])
    response = client.patch("/api/orders/PO-20251130-00072", json=body)
    assert response.status_code == 422


def test_partial_patch_updates_only_the_requested_draft_field(client):
    created = client.post("/api/orders", json=payload()).json()
    updated = client.patch(f"/api/orders/{created['order_id']}", json={"customer": {"name": "Alex Updated"}})
    assert updated.status_code == 200, updated.text
    result = updated.json()
    assert result["customer"]["name"] == "Alex Updated"
    assert result["customer"]["phone"] == "0400000000"
    assert result["line_items"][0]["sku"] == "AURPUR10"


def test_applying_same_shipping_quote_updates_fee_without_double_count(client):
    created = client.post("/api/orders", json=payload()).json()
    shipment_id = created["shipments"][0]["id"]
    quote_id = "single-use-test-quote"
    _quotes[quote_id] = (time.monotonic(), {"quote_id": quote_id, "product_id": "EL1", "total_cost": "10.50",
        "order_no": created["order_id"], "shipment_id": shipment_id, "source": "Australia Post API"})
    applied = client.post(f"/api/shipping/shipments/{shipment_id}/apply-rate", json={"quote_id": quote_id})
    assert applied.status_code == 200, applied.text
    assert applied.json()["summary"]["shipment_fee"] == "10.50"
    assert applied.json()["summary"]["total"] == "208.50"
    applied_again = client.post(f"/api/shipping/shipments/{shipment_id}/apply-rate", json={"quote_id": quote_id})
    assert applied_again.status_code == 200
    assert applied_again.json()["summary"]["shipment_fee"] == "10.50"
    assert applied_again.json()["summary"]["total"] == "208.50"
    same_inputs = payload()
    unchanged = client.patch(f"/api/orders/{created['order_id']}", json=same_inputs)
    assert unchanged.status_code == 200
    assert unchanged.json()["summary"]["shipment_fee"] == "10.50"
    current_shipment_id = unchanged.json()["shipments"][0]["id"]
    changed_inputs = payload()
    changed_inputs["shipping_address"]["suburb"] = "Chatswood"
    changed = client.patch(f"/api/orders/{created['order_id']}", json=changed_inputs)
    assert changed.status_code == 200
    assert changed.json()["summary"]["shipment_fee"] == "0.00"
    stale_apply = client.post(f"/api/shipping/shipments/{current_shipment_id}/apply-rate", json={"quote_id": quote_id})
    assert stale_apply.status_code == 422


def test_adding_unassigned_order_line_preserves_other_shipment_shipping_fee(client):
    body = payload(line_items=[
        {"sku": "AURPUR10", "quantity": 2, "tracking_group": "Shipment 1"},
        {"sku": "MCMW10", "quantity": 1, "tracking_group": "Shipment 1"},
    ])
    created = client.post("/api/orders", json=body).json()
    shipment_id = created["shipments"][0]["id"]
    quote_id = "preserve-shipment-fee-for-unassigned-line"
    _quotes[quote_id] = (time.monotonic(), {
        "quote_id": quote_id,
        "product_id": "EL1",
        "total_cost": "14.25",
        "order_no": created["order_id"],
        "shipment_id": shipment_id,
        "source": "Australia Post API",
    })
    applied = client.post(f"/api/shipping/shipments/{shipment_id}/apply-rate", json={"quote_id": quote_id})
    assert applied.status_code == 200, applied.text
    assert applied.json()["summary"]["shipment_fee"] == "14.25"

    with_unassigned_line = payload(line_items=[
        {"sku": "AURPUR10", "quantity": 2, "tracking_group": "Shipment 1"},
        {"sku": "MCMW10", "quantity": 1, "tracking_group": "Shipment 1"},
        {"sku": "HALGEO15", "quantity": 1, "tracking_group": None},
    ])
    updated = client.patch(f"/api/orders/{created['order_id']}", json=with_unassigned_line)
    assert updated.status_code == 200, updated.text
    assert updated.json()["summary"]["shipment_fee"] == "14.25"
    assert updated.json()["shipments"][0]["shipping_fee"] == "14.25"

    changed_assigned_line = payload(line_items=[
        {"sku": "AURPUR10", "quantity": 3, "tracking_group": "Shipment 1"},
        {"sku": "MCMW10", "quantity": 1, "tracking_group": "Shipment 1"},
        {"sku": "HALGEO15", "quantity": 1, "tracking_group": None},
    ])
    changed = client.patch(f"/api/orders/{created['order_id']}", json=changed_assigned_line)
    assert changed.status_code == 200, changed.text
    assert changed.json()["summary"]["shipment_fee"] == "0.00"
