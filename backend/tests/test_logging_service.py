from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import request_logging
from app.logging_service import _sanitize
from app.request_logging import RequestLoggingMiddleware


def test_tracking_numbers_are_masked_in_structured_logs():
    assert _sanitize("ABCD123456", "tracking_number") == "…3456"
    assert _sanitize("1234", "tracking_id") == "[REDACTED]"


def test_nested_log_fields_mask_tracking_numbers_and_secrets():
    fields = _sanitize({
        "tracking_number": "TRACKING-123456",
        "account_number": "private-account",
        "status": "in_transit",
    })
    assert fields == {
        "tracking_number": "…3456",
        "account_number": "[REDACTED]",
        "status": "in_transit",
    }


def test_log_payloads_mask_customer_address_and_validation_input_fields():
    fields = _sanitize({
        "customer": {"name": "Alex", "email": "alex@example.com"},
        "shipping_address": {"street": "1 Main Street", "postcode": "2112"},
        "tracking_number": "TRACK-4567",
        "article_id": "ARTICLE-000123",
        "status": "confirmed",
        "errors": [{"input": "alex@example.com", "msg": "invalid value"}],
    })

    assert fields == {
        "customer": "[REDACTED]",
        "shipping_address": "[REDACTED]",
        "tracking_number": "…4567",
        "article_id": "…0123",
        "status": "confirmed",
        "errors": [{"input": "[REDACTED]", "msg": "invalid value"}],
    }


def test_request_middleware_logs_redacted_params_and_preserves_request_body(monkeypatch):
    events = []

    def capture(event, **fields):
        events.append((event, _sanitize(fields)))

    monkeypatch.setattr(request_logging, "log_api_event", capture)
    app = FastAPI()
    app.add_middleware(RequestLoggingMiddleware)

    @app.post("/echo")
    def echo(payload: dict):
        return payload

    request_id = "known-request-123"
    response = TestClient(app).post(
        "/echo?email=alex%40example.com",
        headers={"X-Request-ID": request_id},
        json={
            "customer": {"name": "Alex", "email": "alex@example.com"},
            "tracking_number": "TRACK-4567",
            "quantity": 2,
        },
    )

    assert response.status_code == 200
    assert response.headers["X-Request-ID"] == request_id
    assert response.json()["customer"]["email"] == "alex@example.com"
    completed = next(fields for event, fields in events if event == "inbound_request_completed")
    assert completed["request_id"] == request_id
    assert completed["query_params"] == {"email": "[REDACTED]"}
    assert completed["request_params"] == {
        "customer": "[REDACTED]",
        "tracking_number": "…4567",
        "quantity": 2,
    }
    assert completed["response_params"]["customer"] == "[REDACTED]"
    assert completed["response_params"]["tracking_number"] == "…4567"


def test_request_middleware_returns_request_id_and_stack_frames_for_unhandled_error(monkeypatch):
    events = []

    def capture(event, **fields):
        events.append((event, _sanitize(fields)))

    monkeypatch.setattr(request_logging, "log_api_event", capture)
    app = FastAPI()
    app.add_middleware(RequestLoggingMiddleware)

    @app.get("/boom")
    def boom():
        raise RuntimeError("private message must not be logged")

    request_id = "failure-request-123"
    response = TestClient(app).get("/boom", headers={"X-Request-ID": request_id})

    assert response.status_code == 500
    assert response.headers["X-Request-ID"] == request_id
    assert response.json() == {"detail": "Internal Server Error"}
    failure = next(fields for event, fields in events if event == "inbound_request_failed")
    assert failure["request_id"] == request_id
    assert failure["error_type"] == "RuntimeError"
    assert any(frame["function"] == "boom" for frame in failure["stack_frames"])
    assert "private message must not be logged" not in str(failure)
