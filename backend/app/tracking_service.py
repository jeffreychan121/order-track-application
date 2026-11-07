"""服务端 Australia Post / StarTrack 物流追踪集成。"""

from __future__ import annotations

import os
import re
import ssl
import time
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from threading import Lock
import httpx
from .logging_service import log_api_event

DEFAULT_BASE_URL = "https://digitalapi.auspost.com.au/test/shipping/v1"
REQUEST_TIMEOUT_SECONDS = 5
CACHE_SECONDS = 60


@dataclass(frozen=True)
class ArticleTrackingResult:
    article_id: str | None
    product_type: str | None
    raw_status: str | None
    status: str
    last_updated: str | None
    events: list[dict[str, str | None]] = field(default_factory=list)


@dataclass(frozen=True)
class TrackingResult:
    status: str
    raw_status: str | None = None
    last_updated: str | None = None
    error: str | None = None
    error_code: str | None = None
    events: list[dict[str, str | None]] = field(default_factory=list)
    articles: list[ArticleTrackingResult] = field(default_factory=list)

    @property
    def article_count(self) -> int:
        return len(self.articles)

    @property
    def delivered_article_count(self) -> int:
        return sum(article.status == "delivered" for article in self.articles)


_cache: dict[str, tuple[float, TrackingResult]] = {}
_cache_lock = Lock()
_request_times: deque[float] = deque()


def _unavailable(message: str, error_code: str | None = None) -> TrackingResult:
    return TrackingResult(
        status="unavailable",
        raw_status=None,
        error=message,
        error_code=error_code,
    )


def _sanitize_message(value: object) -> str:
    message = " ".join(str(value).split())
    message = re.sub(
        r"(?i)(authorization|password|api[-_ ]?key|account[-_ ]?number)\s*[:=]\s*[^,;\s]+",
        r"\1=<redacted>",
        message,
    )
    return message[:240]


def _api_error_message(payload: object) -> str | None:
    if not isinstance(payload, dict):
        return None
    errors = payload.get("errors")
    if not isinstance(errors, list):
        return None
    messages: list[str] = []
    for item in errors[:3]:
        if isinstance(item, dict):
            parts = [
                str(item[key]).strip()
                for key in ("code", "name", "message", "error_code", "error_name")
                if item.get(key)
            ]
            if parts:
                messages.append(" — ".join(parts))
        elif item:
            messages.append(str(item))
    return _sanitize_message("; ".join(messages)) if messages else None


def _events_for(result: dict) -> list[dict]:
    """仅读取整票级事件；各包裹商品的物流事件继续独立保留。"""
    consignment = result.get("consignment")
    events = consignment.get("events") if isinstance(consignment, dict) else None
    return [event for event in events if isinstance(event, dict)] if isinstance(events, list) else []


def _event_datetime(event: dict) -> datetime | None:
    value = event.get("date")
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed


def _normalized_tracking_events(events: list[dict]) -> list[dict[str, str | None]]:
    normalized: dict[tuple[str, str, str], tuple[datetime, dict[str, str | None]]] = {}
    for event in events:
        date = event.get("date")
        description = event.get("description")
        location = event.get("location")
        if not isinstance(date, str) or not date.strip():
            continue
        parsed_date = _event_datetime(event)
        if parsed_date is None:
            continue
        item = {
            "date": date,
            "description": _sanitize_message(description) if isinstance(description, str) and description.strip() else None,
            "location": _sanitize_message(location) if isinstance(location, str) and location.strip() else None,
        }
        key = (date, item["description"] or "", item["location"] or "")
        normalized[key] = (parsed_date, item)
    return [item for _, item in sorted(normalized.values(), key=lambda pair: pair[0], reverse=True)]


def _map_status(raw_status: str | None) -> str:
    if not isinstance(raw_status, str) or not raw_status.strip():
        return "unknown"
    value = raw_status.casefold().strip()
    if "partial" in value and "deliver" in value:
        return "partially_delivered"
    if any(token in value for token in ("transit", "onboard", "processed", "facility")):
        return "in_transit"
    if "deliver" in value:
        return "delivered"
    if any(token in value for token in ("shipping information", "pending", "created", "received")):
        return "pending"
    return "unknown"


def _derived_overall_status(articles: list[ArticleTrackingResult]) -> str:
    if not articles:
        return "unknown"
    delivered = sum(article.status == "delivered" for article in articles)
    if delivered == len(articles):
        return "delivered"
    if delivered:
        return "partially_delivered"
    for candidate in ("in_transit", "pending"):
        if any(article.status == candidate for article in articles):
            return candidate
    return "unknown"


def _article_tracking_result(value: object) -> ArticleTrackingResult | None:
    if not isinstance(value, dict):
        return None
    raw_status = value.get("status") if isinstance(value.get("status"), str) else None
    events = _normalized_tracking_events(
        [event for event in value.get("events", []) if isinstance(event, dict)]
        if isinstance(value.get("events"), list)
        else []
    )
    effective_status = raw_status
    if not effective_status and events:
        effective_status = events[0]["description"]
    last_updated = events[0]["date"] if events else None
    return ArticleTrackingResult(
        article_id=str(value["article_id"]) if value.get("article_id") is not None else None,
        product_type=str(value["product_type"]) if value.get("product_type") is not None else None,
        raw_status=raw_status,
        status=_map_status(effective_status),
        last_updated=last_updated,
        events=events,
    )


def _safe_event_summaries(result: dict) -> list[dict[str, str | None]]:
    """返回去重后的整票级事件，与接口对外暴露的数据保持一致。"""
    return _normalized_tracking_events(_events_for(result))


def _parse_tracking_result(payload: object, tracking_number: str) -> TrackingResult:
    if not isinstance(payload, dict):
        return _unavailable("Australia Post returned an unexpected response format.", "SERVICE_UNAVAILABLE")

    results = payload.get("tracking_results")
    if not isinstance(results, list):
        detail = _api_error_message(payload)
        return _unavailable(
            f"Australia Post returned an API error: {detail}"
            if detail
            else "Australia Post response did not contain tracking results.",
            "NOT_FOUND" if detail and any(t in detail.casefold() for t in ("not found", "invalid tracking")) else "SERVICE_UNAVAILABLE",
        )

    result = next(
        (
            item
            for item in results
            if isinstance(item, dict)
            and str(item.get("tracking_id", "")).casefold()
            == tracking_number.casefold()
        ),
        None,
    )
    if result is None:
        return _unavailable("Australia Post response did not include the requested tracking number.", "NOT_FOUND")

    detail = _api_error_message(result)
    if detail:
        code = "NOT_FOUND" if any(t in detail.casefold() for t in ("not found", "invalid tracking")) else "SERVICE_UNAVAILABLE"
        return _unavailable(f"Australia Post tracking error: {detail}", code)

    consignment = result.get("consignment")
    consignment = consignment if isinstance(consignment, dict) else {}
    raw_status = consignment.get("status") if isinstance(consignment.get("status"), str) else None
    consignment_events = _normalized_tracking_events(_events_for(result))
    article_values = result.get("trackable_items")
    articles = [
        article
        for item in (article_values if isinstance(article_values, list) else [])
        if (article := _article_tracking_result(item)) is not None
    ]

    status_source = raw_status
    if not status_source and consignment_events:
        status_source = consignment_events[0]["description"]
    status = _map_status(status_source)
    if status == "unknown" and not raw_status:
        status = _derived_overall_status(articles)

    all_events = consignment_events + [event for article in articles for event in article.events]
    latest = max(
        (event for event in all_events if _event_datetime(event)),
        key=lambda event: _event_datetime(event),
        default=None,
    )
    return TrackingResult(
        status=status,
        raw_status=raw_status,
        last_updated=latest["date"] if latest else None,
        events=consignment_events,
        articles=articles,
    )


def _get_tracking_result(
    carrier: str, tracking_number: str, refresh: bool = False
) -> TrackingResult:
    query_started = time.monotonic()
    log_api_event(
        "tracking_query_started",
        carrier=carrier,
        tracking_number=tracking_number,
        refresh=refresh,
    )
    normalized_carrier = carrier.casefold()
    if "tnt" in normalized_carrier:
        result = TrackingResult(
            status="not_implemented",
            error="TNT tracking is not implemented.",
        )
        log_api_event("tracking_query_completed", carrier=carrier, tracking_number=tracking_number, tracking_status=result.status, error_code=result.error_code, duration_ms=round((time.monotonic() - query_started) * 1000, 2))
        return result
    if "australia post" not in normalized_carrier and "startrack" not in normalized_carrier:
        result = TrackingResult(
            status="not_implemented",
            error="No tracking integration is configured for this carrier.",
        )
        log_api_event("tracking_query_completed", carrier=carrier, tracking_number=tracking_number, tracking_status=result.status, error_code=result.error_code, duration_ms=round((time.monotonic() - query_started) * 1000, 2))
        return result

    api_key = os.getenv("AUSTRALIA_POST_API_KEY", "").strip()
    password = os.getenv("AUSTRALIA_POST_API_PASSWORD", "").strip()
    # 追踪可选用独立账号；未配置时兼容旧共享账号，再回退到报价账号。
    account_number = (os.getenv("AUSTRALIA_POST_TRACKING_ACCOUNT_NUMBER") or os.getenv("AUSTRALIA_POST_ACCOUNT_NUMBER") or os.getenv("AUSTRALIA_POST_PRICING_ACCOUNT_NUMBER", "")).strip()
    base_url = os.getenv("AUSTRALIA_POST_BASE_URL", DEFAULT_BASE_URL).strip().rstrip("/")
    if not api_key or not password or not account_number:
        result = _unavailable(
            "Australia Post / StarTrack credentials are not configured in the local .env file.",
            "AUTH_FAILED",
        )
        log_api_event("tracking_query_completed", carrier=carrier, tracking_number=tracking_number, tracking_status=result.status, error_code=result.error_code, duration_ms=round((time.monotonic() - query_started) * 1000, 2))
        return result

    cache_key = "|".join((base_url, account_number, tracking_number))
    now = time.monotonic()
    with _cache_lock:
        cached = _cache.get(cache_key)
        if cached and now - cached[0] < CACHE_SECONDS and not refresh:
            log_api_event("tracking_cache_hit", carrier=carrier, tracking_number=tracking_number, tracking_status=cached[1].status)
            log_api_event(
                "tracking_query_completed",
                carrier=carrier,
                tracking_number=tracking_number,
                tracking_status=cached[1].status,
                error_code=cached[1].error_code,
                duration_ms=round((time.monotonic() - query_started) * 1000, 2),
                source="cache",
            )
            return cached[1]
        while _request_times and now - _request_times[0] >= 60:
            _request_times.popleft()
        if len(_request_times) >= 10:
            result = _unavailable(
                "A local request limit prevented a new tracking query; "
                "Australia Post allows up to 10 requests per minute.",
                "SERVICE_UNAVAILABLE",
            )
            log_api_event("tracking_query_completed", carrier=carrier, tracking_number=tracking_number, tracking_status=result.status, error_code=result.error_code, duration_ms=round((time.monotonic() - query_started) * 1000, 2))
            return result
        _request_times.append(now)

    request_started = time.monotonic()
    log_api_event(
        "carrier_request_started",
        carrier=carrier,
        method="GET",
        endpoint_path="/test/shipping/v1/track",
        tracking_number=tracking_number,
        timeout_seconds=REQUEST_TIMEOUT_SECONDS,
    )
    response = None
    try:
        response = httpx.get(
            f"{base_url}/track",
            params={"tracking_ids": tracking_number},
            auth=(api_key, password),
            headers={"account-number": account_number, "Accept": "application/json"},
            timeout=REQUEST_TIMEOUT_SECONDS,
            trust_env=True,
        )
        log_api_event(
            "carrier_response_received",
            carrier=carrier,
            tracking_number=tracking_number,
            http_status=response.status_code,
            duration_ms=round((time.monotonic() - request_started) * 1000, 2),
        )
        if response.status_code in (401, 403):
            result = _unavailable("Australia Post rejected the configured credentials or account.", "AUTH_FAILED")
        elif response.status_code == 404:
            result = _unavailable("Australia Post could not find the requested tracking resource.", "NOT_FOUND")
        elif response.status_code == 429 or response.status_code >= 500:
            result = _unavailable(f"Australia Post testbed returned HTTP {response.status_code}.", "SERVICE_UNAVAILABLE")
        else:
            response.raise_for_status()
            payload = response.json()
            result = _parse_tracking_result(payload, tracking_number)
            tracking_results = payload.get("tracking_results", []) if isinstance(payload, dict) else []
            matched = next((item for item in tracking_results if isinstance(item, dict) and str(item.get("tracking_id", "")).casefold() == tracking_number.casefold()), {}) if isinstance(tracking_results, list) else {}
            event_summaries = _safe_event_summaries(matched)
            log_api_event(
                "carrier_response_parsed",
                carrier=carrier,
                tracking_number=tracking_number,
                overall_status=result.status,
                overall_status_raw=result.raw_status,
                total_articles=result.article_count,
                delivered_articles=result.delivered_article_count,
                last_updated=result.last_updated,
                consignment_event_count=len(event_summaries),
            )
            if result.status == "unavailable" and result.error_code is None:
                result = _unavailable(result.error or "Tracking result unavailable.", "SERVICE_UNAVAILABLE")
    except httpx.TimeoutException:
        message = "Australia Post testbed request timed out after 5 seconds."
        result = _unavailable(message, "TIMEOUT")
    except httpx.ConnectError as error:
        if isinstance(error.__cause__, ssl.SSLCertVerificationError) or "CERTIFICATE_VERIFY_FAILED" in str(error).upper():
            message = "Australia Post TLS certificate verification failed; check the configured CA bundle and proxy chain."
            result = _unavailable(message, "TLS_ERROR")
        else:
            message = "Australia Post testbed could not be reached (connection failed)."
            result = _unavailable(message, "SERVICE_UNAVAILABLE")
    except httpx.HTTPStatusError as error:
        code = "NOT_FOUND" if error.response.status_code == 404 else "SERVICE_UNAVAILABLE"
        message = f"Australia Post testbed returned HTTP {error.response.status_code}."
        result = _unavailable(message, code)
    except ValueError:
        message = "Australia Post testbed returned invalid JSON."
        result = _unavailable(message, "SERVICE_UNAVAILABLE")
    except httpx.RequestError as error:
        message = f"Australia Post testbed request failed: {_sanitize_message(type(error).__name__)}"
        result = _unavailable(message, "SERVICE_UNAVAILABLE")

    if result.error_code:
        log_api_event(
            "carrier_request_failed",
            carrier=carrier,
            tracking_number=tracking_number,
            http_status=response.status_code if response is not None else None,
            error_code=result.error_code,
            duration_ms=round((time.monotonic() - request_started) * 1000, 2),
        )

    with _cache_lock:
        _cache[cache_key] = (time.monotonic(), result)
    log_api_event(
        "tracking_query_completed",
        carrier=carrier,
        tracking_number=tracking_number,
        tracking_status=result.status,
        error_code=result.error_code,
        duration_ms=round((time.monotonic() - query_started) * 1000, 2),
    )
    return result


def get_tracking_result(
    carrier: str, tracking_number: str, refresh: bool = False
) -> TrackingResult:
    """每次只查询一个运单号，避免混用 Australia Post 与 StarTrack 的编号。"""

    return _get_tracking_result(carrier, tracking_number, refresh=refresh)
