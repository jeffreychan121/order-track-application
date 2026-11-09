"""从已保存的订单和持久化追踪快照中读取物流信息。"""

from __future__ import annotations

import json
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from . import database
from .database import OrderRow, ShipmentRow, ShipmentTrackingSnapshotRow
from .logging_service import get_stack_frames, log_api_event
from .models import ShipmentTrackingResponse
from .tracking_service import TrackingResult, get_tracking_result

TRACKING_FRESHNESS = timedelta(minutes=15)
TRACKING_FAILURE_RETRY_DELAY = timedelta(seconds=60)


def _utc_now() -> datetime:
    """返回带时区的 UTC 时间，避免 SQLite 的本地时区歧义。"""
    return datetime.now(timezone.utc)


def _parse_timestamp(value: str | None) -> datetime | None:
    """解析数据库中的 ISO 时间；旧值或损坏值不影响订单详情读取。"""
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed


def _event_predates_order(events: list[dict[str, str | None]], order_date: date) -> bool:
    """检测上游追踪事件是否早于订单日期，用于标记可能的测试数据错配。"""
    for event in events:
        value = event.get("date")
        if not value:
            continue
        try:
            event_date = datetime.fromisoformat(value.replace("Z", "+00:00")).date()
        except ValueError:
            continue
        if event_date < order_date:
            return True
    return False


def _identity_matches(snapshot: ShipmentTrackingSnapshotRow | None, carrier: str, tracking_number: str) -> bool:
    """确保快照属于当前承运商和运单号，避免编辑运单后显示旧物流。"""
    return bool(snapshot and snapshot.carrier.casefold().strip() == carrier.casefold().strip()
                and snapshot.tracking_number.strip() == tracking_number.strip())


def _should_refresh(snapshot: ShipmentTrackingSnapshotRow | None, carrier: str,
                    tracking_number: str, force: bool) -> bool:
    """首次访问及过期访问自动查询；短暂失败设冷却，防止页面反复冲击承运商。"""
    if force or not _identity_matches(snapshot, carrier, tracking_number):
        return True

    now = _utc_now()
    last_attempt = _parse_timestamp(snapshot.last_attempt_at)
    if snapshot.last_attempt_status in {"failed", "not_implemented"} and last_attempt:
        if now - last_attempt < TRACKING_FAILURE_RETRY_DELAY:
            return False

    last_success = _parse_timestamp(snapshot.last_successful_query_at)
    if last_success is None:
        return True
    return now - last_success >= TRACKING_FRESHNESS


def _result_payload(result: TrackingResult) -> dict:
    """把统一追踪结果转为可持久化 JSON，整票和单个 article 事件分别保留。"""
    return {
        "consignment_events": result.events,
        "articles": [{
            "article_id": article.article_id,
            "product_type": article.product_type,
            "raw_status": article.raw_status,
            "status": article.status,
            "last_updated": article.last_updated,
            "events": article.events,
        } for article in result.articles],
    }


def _is_success(result: TrackingResult) -> bool:
    """空事件但格式有效的响应仍是成功查询；不可用或未实现不覆盖旧快照。"""
    return result.error_code is None and result.status not in {"unavailable", "not_implemented"}


def _call_carrier(carrier: str, tracking_number: str, integration_type: str) -> TrackingResult:
    """隔离单票适配器异常，让其他 Shipment 继续处理并保留可诊断日志。"""
    # 不能根据历史承运商显示名称猜接口；只有明确配置 Australia Post 集成的记录才会出网。
    if integration_type != "AUSTRALIA_POST":
        message = "TNT tracking is not implemented." if "tnt" in carrier.casefold() else "No tracking integration is configured for this carrier."
        return TrackingResult(status="not_implemented", error=message, error_code="NOT_IMPLEMENTED")
    try:
        result = get_tracking_result(carrier, tracking_number, refresh=True)
        if not isinstance(result, TrackingResult):
            raise TypeError("Tracking adapter returned an unsupported result type")
        return result
    except Exception as error:
        log_api_event(
            "tracking_adapter_unhandled_error",
            level=40,
            carrier=carrier,
            tracking_number=tracking_number,
            error_type=type(error).__name__,
            stack_frames=get_stack_frames(error),
        )
        return TrackingResult(
            status="unavailable",
            error="The tracking provider could not complete this request. Try again later.",
            error_code="SERVICE_UNAVAILABLE",
        )


def _store_attempt(shipment_id: int, carrier: str, tracking_number: str,
                   result: TrackingResult) -> None:
    """保存最近一次查询状态；失败时保留同一运单最近一次成功数据。"""
    now = _utc_now().isoformat()
    succeeded = _is_success(result)
    attempt_status = "success" if succeeded else (
        "not_implemented" if result.status == "not_implemented" else "failed"
    )
    error_code = None if succeeded else (result.error_code or ("NOT_IMPLEMENTED" if result.status == "not_implemented" else "SERVICE_UNAVAILABLE"))
    error_message = None if succeeded else (result.error or "Tracking information is currently unavailable.")

    with database.SessionLocal() as session:
        shipment = session.get(ShipmentRow, shipment_id)
        # 运单可能在 API 请求期间被编辑或删除；不把旧结果写入新运单。
        if shipment is None or shipment.carrier.casefold().strip() != carrier.casefold().strip() \
                or (shipment.tracking_number or "").strip() != tracking_number.strip():
            log_api_event("tracking_snapshot_write_skipped", shipment_id=shipment_id,
                          carrier=carrier, tracking_number=tracking_number,
                          reason="shipment_changed_during_request")
            return

        snapshot = session.scalar(select(ShipmentTrackingSnapshotRow).where(
            ShipmentTrackingSnapshotRow.shipment_id == shipment_id
        ))
        if snapshot is None:
            snapshot = ShipmentTrackingSnapshotRow(
                shipment_id=shipment_id,
                carrier=carrier,
                tracking_number=tracking_number,
                overall_status="not_queried",
                result_json=json.dumps({"consignment_events": [], "articles": []}),
            )
            session.add(snapshot)
        elif not _identity_matches(snapshot, carrier, tracking_number):
            # 当前运单已变化时清空旧身份下的数据，失败时也不能沿用旧包裹事件。
            snapshot.carrier = carrier
            snapshot.tracking_number = tracking_number
            snapshot.overall_status = "not_queried"
            snapshot.overall_status_raw = None
            snapshot.total_articles = None
            snapshot.delivered_articles = None
            snapshot.last_updated = None
            snapshot.result_json = json.dumps({"consignment_events": [], "articles": []})
            snapshot.last_successful_query_at = None
            snapshot.last_attempt_at = None
            snapshot.last_attempt_status = None
            snapshot.last_error_code = None
            snapshot.last_error = None

        snapshot.last_attempt_at = now
        snapshot.last_attempt_status = attempt_status
        snapshot.last_error_code = error_code
        snapshot.last_error = error_message
        if succeeded:
            snapshot.overall_status = result.status
            snapshot.overall_status_raw = result.raw_status
            snapshot.total_articles = result.article_count
            snapshot.delivered_articles = result.delivered_article_count
            snapshot.last_updated = result.last_updated
            snapshot.result_json = json.dumps(_result_payload(result), ensure_ascii=False, separators=(",", ":"))
            snapshot.last_successful_query_at = now
        elif snapshot.last_successful_query_at is None:
            # 首次查询失败时明确显示不可用/未实现，而不是误标为“尚未查询”。
            snapshot.overall_status = result.status
            snapshot.overall_status_raw = result.raw_status
            snapshot.total_articles = None
            snapshot.delivered_articles = None
            snapshot.last_updated = None

        session.commit()

    log_api_event(
        "tracking_snapshot_saved" if succeeded else "tracking_snapshot_refresh_failed",
        shipment_id=shipment_id,
        carrier=carrier,
        tracking_number=tracking_number,
        tracking_status=result.status,
        query_status=attempt_status,
        error_code=error_code,
        preserved_previous_success=not succeeded,
    )


def _response_from_snapshot(group: str, carrier: str, tracking_number: str,
                            order_date: date,
                            snapshot: ShipmentTrackingSnapshotRow | None) -> ShipmentTrackingResponse:
    """将持久化快照转换成 API DTO，并明确区分最后事件时间与最近查询时间。"""
    if not _identity_matches(snapshot, carrier, tracking_number):
        return ShipmentTrackingResponse(
            tracking_group=group,
            carrier=carrier,
            tracking_number=tracking_number,
            overall_status="not_queried",
        )

    assert snapshot is not None
    try:
        payload = json.loads(snapshot.result_json or "{}")
        if not isinstance(payload, dict):
            raise ValueError("snapshot is not an object")
    except (TypeError, ValueError):
        log_api_event("tracking_snapshot_invalid_json", level=40, shipment_id=snapshot.shipment_id)
        payload = {}
    raw_events = payload.get("consignment_events") if isinstance(payload.get("consignment_events"), list) else []
    events = [event for event in raw_events if isinstance(event, dict) and isinstance(event.get("date"), str)]
    raw_articles = payload.get("articles") if isinstance(payload.get("articles"), list) else []
    articles = [article for article in raw_articles if isinstance(article, dict)]
    for article in articles:
        article_events = article.get("events") if isinstance(article.get("events"), list) else []
        article["events"] = [event for event in article_events if isinstance(event, dict) and isinstance(event.get("date"), str)]
    last_success = _parse_timestamp(snapshot.last_successful_query_at)
    has_success = last_success is not None
    stale = bool(has_success and (
        snapshot.last_attempt_status in {"failed", "not_implemented"}
        or (last_success and _utc_now() - last_success >= TRACKING_FRESHNESS)
    ))
    return ShipmentTrackingResponse(
        tracking_group=group,
        carrier=carrier,
        tracking_number=tracking_number,
        overall_status=snapshot.overall_status,
        overall_status_raw=snapshot.overall_status_raw,
        total_articles=snapshot.total_articles,
        delivered_articles=snapshot.delivered_articles,
        last_updated=snapshot.last_updated,
        consignment_events=events,
        articles=articles,
        test_data_time_mismatch=_event_predates_order(events + [event for article in articles if isinstance(article, dict)
            for event in (article.get("events") if isinstance(article.get("events"), list) else [])], order_date),
        tracking_error=snapshot.last_error,
        tracking_error_code=snapshot.last_error_code,
        tracking_query_status=snapshot.last_attempt_status or "not_queried",
        tracking_last_attempt_at=snapshot.last_attempt_at,
        tracking_last_successful_at=snapshot.last_successful_query_at,
        tracking_stale=stale,
    )


def _load_snapshots(session, shipment_ids: list[int]) -> dict[int, ShipmentTrackingSnapshotRow]:
    """批量读取订单内快照，避免按 Shipment 重复查询数据库。"""
    if not shipment_ids:
        return {}
    rows = session.scalars(select(ShipmentTrackingSnapshotRow).where(
        ShipmentTrackingSnapshotRow.shipment_id.in_(shipment_ids)
    )).all()
    return {row.shipment_id: row for row in rows}


def _query_and_read(shipment_id: int, group: str, carrier: str, integration_type: str,
                    tracking_number: str,
                    order_date: date) -> ShipmentTrackingResponse:
    """强制请求单票后持久化；若记录期间运单变化，返回当前数据库可用快照。"""
    result = _call_carrier(carrier, tracking_number, integration_type)
    _store_attempt(shipment_id, carrier, tracking_number, result)
    with database.SessionLocal() as session:
        snapshot = session.scalar(select(ShipmentTrackingSnapshotRow).where(
            ShipmentTrackingSnapshotRow.shipment_id == shipment_id
        ))
        current = session.get(ShipmentRow, shipment_id)
        if current is None:
            return ShipmentTrackingResponse(
                tracking_group=group, carrier=carrier,
                tracking_number=tracking_number, overall_status="not_queried",
            )
        return _response_from_snapshot(
            current.tracking_group or group,
            current.carrier,
            current.tracking_number or "",
            order_date,
            snapshot,
        )


def get_order_tracking(order_no: str, refresh: bool = False) -> list[ShipmentTrackingResponse] | None:
    """返回持久化物流快照；首次访问、超过 15 分钟或显式刷新时查询承运商。"""
    with database.SessionLocal() as session:
        order = session.scalar(select(OrderRow).where(OrderRow.order_no == order_no).options(
            selectinload(OrderRow.shipments).selectinload(ShipmentRow.carrier_record)
        ))
        if order is None:
            return None
        order_date = order.order_date
        shipments = [{
            "id": shipment.id,
            "group": shipment.tracking_group or f"Shipment {shipment.id}",
            "carrier": shipment.carrier,
            "integration_type": shipment.carrier_record.integration_type if shipment.carrier_record else "NONE",
            "tracking_number": (shipment.tracking_number or "").strip(),
        } for shipment in order.shipments]
        snapshots = _load_snapshots(session, [item["id"] for item in shipments])

    results: list[ShipmentTrackingResponse] = []
    for shipment in shipments:
        tracking_number = shipment["tracking_number"]
        if not tracking_number:
            continue
        snapshot = snapshots.get(shipment["id"])
        if _should_refresh(snapshot, shipment["carrier"], tracking_number, refresh):
            response = _query_and_read(
                shipment["id"], shipment["group"], shipment["carrier"],
                shipment["integration_type"], tracking_number, order_date,
            )
        else:
            response = _response_from_snapshot(
                shipment["group"], shipment["carrier"], tracking_number,
                order_date, snapshot,
            )
        results.append(response)
    return results


def refresh_shipment_tracking(shipment_id: int) -> ShipmentTrackingResponse | None:
    """显式刷新单个 Shipment；查询错误会作为结果返回并保留上一次成功快照。"""
    with database.SessionLocal() as session:
        shipment = session.get(ShipmentRow, shipment_id)
        if shipment is None:
            return None
        order_date = shipment.order.order_date
        group = shipment.tracking_group or f"Shipment {shipment.id}"
        carrier = shipment.carrier
        integration_type = shipment.carrier_record.integration_type if shipment.carrier_record else "NONE"
        tracking_number = (shipment.tracking_number or "").strip()
        if not tracking_number:
            return ShipmentTrackingResponse(
                tracking_group=group,
                carrier=carrier,
                tracking_number="",
                overall_status="not_queried",
            )
    return _query_and_read(shipment_id, group, carrier, integration_type, tracking_number, order_date)
