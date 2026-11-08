"""Australia Post 运费报价客户端；不会擅自替换调用方提供的始发地址。"""
from __future__ import annotations

import copy
import json
import os
import re
import ssl
import time
from decimal import Decimal, ROUND_HALF_UP
from threading import Lock
from uuid import uuid4

import httpx

from .logging_service import log_api_event

BASE = "https://digitalapi.auspost.com.au/test/shipping/v1"
_quotes: dict[str, tuple[float, dict]] = {}
_lock = Lock()
_account_products_cache: dict[str, tuple[float, dict]] = {}
_account_products_cache_ttl = 15 * 60


class QuoteError(Exception):
    """承运商报价错误携带稳定错误码，供 API 和前端作分类处理。"""

    def __init__(self, code: str, message: str):
        """保存机器可判断的错误码，同时保留面向用户的安全说明。"""
        super().__init__(message)
        self.code = code


def _account_profiles() -> list[dict]:
    """从服务端环境加载账号档案；兼容当前单账号变量配置。"""
    profiles_json = os.getenv("AUSTRALIA_POST_ACCOUNT_PROFILES_JSON", "").strip()
    if profiles_json:
        try:
            configured = json.loads(profiles_json)
        except json.JSONDecodeError as error:
            raise QuoteError("ACCOUNT_CONFIG_INVALID", "Australia Post account profile configuration is invalid JSON.") from error
        if not isinstance(configured, list) or not configured:
            raise QuoteError("ACCOUNT_CONFIG_INVALID", "Australia Post account profiles must be a JSON array.")
        profiles = []
        seen_ids = set()
        seen_labels = set()
        for entry in configured:
            if not isinstance(entry, dict):
                raise QuoteError("ACCOUNT_CONFIG_INVALID", "Each Australia Post account profile must be an object.")
            profile_id = str(entry.get("id") or "").strip()
            if len(profile_id) > 80 or not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", profile_id) or profile_id in seen_ids:
                raise QuoteError("ACCOUNT_CONFIG_INVALID", "Account profile IDs must be unique lowercase kebab-case identifiers.")
            seen_ids.add(profile_id)
            label = str(entry.get("label") or profile_id).strip()
            if not label or len(label) > 160 or label.casefold() in seen_labels:
                raise QuoteError("ACCOUNT_CONFIG_INVALID", "Account profile labels must be non-empty, unique and no longer than 160 characters.")
            seen_labels.add(label.casefold())
            account_env = str(entry.get("account_number_env") or "AUSTRALIA_POST_PRICING_ACCOUNT_NUMBER").strip()
            key_env = str(entry.get("api_key_env") or "AUSTRALIA_POST_API_KEY").strip()
            password_env = str(entry.get("api_password_env") or "AUSTRALIA_POST_API_PASSWORD").strip()
            base_url_env = str(entry.get("base_url_env") or "AUSTRALIA_POST_BASE_URL").strip()
            if not all(re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", name) for name in (account_env, key_env, password_env, base_url_env)):
                raise QuoteError("ACCOUNT_CONFIG_INVALID", "Account profile environment variable references are invalid.")
            account_number = os.getenv(account_env, "").strip()
            if account_number and not re.fullmatch(r"[0-9]{1,20}", account_number):
                raise QuoteError("ACCOUNT_CONFIG_INVALID", f"Account number in {account_env} must contain digits only and is kept as text.")
            base_url = os.getenv(base_url_env, BASE).strip().rstrip("/")
            environment = str(entry.get("environment") or ("test" if "/test/" in base_url else "production")).strip().lower()
            if environment not in {"test", "production"}:
                raise QuoteError("ACCOUNT_CONFIG_INVALID", "Account profile environment must be 'test' or 'production'.")
            profiles.append({
                "id": profile_id,
                "label": label,
                "account_number": account_number,
                "api_key": os.getenv(key_env, "").strip(),
                "password": os.getenv(password_env, "").strip(),
                "base_url": base_url,
                "environment": environment,
                "enabled": entry.get("enabled", True) is True,
                "pricing_enabled": entry.get("pricing_enabled", True) is True,
                "default_for_pricing": entry.get("default_for_pricing", False) is True,
            })
        if sum(profile["default_for_pricing"] for profile in profiles) != 1:
            raise QuoteError("ACCOUNT_CONFIG_INVALID", "Exactly one Australia Post account must be the default pricing account.")
        return profiles

    # 旧配置迁移期：原来的报价账号变量自动成为一个默认档案。
    account = (os.getenv("AUSTRALIA_POST_PRICING_ACCOUNT_NUMBER") or os.getenv("AUSTRALIA_POST_ACCOUNT_NUMBER", "")).strip()
    if not account:
        return []
    base_url = os.getenv("AUSTRALIA_POST_BASE_URL", BASE).strip().rstrip("/")
    return [{
        "id": "australia-post-default",
        "label": os.getenv("AUSTRALIA_POST_PRICING_ACCOUNT_LABEL", "eParcel & International").strip(),
        "account_number": account,
        "api_key": os.getenv("AUSTRALIA_POST_API_KEY", "").strip(),
        "password": os.getenv("AUSTRALIA_POST_API_PASSWORD", "").strip(),
        "base_url": base_url,
        "environment": "test" if "/test/" in base_url else "production",
        "enabled": True,
        "pricing_enabled": True,
        "default_for_pricing": True,
    }]


def _account_number_masked(account_number: str) -> str:
    """只暴露账号末四位供用户辨认，绝不把账号原值返回浏览器。"""
    if not account_number:
        return "Not configured"
    return f"••••{account_number[-4:]}" if len(account_number) > 4 else "••••"


def _public_account_profile(profile: dict) -> dict:
    """仅返回可安全供浏览器选择和显示的账号档案字段。"""
    return {
        "id": profile["id"],
        "label": profile["label"],
        "account_number_masked": _account_number_masked(profile["account_number"]),
        "environment": profile["environment"],
        "enabled": profile["enabled"],
        "pricing_enabled": profile["pricing_enabled"],
        "default_for_pricing": profile["default_for_pricing"],
        "configured": bool(profile["account_number"] and profile["api_key"] and profile["password"]),
    }


def get_shipping_accounts() -> list[dict]:
    """列出账号档案，不返回完整账号号、API Key 或密码。"""
    profiles = _account_profiles()
    profiles.sort(key=lambda profile: (not profile["default_for_pricing"], profile["label"].casefold()))
    return [_public_account_profile(profile) for profile in profiles]


def get_shipping_account_descriptor(profile_id: str) -> dict:
    """验证报价账号档案并返回安全的展示字段。"""
    profile = next((item for item in _account_profiles() if item["id"] == profile_id), None)
    if not profile or not profile["enabled"] or not profile["pricing_enabled"]:
        raise QuoteError("ACCOUNT_NOT_AVAILABLE", "The selected Australia Post pricing account is unavailable.")
    if not profile["account_number"] or not profile["api_key"] or not profile["password"]:
        raise QuoteError("ACCOUNT_NOT_CONFIGURED", "The selected Australia Post pricing account is not fully configured on the server.")
    return _public_account_profile(profile)


def _resolve_account_profile(profile_id: str | None = None) -> dict:
    """解析报价账号；显式选择不可用时直接报错，避免静默改用其他合同账号。"""
    profiles = [item for item in _account_profiles() if item["enabled"] and item["pricing_enabled"]]
    profile = next((item for item in profiles if item["id"] == profile_id), None) if profile_id else None
    if profile_id and profile is None:
        raise QuoteError("ACCOUNT_NOT_AVAILABLE", "The selected Australia Post pricing account is unavailable.")
    if profile is None:
        profile = next((item for item in profiles if item["default_for_pricing"]), None) or next(iter(profiles), None)
    if profile is None:
        raise QuoteError("ACCOUNT_NOT_CONFIGURED", "No Australia Post pricing account is configured on the server.")
    if not profile["account_number"] or not profile["api_key"] or not profile["password"]:
        raise QuoteError("AUTH_FAILED", "Australia Post shipping credentials are not configured for the selected server account.")
    return profile


def _env(profile_id: str | None = None):
    """返回指定档案的请求凭据，旧调用仍可不传参数使用默认报价账号。"""
    profile = _resolve_account_profile(profile_id)
    return profile["api_key"], profile["password"], profile["account_number"], profile["base_url"]


def get_pricing_account_products(profile_id: str | None = None, *, refresh: bool = False) -> dict:
    """读取指定报价账号的合同产品并缓存短时间，仅返回前端所需字段。"""
    request_started = time.monotonic()
    profile = _resolve_account_profile(profile_id)
    account_profile_id = profile["id"]
    if not refresh:
        cached = _account_products_cache.get(account_profile_id)
        if cached and time.monotonic() - cached[0] < _account_products_cache_ttl:
            log_api_event("account_products_cache_hit", carrier="Australia Post", account_profile_id=account_profile_id)
            return copy.deepcopy(cached[1])
    log_api_event("account_products_request_started", carrier="Australia Post", account_profile_id=account_profile_id)
    try:
        key, password, account, base_url = _env(account_profile_id)
    except QuoteError as error:
        log_api_event(
            "account_products_request_failed",
            level=40,
            carrier="Australia Post",
            error_code=error.code,
            duration_ms=round((time.monotonic() - request_started) * 1000, 2),
        )
        raise

    log_api_event(
        "carrier_request_started",
        carrier="Australia Post",
            account_profile_id=account_profile_id,
        method="GET",
        endpoint_path="/accounts/{account_number}",
    )
    try:
        with httpx.Client(
            auth=(key, password),
            headers={"account-number": account, "Accept": "application/json"},
            timeout=12,
            trust_env=True,
        ) as client:
            response = client.get(f"{base_url}/accounts/{account}")
    except httpx.TimeoutException as error:
        log_api_event(
            "account_products_request_failed",
            level=40,
            error_code="TIMEOUT",
            duration_ms=round((time.monotonic() - request_started) * 1000, 2),
        )
        raise QuoteError("TIMEOUT", "Australia Post account lookup timed out.") from error
    except httpx.RequestError as error:
        log_api_event(
            "account_products_request_failed",
            level=40,
            error_code="SERVICE_UNAVAILABLE",
            duration_ms=round((time.monotonic() - request_started) * 1000, 2),
        )
        raise QuoteError("SERVICE_UNAVAILABLE", "Australia Post account service could not be reached.") from error

    log_api_event(
        "carrier_response_received",
        carrier="Australia Post",
        http_status=response.status_code,
        response_bytes=len(response.content),
        duration_ms=round((time.monotonic() - request_started) * 1000, 2),
    )
    try:
        raw = response.json()
    except ValueError as error:
        log_api_event(
            "account_products_request_failed",
            level=40,
            error_code="INVALID_RESPONSE",
            http_status=response.status_code,
        )
        raise QuoteError("INVALID_RESPONSE", "Australia Post returned an invalid account response.") from error

    if response.status_code >= 400:
        if response.status_code in (401, 403):
            code = "AUTH_FAILED"
            message = "Australia Post rejected the account lookup credentials."
        elif response.status_code == 404:
            code = "ACCOUNT_NOT_FOUND"
            message = "Australia Post could not find the configured pricing account."
        elif response.status_code == 429 or response.status_code >= 500:
            code = "SERVICE_UNAVAILABLE"
            message = f"Australia Post account service returned HTTP {response.status_code}."
        else:
            errors = raw.get("errors", []) if isinstance(raw, dict) else []
            upstream = next((item for item in errors if isinstance(item, dict)), {}) if isinstance(errors, list) else {}
            code = str(upstream.get("code") or "ACCOUNT_LOOKUP_FAILED")
            message = str(upstream.get("message") or f"Australia Post rejected the account lookup (HTTP {response.status_code}).")
        for secret in (key, password, account):
            if secret:
                message = message.replace(secret, "[redacted]")
        log_api_event(
            "account_products_request_failed",
            level=40,
            error_code=code,
            http_status=response.status_code,
            duration_ms=round((time.monotonic() - request_started) * 1000, 2),
        )
        raise QuoteError(code, message[:500])

    if not isinstance(raw, dict):
        log_api_event(
            "account_products_request_failed",
            level=40,
            error_code="INVALID_RESPONSE",
            http_status=response.status_code,
        )
        raise QuoteError("INVALID_RESPONSE", "Australia Post returned an unexpected account response.")

    details = raw.get("details") if isinstance(raw.get("details"), dict) else {}
    locations = raw.get("addresses") if isinstance(raw.get("addresses"), list) else []
    products = raw.get("postage_products") if isinstance(raw.get("postage_products"), list) else []
    safe_locations = [
        {key: address.get(key) for key in ("type", "suburb", "state", "postcode")}
        for address in locations
        if isinstance(address, dict)
    ]
    safe_products = []
    for product in products:
        if not isinstance(product, dict):
            continue
        contract = product.get("contract") if isinstance(product.get("contract"), dict) else {}
        options = product.get("options") if isinstance(product.get("options"), dict) else {}
        raw_features = product.get("features")
        if isinstance(raw_features, dict):
            feature_names = sorted(str(name) for name in raw_features)
        elif isinstance(raw_features, list):
            feature_names = sorted(str(name) for name in raw_features if name is not None)
        else:
            feature_names = []
        safe_products.append({
            "type": product.get("type"),
            "group": product.get("group"),
            "product_id": product.get("product_id"),
            "contract": {
                key: contract.get(key)
                for key in ("valid_from", "valid_to", "expired", "volumetric_pricing", "max_item_count", "cubing_factor")
            },
            "authority_to_leave": options.get("authority_to_leave_option"),
            "signature_on_delivery": options.get("signature_on_delivery_option"),
            "dangerous_goods_allowed": options.get("dangerous_goods_allowed"),
            "feature_names": feature_names,
        })

    # 不把 charge account 原值、联系人资料或税务编号返回浏览器。
    result = {
        "account": {
            "id": account_profile_id,
            "label": profile["label"],
            "account_number_masked": _account_number_masked(account),
            "environment": profile["environment"],
            "valid_from": raw.get("valid_from"),
            "valid_to": raw.get("valid_to"),
            "expired": raw.get("expired"),
            "lodgement_postcode": details.get("lodgement_postcode"),
            "credit_blocked": details.get("credit_blocked", raw.get("credit_blocked")),
            "locations": safe_locations,
        },
        "products": safe_products,
    }
    log_api_event(
        "account_products_request_completed",
        account_profile_id=account_profile_id,
        rate_count=len(safe_products),
        http_status=response.status_code,
        duration_ms=round((time.monotonic() - request_started) * 1000, 2),
    )
    _account_products_cache[account_profile_id] = (time.monotonic(), copy.deepcopy(result))
    return result


def get_rates(data: dict) -> list[dict]:
    """将调用方地址和包裹转成上游价格请求，校验响应并缓存可应用的报价。"""
    # 报价账号决定上游可用服务；请求地址和包裹数据保持调用方提交的值。
    request_started = time.monotonic()
    carrier_name = str(data.get("carrier") or "Australia Post")
    account_profile_id = data.get("shipping_account_profile_id")
    try:
        profile = _resolve_account_profile(account_profile_id)
        account_profile_id = profile["id"]
        key, password, account, base_url = _env(account_profile_id)
    except QuoteError as error:
        log_api_event(
            "shipping_rate_request_started",
            carrier=carrier_name,
            account_profile_id=account_profile_id,
            package_count=len(data.get("packages", [])),
        )
        log_api_event(
            "shipping_rate_request_failed",
            level=40,
            carrier=carrier_name,
            account_profile_id=account_profile_id,
            error_code=error.code,
            duration_ms=round((time.monotonic() - request_started) * 1000, 2),
        )
        raise
    origin = {**data["origin"], "type": data["origin"].get("type") or "MERCHANT_LOCATION",
              "lines": data["origin"].get("lines") or [], "country": data["origin"].get("country") or "AU"}
    destination = {**data["destination"], "type": data["destination"].get("type") or "STANDARD_ADDRESS",
                   "lines": data["destination"].get("lines") or [], "country": data["destination"].get("country") or "AU"}
    payload = {"shipments": [{
        "from": origin, "to": destination,
        "items": [{k: str(package[k]) for k in ("weight", "length", "width", "height")} for package in data["packages"]],
    }]}
    log_api_event("shipping_rate_request_started", carrier=carrier_name, account_profile_id=account_profile_id, package_count=len(data["packages"]), origin_postcode=data["origin"]["postcode"], destination_postcode=data["destination"]["postcode"])
    log_api_event(
        "carrier_request_started",
        carrier=carrier_name,
        account_profile_id=account_profile_id,
        method="POST",
        endpoint_path="/prices/shipments",
        package_count=len(data["packages"]),
    )
    try:
        with httpx.Client(auth=(key, password), headers={"account-number": account, "Accept": "application/json", "Content-Type": "application/json"}, timeout=12, trust_env=True) as client:
            response = client.post(f"{base_url}/prices/shipments", json=payload)
        log_api_event(
            "carrier_response_received",
            carrier=carrier_name,
            account_profile_id=account_profile_id,
            http_status=response.status_code,
            response_bytes=len(response.content),
            duration_ms=round((time.monotonic() - request_started) * 1000, 2),
        )
        try:
            raw = response.json()
        except ValueError:
            raw = None
            log_api_event(
                "carrier_response_parse_failed",
                level=40,
                carrier=carrier_name,
                http_status=response.status_code,
                response_bytes=len(response.content),
                error_code="INVALID_RESPONSE",
            )
        if response.status_code in (401, 403):
            raise QuoteError("AUTH_FAILED", f"Australia Post rejected authentication (HTTP {response.status_code}).")
        if response.status_code == 404:
            raise QuoteError("NOT_FOUND", "Australia Post price endpoint was not found.")
        if response.status_code == 429 or response.status_code >= 500:
            raise QuoteError("SERVICE_UNAVAILABLE", f"Australia Post price service returned HTTP {response.status_code}.")
        if response.status_code >= 400:
            messages = []
            if isinstance(raw, dict) and isinstance(raw.get("errors"), list):
                for error in raw["errors"][:3]:
                    if isinstance(error, dict) and error.get("message"):
                        messages.append(str(error["message"]))
            message = "; ".join(messages) or f"Australia Post rejected the rate request (HTTP {response.status_code})."
            for secret in (key, password, account):
                if secret:
                    message = message.replace(secret, "[redacted]")
            raise QuoteError("INVALID_REQUEST", message[:500])
        if not isinstance(raw, dict) or not isinstance(raw.get("shipments"), list):
            raise QuoteError("INVALID_RESPONSE", "Australia Post returned an unexpected quote response.")
        quotes = []
        for shipment in raw["shipments"]:
            summary = shipment.get("shipment_summary") if isinstance(shipment, dict) else None
            items = shipment.get("items") if isinstance(shipment, dict) else None
            item = items[0] if isinstance(items, list) and items and isinstance(items[0], dict) else {}
            if not isinstance(summary, dict) or summary.get("total_cost") is None:
                continue
            product_id = str(item.get("product_id") or "").strip()
            total = Decimal(str(summary["total_cost"])).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            gst = Decimal(str(summary.get("total_gst", "0"))).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            fuel = Decimal(str(summary.get("fuel_surcharge", "0"))).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            raw_base = summary.get("shipment_cost", summary.get("shipping_cost", summary.get("base_cost")))
            base = Decimal(str(raw_base)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP) if raw_base is not None else (total - fuel - gst).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            quote = {"quote_id": uuid4().hex, "product_id": product_id or None,
                "service_name": str(item.get("product_type") or item.get("service_name") or product_id or "Australia Post service"),
                "shipping_cost": f"{base:.2f}", "fuel_surcharge": f"{fuel:.2f}",
                "gst": f"{gst:.2f}", "total_cost": f"{total:.2f}", "currency": "AUD",
                "source": "Australia Post API", "order_no": data.get("order_no"), "shipment_id": data.get("shipment_id"),
                "shipping_account_profile_id": profile["id"],
                "shipping_account_label": profile["label"],
                "shipping_account_number_masked": _account_number_masked(account)}
            if data.get("planner_context") is not None:
                quote["planner_context"] = data["planner_context"]
            quotes.append(quote)
        if not quotes:
            raise QuoteError("NO_RATES", "Australia Post returned no usable rates for the supplied origin, destination and package details.")
        with _lock:
            now = time.monotonic()
            for quote in quotes:
                _quotes[quote["quote_id"]] = (now, quote)
        log_api_event("carrier_response_parsed", carrier=carrier_name, account_profile_id=account_profile_id, rate_count=len(quotes), http_status=response.status_code)
        log_api_event("shipping_rate_request_completed", carrier=carrier_name, account_profile_id=account_profile_id, rate_count=len(quotes), http_status=response.status_code, duration_ms=round((time.monotonic() - request_started) * 1000, 2))
        return quotes
    except QuoteError as error:
        upstream = locals().get("response")
        log_api_event("carrier_request_failed", level=40, carrier=carrier_name, account_profile_id=account_profile_id,
            http_status=upstream.status_code if upstream is not None else None,
            error_code=error.code, duration_ms=round((time.monotonic() - request_started) * 1000, 2))
        log_api_event("shipping_rate_request_failed", level=40, carrier=carrier_name, account_profile_id=account_profile_id,
            error_code=error.code, http_status=upstream.status_code if upstream is not None else None,
            duration_ms=round((time.monotonic() - request_started) * 1000, 2))
        raise
    except httpx.TimeoutException as error:
        log_api_event("carrier_request_failed", level=40, carrier=carrier_name, error_code="TIMEOUT", duration_ms=round((time.monotonic() - request_started) * 1000, 2))
        log_api_event("shipping_rate_request_failed", level=40, carrier=carrier_name, error_code="TIMEOUT", duration_ms=round((time.monotonic() - request_started) * 1000, 2))
        raise QuoteError("TIMEOUT", "Australia Post rate request timed out.") from error
    except httpx.ConnectError as error:
        tls = isinstance(error.__cause__, ssl.SSLCertVerificationError) or "CERTIFICATE_VERIFY_FAILED" in str(error).upper()
        code = "TLS_ERROR" if tls else "SERVICE_UNAVAILABLE"
        message = "Australia Post TLS certificate verification failed." if tls else "Australia Post rate service could not be reached."
        log_api_event("carrier_request_failed", level=40, carrier=carrier_name, error_code=code, duration_ms=round((time.monotonic() - request_started) * 1000, 2))
        log_api_event("shipping_rate_request_failed", level=40, carrier=carrier_name, error_code=code, duration_ms=round((time.monotonic() - request_started) * 1000, 2))
        raise QuoteError(code, message) from error
    except httpx.RequestError as error:
        log_api_event("carrier_request_failed", level=40, carrier=carrier_name, error_code="SERVICE_UNAVAILABLE", duration_ms=round((time.monotonic() - request_started) * 1000, 2))
        log_api_event("shipping_rate_request_failed", level=40, carrier=carrier_name, error_code="SERVICE_UNAVAILABLE", duration_ms=round((time.monotonic() - request_started) * 1000, 2))
        raise QuoteError("SERVICE_UNAVAILABLE", "Australia Post rate service could not be reached.") from error


def cached_quote(quote_id: str, *, order_no: str | None = None, shipment_id: int | None = None) -> dict:
    """读取 15 分钟内有效的报价，并按需核对其订单和 Shipment 归属。"""
    with _lock:
        entry = _quotes.get(quote_id)
    if not entry or time.monotonic() - entry[0] > 900:
        raise QuoteError("QUOTE_EXPIRED", "Quote expired; request rates again.")
    quote = entry[1]
    if order_no and quote.get("order_no") != order_no:
        raise QuoteError("QUOTE_MISMATCH", "Quote is not associated with this order.")
    if shipment_id and quote.get("shipment_id") != shipment_id:
        raise QuoteError("QUOTE_MISMATCH", "Quote is not associated with this shipment.")
    return quote


def invalidate_order_quotes(order_no: str) -> None:
    """目的地或包裹组成改变时，清理尚未应用的旧报价。"""
    with _lock:
        for quote_id, (_, quote) in list(_quotes.items()):
            if quote.get("order_no") == order_no:
                _quotes.pop(quote_id, None)
