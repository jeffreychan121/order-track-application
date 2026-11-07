import base64

import httpx
import pytest
from fastapi.testclient import TestClient

from app import data_service, tracking_service
from app.main import app
from app.logging_service import LOG_FILE, _sanitize


def _set_credentials(monkeypatch):
    monkeypatch.setenv("AUSTRALIA_POST_API_KEY", "test-key")
    monkeypatch.setenv("AUSTRALIA_POST_API_PASSWORD", "test-password")
    monkeypatch.setenv("AUSTRALIA_POST_ACCOUNT_NUMBER", "00000000")
    monkeypatch.setenv("AUSTRALIA_POST_BASE_URL", "https://digitalapi.auspost.com.au/test/shipping/v1")
    tracking_service._cache.clear()
    tracking_service._request_times.clear()


def _success_response(request):
    return httpx.Response(200, request=request, json={
        "tracking_results": [{
            "tracking_id": "TRACK-123", "status": "In Transit",
            "events": [{"date": "2026-08-25T10:30:00+10:00", "description": "In transit", "location": "Sydney NSW"}],
            "consignment": {"events": [
                {"date": "2026-08-25T10:30:00+10:00", "description": "In transit", "location": "Sydney NSW"},
                {"date": "2026-08-24T15:00:00+10:00", "description": "Processed at facility", "location": "Sydney NSW"},
            ]},
        }]
    })


def test_httpx_uses_basic_auth_account_header_tracking_id_and_parses_result(monkeypatch):
    _set_credentials(monkeypatch)
    calls = []

    def handler(request):
        calls.append(request)
        return _success_response(request)

    def fake_get(url, **kwargs):
        trust_env = kwargs.pop("trust_env", True)
        with httpx.Client(transport=httpx.MockTransport(handler), trust_env=trust_env) as client:
            return client.get(url, **kwargs)
    monkeypatch.setattr(tracking_service.httpx, "get", fake_get)
    result = tracking_service.get_tracking_result("StarTrack / Australia Post", "TRACK-123", refresh=True)
    request = calls[0]
    assert request.url.params["tracking_ids"] == "TRACK-123"
    assert request.headers["account-number"] == "00000000"
    assert request.headers["authorization"] == "Basic " + base64.b64encode(b"test-key:test-password").decode()
    assert result.status == "in_transit"
    assert result.last_updated == "2026-08-25T10:30:00+10:00"
    assert result.error_code is None
    assert len(result.events) == 2
    assert result.events[0]["description"] == "In transit"
    assert result.events[1]["description"] == "Processed at facility"


@pytest.mark.parametrize(("status", "error_code"), [(401, "AUTH_FAILED"), (403, "AUTH_FAILED"), (404, "NOT_FOUND"), (503, "SERVICE_UNAVAILABLE")])
def test_http_statuses_are_classified(monkeypatch, status, error_code):
    _set_credentials(monkeypatch)
    monkeypatch.setattr(tracking_service.httpx, "get", lambda *a, **kw: httpx.Response(status, request=httpx.Request("GET", a[0])))
    result = tracking_service.get_tracking_result("Australia Post", f"HTTP-{status}", refresh=True)
    assert result.status == "unavailable"
    assert result.error_code == error_code


def test_timeout_is_classified(monkeypatch):
    _set_credentials(monkeypatch)
    def timeout(*args, **kwargs):
        request = httpx.Request("GET", "https://digitalapi.auspost.au/")
        raise httpx.ReadTimeout("simulated timeout", request=request)
    monkeypatch.setattr(tracking_service.httpx, "get", timeout)
    result = tracking_service.get_tracking_result("Australia Post", "TIMEOUT", refresh=True)
    assert result.error_code == "TIMEOUT"


def test_tls_verification_error_is_classified_without_disabling_verification(monkeypatch):
    _set_credentials(monkeypatch)
    def tls_error(*args, **kwargs):
        request = httpx.Request("GET", "https://digitalapi.auspost.com.au/")
        raise httpx.ConnectError("[SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed", request=request)
    monkeypatch.setattr(tracking_service.httpx, "get", tls_error)
    result = tracking_service.get_tracking_result("Australia Post", "TLS", refresh=True)
    assert result.error_code == "TLS_ERROR"
    assert "certificate verification failed" in result.error


def test_unconfigured_credentials_and_tnt_do_not_make_requests(monkeypatch):
    for key in ("AUSTRALIA_POST_API_KEY", "AUSTRALIA_POST_API_PASSWORD", "AUSTRALIA_POST_ACCOUNT_NUMBER"):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setattr(tracking_service.httpx, "get", lambda *a, **kw: (_ for _ in ()).throw(AssertionError("network call")))
    assert tracking_service.get_tracking_result("Australia Post", "NO-CREDS").error_code == "AUTH_FAILED"
    assert tracking_service.get_tracking_result("TNT", "TNT-ID").status == "not_implemented"


def test_fastapi_tracking_response_includes_classified_error(monkeypatch):
    monkeypatch.setattr(data_service, "get_tracking_result", lambda *a, **kw: tracking_service.TrackingResult(
        status="unavailable", error="certificate verification failed", error_code="TLS_ERROR"
    ))
    response = TestClient(app).get("/api/orders/PO-20251203-00046/tracking?refresh=true")
    assert response.status_code == 200
    result = next(item for item in response.json() if item["carrier"] != "TNT")
    assert result["overall_status"] == "unavailable"
    assert result["tracking_error_code"] == "TLS_ERROR"
    assert result["total_articles"] is None
    assert result["consignment_events"] == []


def test_fastapi_dto_includes_articles_last_update_and_test_date_warning(monkeypatch):
    old_event = {"date": "2025-02-13T11:49:59+11:00", "description": "Delivered", "location": "Sample Depot"}
    service_result = tracking_service.TrackingResult(
        status="delivered",
        raw_status="Delivered in Full",
        last_updated=old_event["date"],
        events=[old_event],
        articles=[tracking_service.ArticleTrackingResult(
            article_id="ARTICLE-ONE",
            product_type="Parcel",
            raw_status="Item Delivered",
            status="delivered",
            last_updated=old_event["date"],
            events=[old_event],
        )],
    )
    monkeypatch.setattr(data_service, "get_tracking_result", lambda *a, **kw: service_result)
    response = TestClient(app).get("/api/orders/PO-20251203-00046/tracking?refresh=true")
    assert response.status_code == 200
    shipment = next(item for item in response.json() if item["carrier"] != "TNT")
    assert shipment["overall_status"] == "delivered"
    assert shipment["overall_status_raw"] == "Delivered in Full"
    assert shipment["total_articles"] == 1
    assert shipment["delivered_articles"] == 1
    assert shipment["last_updated"] == old_event["date"]
    assert shipment["test_data_time_mismatch"] is True
    assert shipment["articles"][0]["article_id"] == "ARTICLE-ONE"
    assert shipment["consignment_events"][0]["date"].endswith("+11:00")


def _parse(payload):
    return tracking_service._parse_tracking_result(
        {"tracking_results": [{"tracking_id": "TEST-CONSIGNMENT", **payload}]},
        "TEST-CONSIGNMENT",
    )


def test_one_consignment_multiple_articles_keeps_events_and_article_counts_separate():
    result = _parse({
        "consignment": {
            "status": "Delivered in Full",
            "events": [{"date": "2026-06-03T09:00:00+10:00", "description": "Consignment closed"}],
        },
        "trackable_items": [
            {"article_id": "ARTICLE-A", "product_type": "Parcel", "status": "Item Delivered", "events": [
                {"date": "2026-06-03T09:00:00+10:00", "description": "Delivered", "location": "Sydney NSW"},
            ]},
            {"article_id": "ARTICLE-B", "product_type": "Parcel", "status": "Item Delivered", "events": [
                {"date": "2026-06-02T16:30:00+10:00", "description": "Delivered", "location": "Melbourne VIC"},
            ]},
        ],
    })
    assert result.status == "delivered"
    assert result.raw_status == "Delivered in Full"
    assert result.article_count == 2
    assert result.delivered_article_count == 2
    assert len(result.events) == 1
    assert [article.article_id for article in result.articles] == ["ARTICLE-A", "ARTICLE-B"]
    assert result.articles[0].events[0]["location"] == "Sydney NSW"
    assert result.articles[1].events[0]["location"] == "Melbourne VIC"


def test_missing_consignment_status_derives_partial_delivery_from_articles():
    result = _parse({
        "consignment": {"events": []},
        "trackable_items": [
            {"article_id": "A", "status": "Item Delivered", "events": []},
            {"article_id": "B", "status": "Onboard for delivery", "events": []},
        ],
    })
    assert result.raw_status is None
    assert result.status == "partially_delivered"
    assert result.article_count == 2
    assert result.delivered_article_count == 1


def test_events_sort_by_actual_timezone_aware_date_and_keep_utc_offset():
    result = _parse({
        "consignment": {"status": "In Transit", "events": [
            {"date": "2026-06-02T10:00:00+10:00", "description": "Older"},
            {"date": "2026-06-02T01:00:00Z", "description": "Newer instant"},
        ]},
        "trackable_items": [{"article_id": "A", "status": "Item Delivered", "events": [
            {"date": "2026-06-03T07:00:00+10:00", "description": "Latest article event"},
        ]}],
    })
    assert result.last_updated == "2026-06-03T07:00:00+10:00"
    assert [event["date"] for event in result.events] == [
        "2026-06-02T01:00:00Z",
        "2026-06-02T10:00:00+10:00",
    ]
    assert result.events[0]["date"].endswith("Z")


def test_empty_events_missing_location_and_missing_article_fields_are_tolerated():
    result = _parse({
        "consignment": {"events": [{"date": "2026-06-03T09:00:00+10:00", "description": "Item processed at sorting facility"}]},
        "trackable_items": [{"events": []}, None],
    })
    assert result.status == "in_transit"
    assert result.article_count == 1
    assert result.articles[0].article_id is None
    assert result.events[0]["location"] is None


def test_no_events_and_unknown_or_missing_status_return_unknown_without_crashing():
    no_articles = _parse({"consignment": {}, "trackable_items": []})
    assert no_articles.status == "unknown"
    assert no_articles.article_count == 0
    assert no_articles.last_updated is None

    unknown = _parse({
        "consignment": {"status": "Carrier custom state", "events": []},
        "trackable_items": [{"article_id": "A", "status": "Custom article state", "events": []}],
    })
    assert unknown.status == "unknown"
    assert unknown.raw_status == "Carrier custom state"
    assert unknown.articles[0].status == "unknown"


def test_event_without_description_or_location_still_updates_last_updated():
    result = _parse({"consignment": {"events": [
        {"date": "2026-06-03T09:00:00+10:00"},
    ]}, "trackable_items": []})
    assert result.status == "unknown"
    assert result.last_updated == "2026-06-03T09:00:00+10:00"
    assert result.events[0]["description"] is None
    assert result.events[0]["location"] is None


def test_missing_article_status_uses_latest_article_event_for_unified_state():
    result = _parse({"consignment": {"events": []}, "trackable_items": [{
        "article_id": "A", "product_type": "Parcel", "events": [
            {"date": "2026-06-03T09:00:00+10:00", "description": "Item delivered"},
        ],
    }]})
    assert result.status == "delivered"
    assert result.articles[0].raw_status is None
    assert result.articles[0].status == "delivered"


def test_order_date_conflict_flag_is_based_on_event_dates():
    from datetime import date
    from app.data_service import _event_predates_order

    events = [{"date": "2025-02-13T11:49:59+11:00", "description": "Delivered", "location": None}]
    assert _event_predates_order(events, date(2025, 12, 3)) is True
    assert _event_predates_order(events, date(2025, 2, 1)) is False


def test_api_logging_redacts_sensitive_fields_and_adds_request_id():
    safe = _sanitize({
        "password": "fake-password",
        "details": "Authorization: Basic fake-token",
        "nested": {"account_number": "12345678"},
    })
    assert safe["password"] == "[REDACTED]"
    assert "fake-token" not in safe["details"]
    assert safe["nested"]["account_number"] == "[REDACTED]"

    response = TestClient(app).get("/api/health")
    request_id = response.headers["X-Request-ID"]
    lines = LOG_FILE.read_text(encoding="utf-8").splitlines()
    entries = [__import__("json").loads(line) for line in lines if request_id in line]
    assert [entry["event"] for entry in entries] == [
        "inbound_request_started",
        "inbound_request_completed",
    ]
