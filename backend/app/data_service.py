"""从已保存的订单和 Shipment 记录中读取物流信息。"""

from datetime import date, datetime

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from . import database
from .database import OrderRow
from .models import ShipmentTrackingResponse
from .tracking_service import get_tracking_result


def _event_predates_order(events: list[dict[str, str | None]], order_date: date) -> bool:
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


def get_order_tracking(order_no: str, refresh: bool = False) -> list[ShipmentTrackingResponse] | None:
    with database.SessionLocal() as session:
        order = session.scalar(select(OrderRow).where(OrderRow.order_no == order_no).options(selectinload(OrderRow.shipments)))
        if order is None:
            return None
        order_date = order.order_date
        shipments = [(s.tracking_group or f"Shipment {s.id}", s.carrier, s.tracking_number or "") for s in order.shipments]

    results = []
    for group, carrier, tracking_number in shipments:
        if not tracking_number:
            continue
        result = get_tracking_result(carrier, tracking_number, refresh=refresh)
        results.append(ShipmentTrackingResponse(
            tracking_group=group, carrier=carrier, tracking_number=tracking_number,
            overall_status=result.status, overall_status_raw=result.raw_status,
            total_articles=result.article_count if result.error_code is None and result.status != "not_implemented" else None,
            delivered_articles=result.delivered_article_count if result.error_code is None and result.status != "not_implemented" else None,
            last_updated=result.last_updated, consignment_events=result.events,
            articles=[{"article_id": article.article_id, "product_type": article.product_type,
                "raw_status": article.raw_status, "status": article.status, "last_updated": article.last_updated,
                "events": article.events} for article in result.articles],
            test_data_time_mismatch=_event_predates_order(
                result.events + [event for article in result.articles for event in article.events], order_date),
            tracking_error=result.error, tracking_error_code=result.error_code,
        ))
    return results
