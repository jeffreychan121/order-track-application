from app.logging_service import _sanitize


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
