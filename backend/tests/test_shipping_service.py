import httpx
import pytest
import json

from app import shipping_service


class FakeClient:
    last_request = None

    def __init__(self, *args, **kwargs):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def post(self, url, json):
        FakeClient.last_request = {"url": url, "json": json}
        return httpx.Response(200, json={"shipments": [{"shipment_summary": {"total_cost": "12.34", "total_gst": "1.12", "fuel_surcharge": "0.42"}, "items": [{"product_id": "EL1", "product_type": "Parcel Post"}]}]})


def test_pricing_account_overrides_legacy_account(monkeypatch):
    # 使用隔离的数字账号与测试凭据，避免本机 .env 账号档案干扰兼容逻辑测试。
    monkeypatch.delenv("AUSTRALIA_POST_ACCOUNT_PROFILES_JSON", raising=False)
    monkeypatch.setenv("AUSTRALIA_POST_API_KEY", "test-api-key")
    monkeypatch.setenv("AUSTRALIA_POST_API_PASSWORD", "test-api-password")
    monkeypatch.setenv("AUSTRALIA_POST_ACCOUNT_NUMBER", "9876543210")
    monkeypatch.setenv("AUSTRALIA_POST_PRICING_ACCOUNT_NUMBER", "1234567890")
    assert shipping_service._env()[2] == "1234567890"


def test_pricing_account_falls_back_to_legacy_account(monkeypatch):
    monkeypatch.delenv("AUSTRALIA_POST_ACCOUNT_PROFILES_JSON", raising=False)
    monkeypatch.delenv("AUSTRALIA_POST_PRICING_ACCOUNT_NUMBER", raising=False)
    monkeypatch.setenv("AUSTRALIA_POST_API_KEY", "test-api-key")
    monkeypatch.setenv("AUSTRALIA_POST_API_PASSWORD", "test-api-password")
    monkeypatch.setenv("AUSTRALIA_POST_ACCOUNT_NUMBER", "9876543210")
    assert shipping_service._env()[2] == "9876543210"


def test_account_profiles_are_selectable_and_secrets_are_not_returned(monkeypatch):
    # API 只返回脱敏账号档案；账号原值和认证信息仅用于服务端请求。
    monkeypatch.setenv("AUSTRALIA_POST_API_KEY", "test-api-key")
    monkeypatch.setenv("AUSTRALIA_POST_API_PASSWORD", "test-api-password")
    monkeypatch.setenv("AUSTRALIA_POST_PRICING_ACCOUNT_NUMBER", "2004456017")
    monkeypatch.setenv("AUSTRALIA_POST_ACCOUNT_SAME_DAY", "3004456017")
    monkeypatch.setenv("AUSTRALIA_POST_ACCOUNT_PROFILES_JSON", json.dumps([
        {"id": "eparcel-international", "label": "eParcel and International", "account_number_env": "AUSTRALIA_POST_PRICING_ACCOUNT_NUMBER", "default_for_pricing": True},
        {"id": "same-day-services", "label": "Same Day Services", "account_number_env": "AUSTRALIA_POST_ACCOUNT_SAME_DAY"},
    ]))

    profiles = shipping_service.get_shipping_accounts()
    assert [profile["id"] for profile in profiles] == ["eparcel-international", "same-day-services"]
    assert profiles[1]["account_number_masked"].endswith("6017")
    assert all("account_number" not in profile and "api_key" not in profile and "password" not in profile for profile in profiles)
    assert shipping_service._env("same-day-services")[2] == "3004456017"


def test_quote_posts_explicit_origin_and_normalizes_returned_rate(monkeypatch):
    monkeypatch.setenv("AUSTRALIA_POST_API_KEY", "test-key")
    monkeypatch.setenv("AUSTRALIA_POST_API_PASSWORD", "test-password")
    monkeypatch.setenv("AUSTRALIA_POST_ACCOUNT_NUMBER", "0000000000")
    monkeypatch.setattr(shipping_service.httpx, "Client", FakeClient)
    result = shipping_service.get_rates({
        "origin": {"suburb": "Ryde", "state": "NSW", "postcode": "2111"},
        "destination": {"suburb": "South Yarra", "state": "VIC", "postcode": "3141"},
        "packages": [{"weight": "1.2", "length": "20", "width": "15", "height": "10"}],
        "order_no": "PO-EXAMPLE", "shipment_id": 7,
    })
    assert FakeClient.last_request["url"].endswith("/prices/shipments")
    shipment = FakeClient.last_request["json"]["shipments"][0]
    assert shipment["from"]["postcode"] == "2111"
    assert shipment["to"]["postcode"] == "3141"
    assert shipment["items"] == [{"weight": "1.2", "length": "20", "width": "15", "height": "10"}]
    assert result[0]["product_id"] == "EL1"
    assert result[0]["service_name"] == "Parcel Post"
    assert result[0]["total_cost"] == "12.34"
    assert result[0]["fuel_surcharge"] == "0.42"
    assert result[0]["gst"] == "1.12"
    assert result[0]["order_no"] == "PO-EXAMPLE"


def test_tnt_is_not_sent_to_australia_post():
    # React 客户端会阻止 TNT 报价；报价服务也不接收承运商参数，因此不会把 TNT 请求静默转发给澳邮。
    assert "carrier" not in shipping_service.get_rates.__annotations__
