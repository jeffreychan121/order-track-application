"""基于数据库的 OMS 操作，并集中维护金额计算规则。"""

from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
import json
from uuid import uuid4

from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from . import database
from .database import CarrierRow, OrderLineRow, OrderRow, ProductRow, ShipmentPackageRow, ShipmentRow
from .models import CreateOrderInput, OrderDetailResponse, OrderLineResponse, OrderSummaryResponse, ShipmentResponse

CENT = Decimal("0.01")


class BusinessError(ValueError):
    pass


def _money_cents(value: Decimal) -> int:
    return int((value * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def _line_amounts(gross_unit_cents: int, quantity: int, rate_basis_points: int) -> tuple[int, int]:
    """按整行含税金额舍入 GST，再以差额得到未税小计。"""
    gross_line_cents = gross_unit_cents * quantity
    rate_denominator = Decimal(10_000 + rate_basis_points)
    gst_cents = int(
        (Decimal(gross_line_cents * rate_basis_points) / rate_denominator)
        .quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    )
    # RRP 含税；未税金额用差额，确保含税总额 = 未税金额 + GST。
    return gross_line_cents - gst_cents, gst_cents


def money(cents: int) -> str:
    return format(Decimal(cents) / 100, ".2f")


def _recalculate(order: OrderRow) -> None:
    subtotal = sum(line.line_subtotal_ex_gst_cents for line in order.lines)
    # GST 按各订单行的含税快照、税率和行级舍入结果累计。
    gst = sum(
        line.rrp_incl_gst_cents * line.quantity - line.line_subtotal_ex_gst_cents
        for line in order.lines
    )
    shipping = sum(item.shipping_fee_cents for item in order.shipments)
    order.subtotal_ex_gst_cents = subtotal
    order.gst_cents = gst
    order.shipping_fee_cents = shipping
    order.total_cents = subtotal + gst + shipping


def _response(order: OrderRow) -> OrderDetailResponse:
    lines = []
    for line in order.lines:
        rate_denominator = Decimal(10_000 + line.gst_rate_basis_points)
        ex_unit = (Decimal(line.rrp_incl_gst_cents * 10_000) / rate_denominator / 100).quantize(CENT, rounding=ROUND_HALF_UP)
        lines.append(OrderLineResponse(
            id=line.id,
            sku=line.sku, product_name=line.product.name, description=line.product.description or "",
            quantity=line.quantity, tracking_group=(
                (line.shipments[0].tracking_group or f"Shipment {line.shipments[0].id}") if line.shipments else ""
            ),
            rrp_incl_gst=money(line.rrp_incl_gst_cents),
            gst_rate_percent=format(Decimal(line.gst_rate_basis_points) / 100, ".2f"),
            ex_gst_unit_price=format(ex_unit, ".2f"),
            line_subtotal_ex_gst=money(line.line_subtotal_ex_gst_cents), currency=order.currency,
            product_weight_g=line.product.weight_g,
        ))
    shipments = [ShipmentResponse(
        id=s.id, tracking_group=s.tracking_group or f"Shipment {s.id}", carrier=(s.carrier_record.name if s.carrier_record else s.carrier),
        carrier_id=s.carrier_id, carrier_code=(s.carrier_record.code if s.carrier_record else None),
        shipping_account_profile_id=s.shipping_account_profile_id,
        shipping_account_label=s.shipping_account_label,
        shipping_account_number_masked=s.shipping_account_number_masked,
        tracking_number=s.tracking_number or "", shipping_fee=money(s.shipping_fee_cents),
        shipping_quote_status=s.shipping_quote_status, selected_product_id=s.selected_product_id,
        related_skus=[line.sku for line in s.lines],
        order_line_ids=[line.id for line in s.lines],
        packages=[{"id": p.id, "weight_gross_g": p.gross_weight_g, "length_mm": p.length_mm,
                   "width_mm": p.width_mm, "height_mm": p.height_mm} for p in s.packages],
        origin=({"type": s.origin_type or "MERCHANT_LOCATION", "lines": json.loads(s.origin_lines_json or "[]"),
                 "suburb": s.origin_suburb, "state": s.origin_state, "postcode": s.origin_postcode, "country": s.origin_country or "AU"}
                if s.origin_suburb else None),
        destination=({"type": s.destination_type or "STANDARD_ADDRESS", "lines": json.loads(s.destination_lines_json or "[]"),
                      "suburb": s.destination_suburb, "state": s.destination_state, "postcode": s.destination_postcode, "country": s.destination_country or "AU"}
                     if s.destination_suburb else None),
    ) for s in order.shipments]
    return OrderDetailResponse(
        id=order.id, order_id=order.order_no, order_date=order.order_date, status=order.status,
        company_name=order.company, customer={"name": order.customer_name, "phone": order.phone, "email": order.email},
        shipping_address={"street": order.address_line1, "suburb": order.suburb, "state": order.state,
                          "postcode": order.postcode, "country": order.country},
        address_line2=order.address_line2, line_items=lines, shipments=shipments, currency=order.currency,
        summary=OrderSummaryResponse(currency=order.currency, subtotal_ex_gst=money(order.subtotal_ex_gst_cents),
            gst_rate=(format(Decimal(order.lines[0].gst_rate_basis_points) / 100, ".2f") + "%"
                if order.lines and len({line.gst_rate_basis_points for line in order.lines}) == 1 else "Mixed rates"),
            gst_amount=money(order.gst_cents), shipment_fee=money(order.shipping_fee_cents),
            shipment_fee_status=("quoted" if order.shipping_fee_cents else "not_quoted"), total=money(order.total_cents)),
        calculation_note="Amounts use saved order-line price and GST-rate snapshots with Decimal and half-up cent rounding.",
    )


def list_products(search: str | None = None) -> list[dict]:
    with database.SessionLocal() as session:
        stmt = select(ProductRow).order_by(ProductRow.sku)
        if search:
            term = f"%{search.strip()}%"
            stmt = stmt.where(or_(ProductRow.sku.ilike(term), ProductRow.name.ilike(term), ProductRow.description.ilike(term)))
        products = session.scalars(stmt).all()
        return [_product_dict(p) for p in products]


def _product_dict(p: ProductRow) -> dict:
    return {"sku": p.sku, "name": p.name, "description": p.description,
        "rrp_incl_gst": money(p.rrp_incl_gst_cents), "currency": "AUD",
        "weight": {"value": str(p.weight_g), "unit": "g"} if p.weight_g is not None else None,
        "dimensions": {k: {"value": str(v), "unit": "mm"} for k, v in
            (("length", p.length_mm), ("width", p.width_mm), ("height", p.height_mm)) if v is not None},
        "dosage_type": p.dosage_type, "product_type": p.product_type, "status": p.status, "image_url": p.image_url}


def get_product(sku: str) -> dict | None:
    with database.SessionLocal() as session:
        product = session.get(ProductRow, sku)
        return _product_dict(product) if product else None


def create_product(payload: dict) -> dict:
    sku = str(payload.get("sku") or "").strip().upper()
    name = str(payload.get("name") or "").strip()
    if not sku or not name:
        raise BusinessError("SKU and product name are required")
    try:
        price = _money_cents(Decimal(str(payload.get("rrp_incl_gst"))))
        if price <= 0:
            raise ValueError
        weight = payload.get("weight_g")
        dimensions = [payload.get(key) for key in ("length_mm", "width_mm", "height_mm")]
        if weight not in (None, "") and int(weight) <= 0:
            raise ValueError
        if any(value not in (None, "") and int(value) <= 0 for value in dimensions):
            raise ValueError
    except (ValueError, TypeError, ArithmeticError):
        raise BusinessError("Enter a positive RRP and positive whole-number weight/dimensions")
    with database.SessionLocal.begin() as session:
        if session.get(ProductRow, sku):
            raise FileExistsError(f"SKU {sku} already exists")
        product = ProductRow(sku=sku, name=name, description=str(payload.get("description") or "").strip(),
            rrp_incl_gst_cents=price, weight_g=int(weight) if weight not in (None, "") else None,
            length_mm=int(dimensions[0]) if dimensions[0] not in (None, "") else None,
            width_mm=int(dimensions[1]) if dimensions[1] not in (None, "") else None,
            height_mm=int(dimensions[2]) if dimensions[2] not in (None, "") else None,
            status="List")
        session.add(product)
        session.flush()
        result = _product_dict(product)
    return result


def update_product(sku: str, changes: dict) -> dict:
    """更新商品资料；SKU 是被订单行引用的主键，因此保持不可变。"""
    with database.SessionLocal.begin() as session:
        product = session.get(ProductRow, sku)
        if not product:
            raise LookupError("Product not found")

        if "name" in changes:
            name = str(changes.get("name") or "").strip()
            if not name:
                raise BusinessError("Product name is required")
            product.name = name
        if "description" in changes:
            product.description = str(changes.get("description") or "").strip()
        if "rrp_incl_gst" in changes:
            try:
                price = _money_cents(Decimal(str(changes["rrp_incl_gst"])))
                if price <= 0:
                    raise ValueError
            except (ValueError, TypeError, ArithmeticError):
                raise BusinessError("Enter a positive RRP")
            product.rrp_incl_gst_cents = price

        for field, column in (("weight_g", "weight_g"), ("length_mm", "length_mm"),
                              ("width_mm", "width_mm"), ("height_mm", "height_mm")):
            if field not in changes:
                continue
            value = changes[field]
            if value in (None, ""):
                setattr(product, column, None)
                continue
            try:
                parsed = int(value)
                if parsed <= 0 or str(parsed) != str(value).strip():
                    raise ValueError
            except (ValueError, TypeError):
                raise BusinessError("Weight and dimensions must be positive whole numbers")
            setattr(product, column, parsed)

        result = _product_dict(product)
    return result


def delete_product(sku: str) -> None:
    """仅删除未被订单行引用的商品，保护历史订单关联。"""
    try:
        with database.SessionLocal.begin() as session:
            product = session.get(ProductRow, sku)
            if not product:
                raise LookupError("Product not found")
            referenced = session.scalar(
                select(OrderLineRow.id).where(OrderLineRow.sku == sku).limit(1)
            )
            if referenced is not None:
                raise BusinessError(
                    f"Product {sku} is used by existing order lines and cannot be deleted."
                )
            session.delete(product)
    except IntegrityError as error:
        # 数据库外键是最后一道保护，覆盖并发创建订单行的情况。
        raise BusinessError(
            f"Product {sku} is used by existing order lines and cannot be deleted."
        ) from error


def list_orders(search: str | None = None, status: str | None = None, sort_by: str = "date") -> list[OrderDetailResponse]:
    with database.SessionLocal() as session:
        stmt = select(OrderRow).options(selectinload(OrderRow.lines).selectinload(OrderLineRow.product),
            selectinload(OrderRow.lines).selectinload(OrderLineRow.shipments), selectinload(OrderRow.shipments).selectinload(ShipmentRow.lines))
        if status and status.casefold() != "all":
            stmt = stmt.where(OrderRow.status == status.casefold().replace(" ", "_"))
        if search:
            term = f"%{search.strip()}%"
            stmt = stmt.where(or_(OrderRow.order_no.ilike(term), OrderRow.customer_name.ilike(term), OrderRow.company.ilike(term)))
        if sort_by == "total":
            stmt = stmt.order_by(OrderRow.total_cents.desc())
        else:
            stmt = stmt.order_by(OrderRow.order_date.desc(), OrderRow.id.desc())
        return [_response(order) for order in session.scalars(stmt).unique().all()]


def get_order(order_no: str) -> OrderDetailResponse | None:
    with database.SessionLocal() as session:
        order = session.scalar(select(OrderRow).where(OrderRow.order_no == order_no).options(
            selectinload(OrderRow.lines).selectinload(OrderLineRow.product),
            selectinload(OrderRow.lines).selectinload(OrderLineRow.shipments),
            selectinload(OrderRow.shipments).selectinload(ShipmentRow.lines)))
        return _response(order) if order else None


def _set_lines_and_shipments(
    session: Session,
    order: OrderRow,
    payload: CreateOrderInput,
    preserved_prices: dict[str, int] | None = None,
    preserved_rates: dict[str, int] | None = None,
    preserved_quotes: dict[str, dict] | None = None,
) -> None:
    if not payload.line_items:
        raise BusinessError("At least one order line is required")
    product_map = {p.sku: p for p in session.scalars(select(ProductRow).where(ProductRow.sku.in_({x.sku for x in payload.line_items}))).all()}
    missing = sorted({x.sku for x in payload.line_items} - set(product_map))
    if missing:
        raise BusinessError("Unknown SKU(s): " + ", ".join(missing))
    groups = {s.tracking_group: s for s in payload.shipments}
    if len(groups) != len(payload.shipments):
        raise BusinessError("Shipment names must be unique within an order")
    tracking_keys = [(s.carrier.casefold(), s.tracking_number.strip()) for s in payload.shipments if s.tracking_number and s.tracking_number.strip()]
    if len(tracking_keys) != len(set(tracking_keys)):
        raise BusinessError("Duplicate carrier and tracking number in this order")
    existing_shipments = {s.tracking_group or "": s for s in order.shipments}
    for shipment in existing_shipments.values():
        shipment.lines.clear()
    for line in list(order.lines):
        order.lines.remove(line)
    session.flush()
    for group, shipment in list(existing_shipments.items()):
        if group not in groups:
            order.shipments.remove(shipment)
    session.flush()
    shipment_map: dict[str, ShipmentRow] = {}
    for item in payload.shipments:
        carrier_row = _carrier_for_payload(session, item.model_dump(), allow_inactive=True)
        quote = (preserved_quotes or {}).get(item.tracking_group, {})
        row = existing_shipments.get(item.tracking_group)
        if row is None:
            row = ShipmentRow(carrier=carrier_row.name, carrier_id=carrier_row.id, tracking_number=None, tracking_group=item.tracking_group,
                shipping_quote_status="not_quoted", shipping_fee_cents=0)
            order.shipments.append(row)
        row.carrier = carrier_row.name
        row.carrier_id = carrier_row.id
        row.tracking_number = (item.tracking_number.strip() or None) if item.tracking_number else None
        row.tracking_group = item.tracking_group
        selected_profile_id = quote.get("shipping_account_profile_id") or item.shipping_account_profile_id
        same_saved_profile = selected_profile_id is not None and row.shipping_account_profile_id == selected_profile_id
        row.shipping_account_profile_id = selected_profile_id
        row.shipping_account_label = quote.get("shipping_account_label") or (row.shipping_account_label if same_saved_profile else None)
        row.shipping_account_number_masked = quote.get("shipping_account_number_masked") or (row.shipping_account_number_masked if same_saved_profile else None)
        row.shipping_quote_status = quote.get("shipping_quote_status", "not_quoted")
        row.shipping_fee_cents = quote.get("shipping_fee_cents", 0)
        row.selected_product_id = quote.get("selected_product_id")
        row.quote_source = quote.get("quote_source")
        row.quoted_at = quote.get("quoted_at")
        shipment_map[item.tracking_group] = row
    for item in payload.line_items:
        product = product_map[item.sku]
        # Draft 编辑明确提交的价格成为本订单行快照；未提交价格时保留原快照，新增行则采用商品目录 RRP。
        saved_price = (_money_cents(item.rrp_incl_gst) if item.rrp_incl_gst is not None
            else (preserved_prices or {}).get(item.sku, product.rrp_incl_gst_cents))
        rate_basis_points = (
            int(item.gst_rate_percent * 100)
            if item.gst_rate_percent is not None
            else (preserved_rates or {}).get(item.sku, 1000)
        )
        line_cents, _line_gst_cents = _line_amounts(saved_price, item.quantity, rate_basis_points)
        line = OrderLineRow(product=product, sku=product.sku, quantity=item.quantity,
            rrp_incl_gst_cents=saved_price, gst_rate_basis_points=rate_basis_points,
            line_subtotal_ex_gst_cents=line_cents)
        order.lines.append(line)
        if item.tracking_group:
            shipment = shipment_map.get(item.tracking_group)
            if not shipment:
                raise BusinessError("Each assigned order line must reference a shipment in this order")
            shipment.lines.append(line)
    _recalculate(order)


def create_order(payload: CreateOrderInput) -> OrderDetailResponse:
    if not payload.customer.name.strip() or not payload.company_name.strip():
        raise BusinessError("Customer name and company are required")
    if not payload.shipping_address.postcode.isdigit() or len(payload.shipping_address.postcode) != 4:
        raise BusinessError("Postcode must contain four digits")
    if not all(value.strip() for value in (payload.shipping_address.street, payload.shipping_address.suburb, payload.shipping_address.state)):
        raise BusinessError("Address line 1, suburb and state are required")
    with database.SessionLocal.begin() as session:
        order = OrderRow(order_no=f"PO-{payload.order_date:%Y%m%d}-{uuid4().hex[:8].upper()}",
            order_date=payload.order_date, status="draft", customer_name=payload.customer.name.strip(), company=payload.company_name.strip(),
            phone=payload.customer.phone.strip(), email=payload.customer.email.strip(), address_line1=payload.shipping_address.street.strip(),
            address_line2=payload.shipping_address.address_line2, suburb=payload.shipping_address.suburb.strip(), state=payload.shipping_address.state.strip(),
            postcode=payload.shipping_address.postcode, country=payload.shipping_address.country, currency="AUD")
        session.add(order)
        try:
            _set_lines_and_shipments(session, order, payload)
            session.flush()
            session.refresh(order)
            # 事务提交后由 get_order 重新加载关联数据，避免在当前会话中手工拼装不完整响应。
            order_no = order.order_no
        except IntegrityError as exc:
            raise BusinessError("Order could not be saved due to a data integrity conflict") from exc
    result = get_order(order_no)
    assert result is not None
    return result


def _carrier_for_payload(session: Session, payload: dict, *, allow_inactive: bool = False) -> CarrierRow:
    carrier_id = payload.get("carrier_id")
    carrier = session.get(CarrierRow, int(carrier_id)) if carrier_id else None
    if not carrier and payload.get("carrier"):
        carrier = session.scalar(select(CarrierRow).where(CarrierRow.name == str(payload["carrier"]).strip()))
    if not carrier:
        raise BusinessError("Select a carrier maintained in Carrier Management")
    if not allow_inactive and not carrier.is_active:
        raise BusinessError("This carrier is inactive and cannot be used for a new Shipment")
    return carrier


def update_draft(order_no: str, changes: dict) -> OrderDetailResponse:
    with database.SessionLocal.begin() as session:
        order = session.scalar(select(OrderRow).where(OrderRow.order_no == order_no).options(
            selectinload(OrderRow.lines).selectinload(OrderLineRow.shipments),
            selectinload(OrderRow.shipments).selectinload(ShipmentRow.lines)))
        if not order:
            raise LookupError("Order not found")
        if order.status != "draft":
            raise BusinessError("Only draft orders can be edited")
        existing_lines = [{"sku": line.sku, "quantity": line.quantity,
            "tracking_group": (line.shipments[0].tracking_group or f"Shipment {line.shipments[0].id}") if line.shipments else None}
            for line in order.lines]
        existing_shipments = [{"tracking_group": item.tracking_group or f"Shipment {item.id}",
            "carrier": item.carrier, "tracking_number": item.tracking_number} for item in order.shipments]
        merged = {
            "order_date": order.order_date,
            "company_name": order.company,
            "status": order.status,
            "customer": {"name": order.customer_name, "phone": order.phone, "email": order.email},
            "shipping_address": {"street": order.address_line1, "address_line2": order.address_line2,
                "suburb": order.suburb, "state": order.state, "postcode": order.postcode, "country": order.country},
            "line_items": existing_lines,
            "shipments": existing_shipments,
        }
        for key in ("order_date", "company_name", "line_items", "shipments", "status"):
            if key in changes:
                merged[key] = changes[key]
        for key in ("customer", "shipping_address"):
            if key in changes:
                merged[key] = {**merged[key], **changes[key]}
        try:
            changes = CreateOrderInput.model_validate(merged)
        except Exception as error:
            raise BusinessError(f"Order update validation failed: {error}") from error
        preserved_prices = {line.sku: line.rrp_incl_gst_cents for line in order.lines}
        preserved_rates = {line.sku: line.gst_rate_basis_points for line in order.lines}
        old_address = (order.address_line1, order.address_line2 or "", order.suburb, order.state, order.postcode, order.country)
        new_address = (changes.shipping_address.street.strip(), changes.shipping_address.address_line2 or "", changes.shipping_address.suburb.strip(), changes.shipping_address.state.strip(), changes.shipping_address.postcode, changes.shipping_address.country)
        old_lines_by_shipment: dict[str, list[tuple[str, int]]] = {}
        for line in order.lines:
            group = (line.shipments[0].tracking_group or f"Shipment {line.shipments[0].id}") if line.shipments else ""
            if group:
                old_lines_by_shipment.setdefault(group, []).append((line.sku, line.quantity))
        new_lines_by_shipment: dict[str, list[tuple[str, int]]] = {}
        for line in changes.line_items:
            group = line.tracking_group or ""
            if group:
                new_lines_by_shipment.setdefault(group, []).append((line.sku, line.quantity))
        old_shipments_by_group = {s.tracking_group or f"Shipment {s.id}": s for s in order.shipments}
        new_shipments_by_group = {s.tracking_group: s for s in changes.shipments}
        preserved_quotes = {}
        if old_address == new_address:
            for group, shipment in old_shipments_by_group.items():
                updated = new_shipments_by_group.get(group)
                same_shipment = updated is not None and (
                    shipment.carrier == updated.carrier
                    and (shipment.tracking_number or "").strip() == (updated.tracking_number or "").strip()
                )
                same_assigned_lines = sorted(old_lines_by_shipment.get(group, [])) == sorted(new_lines_by_shipment.get(group, []))
                if same_shipment and same_assigned_lines:
                    preserved_quotes[group] = {
                        "shipping_fee_cents": shipment.shipping_fee_cents,
                        "shipping_quote_status": shipment.shipping_quote_status,
                        "selected_product_id": shipment.selected_product_id,
                        "shipping_account_profile_id": shipment.shipping_account_profile_id,
                        "shipping_account_label": shipment.shipping_account_label,
                        "shipping_account_number_masked": shipment.shipping_account_number_masked,
                        "quote_source": shipment.quote_source,
                        "quoted_at": shipment.quoted_at,
                    }
        order.order_date = changes.order_date
        order.company = changes.company_name.strip()
        order.customer_name = changes.customer.name.strip()
        order.phone = changes.customer.phone.strip()
        order.email = changes.customer.email.strip()
        order.address_line1 = changes.shipping_address.street.strip()
        order.address_line2 = changes.shipping_address.address_line2
        order.suburb = changes.shipping_address.suburb.strip()
        order.state = changes.shipping_address.state.strip()
        order.postcode = changes.shipping_address.postcode
        order.country = changes.shipping_address.country
        if not all(value.strip() for value in (order.address_line1, order.suburb, order.state)):
            raise BusinessError("Address line 1, suburb and state are required")
        _set_lines_and_shipments(
            session,
            order,
            changes,
            preserved_prices=preserved_prices,
            preserved_rates=preserved_rates,
            preserved_quotes=preserved_quotes,
        )
        _recalculate(order)
        order_no = order.order_no
    if old_address != new_address or any(
        group not in preserved_quotes for group in old_shipments_by_group
    ):
        from .shipping_service import invalidate_order_quotes
        invalidate_order_quotes(order_no)
    result = get_order(order_no)
    assert result is not None
    return result


def transition_status(order_no: str, target: str) -> OrderDetailResponse:
    sequence = {"draft": "confirmed", "confirmed": "in_transit", "in_transit": "completed"}
    with database.SessionLocal.begin() as session:
        order = session.scalar(select(OrderRow).where(OrderRow.order_no == order_no).options(selectinload(OrderRow.shipments)))
        if not order:
            raise LookupError("Order not found")
        target = target.casefold().replace(" ", "_")
        can_revert_to_draft = target == "draft" and order.status in {"confirmed", "in_transit"}
        if sequence.get(order.status) != target and not can_revert_to_draft:
            raise BusinessError(f"Illegal status transition: {order.status} → {target}")
        if order.status == "draft" and (not order.lines or not order.customer_name or not order.address_line1):
            raise BusinessError("Order information and at least one valid line are required to confirm")
        if target == "in_transit" and not any(s.tracking_number and s.tracking_number.strip() for s in order.shipments):
            raise BusinessError("Add a carrier tracking number before marking this order In Transit")
        order.status = target
        order_no = order.order_no
    result = get_order(order_no)
    assert result is not None
    return result


def add_shipment(order_no: str, payload: dict) -> OrderDetailResponse:
    with database.SessionLocal.begin() as session:
        order = session.scalar(select(OrderRow).where(OrderRow.order_no == order_no).options(selectinload(OrderRow.shipments), selectinload(OrderRow.lines).selectinload(OrderLineRow.shipments)))
        if not order:
            raise LookupError("Order not found")
        if order.status != "draft":
            raise BusinessError("Shipments can only be added while an order is draft")
        carrier_row = _carrier_for_payload(session, payload)
        carrier = carrier_row.name
        tracking = str(payload.get("tracking_number") or "").strip() or None
        if tracking and any(s.carrier.casefold() == carrier.casefold() and (s.tracking_number or "").strip() == tracking for s in order.shipments):
            raise BusinessError("Duplicate carrier and tracking number in this order")
        new_shipment = ShipmentRow(carrier=carrier, carrier_id=carrier_row.id, tracking_number=tracking,
            tracking_group=str(payload.get("tracking_group") or f"Shipment {len(order.shipments)+1}"), shipping_quote_status="not_quoted", shipping_fee_cents=0)
        order.shipments.append(new_shipment)
        requested_line_ids = set(payload.get("order_line_ids", []))
        lines_by_id = {line.id: line for line in order.lines}
        if requested_line_ids - set(lines_by_id):
            raise BusinessError("Shipment cannot reference order lines from a different order")
        for line_id in requested_line_ids:
            line = lines_by_id[line_id]
            if line.shipments:
                raise BusinessError(f"Order line {line.sku} is already assigned to another shipment")
            new_shipment.lines.append(line)
        _recalculate(order)
        order_no = order.order_no
    result = get_order(order_no)
    assert result is not None
    return result


def delete_shipment(shipment_id: int) -> None:
    with database.SessionLocal.begin() as session:
        shipment = session.get(ShipmentRow, shipment_id)
        if not shipment:
            raise LookupError("Shipment not found")
        if shipment.order.status != "draft":
            raise BusinessError("Shipments can only be removed while the order is draft")
        order = shipment.order
        for line in list(shipment.lines):
            line.shipments.remove(shipment)
        session.delete(shipment)
        _recalculate(order)


def patch_shipment(shipment_id: int, changes: dict) -> OrderDetailResponse:
    with database.SessionLocal.begin() as session:
        shipment = session.get(ShipmentRow, shipment_id)
        if not shipment:
            raise LookupError("Shipment not found")
        confirmed_tracking_only = shipment.order.status == "confirmed" and set(changes) == {"tracking_number"}
        if shipment.order.status != "draft" and not confirmed_tracking_only:
            raise BusinessError("Shipment details can only be edited while the order is draft")
        if confirmed_tracking_only and not str(changes.get("tracking_number") or "").strip():
            raise BusinessError("Tracking number is required")
        if "carrier" in changes:
            carrier_row = _carrier_for_payload(session, changes)
            if shipment.tracking_number and shipment.carrier_id != carrier_row.id:
                raise BusinessError("Carrier cannot be changed after a tracking number is assigned")
            shipment.carrier = carrier_row.name
            shipment.carrier_id = carrier_row.id
        elif "carrier_id" in changes:
            carrier_row = _carrier_for_payload(session, changes)
            if shipment.tracking_number and shipment.carrier_id != carrier_row.id:
                raise BusinessError("Carrier cannot be changed after a tracking number is assigned")
            shipment.carrier = carrier_row.name
            shipment.carrier_id = carrier_row.id
        if "tracking_number" in changes:
            candidate = str(changes["tracking_number"] or "").strip() or None
            if candidate and any(other.id != shipment.id and other.carrier.casefold() == shipment.carrier.casefold() and (other.tracking_number or "").strip() == candidate for other in shipment.order.shipments):
                raise BusinessError("Duplicate carrier and tracking number in this order")
            shipment.tracking_number = candidate
        if "tracking_group" in changes:
            shipment.tracking_group = str(changes["tracking_group"]).strip()
        if "carrier" in changes and shipment.tracking_number:
            if any(other.id != shipment.id and other.carrier.casefold() == shipment.carrier.casefold() and (other.tracking_number or "").strip() == shipment.tracking_number for other in shipment.order.shipments):
                raise BusinessError("Duplicate carrier and tracking number in this order")
        if not confirmed_tracking_only:
            _recalculate(shipment.order)
        order_no = shipment.order.order_no
    result = get_order(order_no)
    assert result is not None
    return result


def apply_shipping_quote(shipment_id: int, quote: dict) -> OrderDetailResponse:
    with database.SessionLocal.begin() as session:
        shipment = session.get(ShipmentRow, shipment_id)
        if not shipment:
            raise LookupError("Shipment not found")
        if quote.get("shipment_id") != shipment_id or quote.get("order_no") != shipment.order.order_no:
            raise BusinessError("The selected quote does not belong to this order shipment")
        if shipment.order.status == "completed":
            raise BusinessError("Completed orders are read-only")
        shipment.shipping_fee_cents = _money_cents(Decimal(str(quote["total_cost"])))
        shipment.shipping_quote_status = "quoted"
        shipment.selected_product_id = quote.get("product_id")
        shipment.shipping_account_profile_id = quote.get("shipping_account_profile_id")
        shipment.shipping_account_label = quote.get("shipping_account_label")
        shipment.shipping_account_number_masked = quote.get("shipping_account_number_masked")
        shipment.quote_source = quote.get("source", "Australia Post API")
        shipment.quoted_at = datetime.now(timezone.utc)
        _recalculate(shipment.order)
        order_no = shipment.order.order_no
    result = get_order(order_no)
    assert result is not None
    return result


def product_weight_for_lines(session: Session, order: OrderRow, line_ids: list[int], *, allowed_shipment_id: int | None = None) -> int:
    unique_ids = set(line_ids)
    if len(unique_ids) != len(line_ids):
        raise BusinessError("Order lines cannot be selected more than once")
    line_map = {line.id: line for line in order.lines}
    if unique_ids - set(line_map):
        raise BusinessError("Shipment cannot reference order lines from a different order")
    grams = 0
    for line_id in unique_ids:
        line = line_map[line_id]
        if any(shipment.id != allowed_shipment_id for shipment in line.shipments):
            raise BusinessError(f"Order line {line.sku} is already assigned to another shipment")
        if line.product.weight_g is None:
            raise BusinessError(f"Product weight is missing for SKU {line.sku}")
        grams += line.product.weight_g * line.quantity
    return grams


def save_planned_shipment(order_no: str, payload: dict, quote: dict | None = None) -> OrderDetailResponse:
    """创建或更新 Shipment，并在同一事务中保存整行分配及包裹、地址快照。"""
    planner = quote.get("planner_context") if quote else payload
    if not planner:
        raise BusinessError("Quote is missing its shipping plan")
    with database.SessionLocal.begin() as session:
        order = session.scalar(select(OrderRow).where(OrderRow.order_no == order_no).options(
            selectinload(OrderRow.lines).selectinload(OrderLineRow.product),
            selectinload(OrderRow.lines).selectinload(OrderLineRow.shipments),
            selectinload(OrderRow.shipments).selectinload(ShipmentRow.lines),
            selectinload(OrderRow.shipments).selectinload(ShipmentRow.packages)))
        if not order:
            raise LookupError("Order not found")
        if order.status != "draft":
            raise BusinessError("Shipping plans can only be changed while the order is draft")
        carrier = session.get(CarrierRow, int(planner["carrier_id"]))
        if not carrier:
            raise BusinessError("Carrier not found")
        shipment_id = planner.get("shipment_id")
        shipment = next((item for item in order.shipments if item.id == int(shipment_id)), None) if shipment_id else None
        if shipment_id and not shipment:
            raise BusinessError("Shipment does not belong to this order")
        if not shipment and not carrier.is_active:
            raise BusinessError("This carrier is inactive and cannot be used for a new Shipment")
        if shipment and shipment.tracking_number and shipment.carrier_id != carrier.id:
            raise BusinessError("Carrier cannot be changed after a tracking number is assigned")
        selected_ids = [int(value) for value in planner["order_line_ids"]]
        net_weight_g = product_weight_for_lines(session, order, selected_ids, allowed_shipment_id=int(shipment_id) if shipment_id else None)
        selected = set(selected_ids)
        if shipment:
            for line in list(shipment.lines):
                shipment.lines.remove(line)
            shipment.packages.clear()
        else:
            shipment = ShipmentRow(order_id=order.id, carrier=carrier.name, carrier_id=carrier.id,
                tracking_group=f"Shipment {len(order.shipments) + 1}", tracking_number=None,
                shipping_fee_cents=0, shipping_quote_status="not_quoted")
            order.shipments.append(shipment)
            session.flush()
        shipment.carrier = carrier.name
        shipment.carrier_id = carrier.id
        if planner.get("shipping_account_profile_id"):
            shipment.shipping_account_profile_id = planner["shipping_account_profile_id"]
            shipment.shipping_account_label = planner.get("shipping_account_label")
            shipment.shipping_account_number_masked = planner.get("shipping_account_number_masked")
        tracking = str(planner.get("tracking_number") or "").strip() or None
        if tracking and any(other.id != shipment.id and other.carrier_id == carrier.id and (other.tracking_number or "").strip() == tracking for other in order.shipments):
            raise BusinessError("Duplicate carrier and tracking number in this order")
        if "tracking_number" in planner:
            shipment.tracking_number = tracking
        line_map = {line.id: line for line in order.lines}
        for line_id in selected:
            shipment.lines.append(line_map[line_id])
        for package in planner["packages"]:
            weight_g = int((Decimal(str(package["weight_kg"])) * 1000).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
            length_mm = int((Decimal(str(package["length_cm"])) * 10).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
            width_mm = int((Decimal(str(package["width_cm"])) * 10).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
            height_mm = int((Decimal(str(package["height_cm"])) * 10).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
            if min(weight_g, length_mm, width_mm, height_mm) <= 0:
                raise BusinessError("Package weight and dimensions must be positive")
            if weight_g < net_weight_g:
                raise BusinessError("Package gross weight cannot be less than selected product net weight")
            shipment.packages.append(ShipmentPackageRow(gross_weight_g=weight_g, length_mm=length_mm, width_mm=width_mm, height_mm=height_mm))
        origin, destination = planner["origin"], planner["destination"]
        shipment.origin_suburb, shipment.origin_state, shipment.origin_postcode = origin["suburb"], origin["state"], origin["postcode"]
        shipment.destination_suburb, shipment.destination_state, shipment.destination_postcode = destination["suburb"], destination["state"], destination["postcode"]
        shipment.origin_type, shipment.origin_lines_json, shipment.origin_country = origin.get("type") or "MERCHANT_LOCATION", json.dumps(origin.get("lines") or []), origin.get("country") or "AU"
        shipment.destination_type, shipment.destination_lines_json, shipment.destination_country = destination.get("type") or "STANDARD_ADDRESS", json.dumps(destination.get("lines") or []), destination.get("country") or "AU"
        if quote:
            shipment.shipping_fee_cents = _money_cents(Decimal(str(quote["total_cost"])))
            shipment.shipping_quote_status = "quoted"
            shipment.selected_product_id = quote.get("product_id")
            shipment.shipping_account_profile_id = quote.get("shipping_account_profile_id")
            shipment.shipping_account_label = quote.get("shipping_account_label")
            shipment.shipping_account_number_masked = quote.get("shipping_account_number_masked")
            shipment.quote_source = quote.get("source")
            shipment.quoted_at = datetime.now(timezone.utc)
        else:
            shipment.shipping_fee_cents = 0
            shipment.shipping_quote_status = "not_quoted"
            shipment.selected_product_id = None
            shipment.quote_source = None
            shipment.quoted_at = None
        _recalculate(order)
        saved_order_no = order.order_no
    result = get_order(saved_order_no)
    assert result is not None
    return result
