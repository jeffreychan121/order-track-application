from fastapi import APIRouter, HTTPException, Query

from .. import db_service
from ..data_service import get_order_tracking
from ..models import CreateOrderInput, OrderDetailResponse, ShipmentTrackingResponse

router = APIRouter(tags=["OMS"])


def _business_error(error: Exception) -> HTTPException:
    if isinstance(error, LookupError):
        return HTTPException(status_code=404, detail=str(error))
    return HTTPException(status_code=422, detail=str(error))


@router.get("/api/health")
def health():
    return {"status": "ok", "database": "sqlite"}


@router.get("/api/products")
@router.get("/api/orders/products", include_in_schema=False)
def list_products(search: str | None = Query(default=None)):
    return db_service.list_products(search)


@router.post("/api/products", status_code=201)
def create_product(payload: dict):
    try:
        return db_service.create_product(payload)
    except FileExistsError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except db_service.BusinessError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@router.get("/api/products/{sku}")
def product_detail(sku: str):
    product = db_service.get_product(sku)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    return product


@router.patch("/api/products/{sku}")
def update_product(sku: str, payload: dict):
    """更新商品目录资料；金额校验和历史订单快照由业务服务负责。"""
    try:
        return db_service.update_product(sku, payload)
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except db_service.BusinessError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@router.delete("/api/products/{sku}", status_code=204)
def delete_product(sku: str):
    """删除未被订单引用的商品；被引用时保留数据并返回冲突状态。"""
    try:
        db_service.delete_product(sku)
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except db_service.BusinessError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@router.get("/api/orders", response_model=list[OrderDetailResponse])
def list_orders(search: str | None = None, status: str | None = None, sort_by: str = "date"):
    return db_service.list_orders(search=search, status=status, sort_by=sort_by)


@router.post("/api/orders", response_model=OrderDetailResponse, status_code=201)
def create_order(payload: CreateOrderInput):
    try:
        return db_service.create_order(payload)
    except db_service.BusinessError as error:
        raise _business_error(error) from error


@router.get("/api/orders/{order_id}", response_model=OrderDetailResponse)
def read_order(order_id: str):
    order = db_service.get_order(order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    return order


@router.patch("/api/orders/{order_id}", response_model=OrderDetailResponse)
def update_order(order_id: str, payload: dict):
    try:
        return db_service.update_draft(order_id, payload)
    except (db_service.BusinessError, LookupError) as error:
        raise _business_error(error) from error


@router.patch("/api/orders/{order_id}/status", response_model=OrderDetailResponse)
def change_status(order_id: str, payload: dict):
    target = str(payload.get("status", ""))
    try:
        return db_service.transition_status(order_id, target)
    except (db_service.BusinessError, LookupError) as error:
        raise _business_error(error) from error


@router.post("/api/orders/{order_id}/shipments", response_model=OrderDetailResponse)
def create_shipment(order_id: str, payload: dict):
    try:
        return db_service.add_shipment(order_id, payload)
    except (db_service.BusinessError, LookupError) as error:
        raise _business_error(error) from error


@router.patch("/api/shipments/{shipment_id}")
def update_shipment(shipment_id: int, payload: dict):
    try:
        return db_service.patch_shipment(shipment_id, payload)
    except (db_service.BusinessError, LookupError) as error:
        raise _business_error(error) from error


@router.delete("/api/shipments/{shipment_id}", status_code=204)
def delete_shipment(shipment_id: int):
    try:
        db_service.delete_shipment(shipment_id)
    except (db_service.BusinessError, LookupError) as error:
        raise _business_error(error) from error


@router.post("/api/orders/tracking", response_model=ShipmentTrackingResponse)
def query_tracking(payload: dict):
    carrier = str(payload.get("carrier", "")).strip()
    tracking_number = str(payload.get("tracking_number", "")).strip()
    if not carrier or not tracking_number:
        raise HTTPException(status_code=422, detail="Carrier and tracking number are required")
    result = __import__("app.tracking_service", fromlist=["get_tracking_result"]).get_tracking_result(carrier, tracking_number, refresh=True)
    return _tracking_dto(result, carrier, tracking_number, "Manual query")


def _tracking_dto(result, carrier: str, tracking_number: str, tracking_group: str):
    return ShipmentTrackingResponse(
        tracking_group=tracking_group, carrier=carrier, tracking_number=tracking_number,
        overall_status=result.status, overall_status_raw=result.raw_status,
        total_articles=result.article_count if result.error_code is None else None,
        delivered_articles=result.delivered_article_count if result.error_code is None else None,
        last_updated=result.last_updated, consignment_events=result.events,
        articles=[{"article_id": a.article_id, "product_type": a.product_type, "raw_status": a.raw_status,
                  "status": a.status, "last_updated": a.last_updated, "events": a.events} for a in result.articles],
        tracking_error=result.error, tracking_error_code=result.error_code)


@router.get("/api/orders/{order_id}/tracking", response_model=list[ShipmentTrackingResponse])
def read_order_tracking(order_id: str, refresh: bool = False):
    try:
        result = get_order_tracking(order_id, refresh=refresh)
    except Exception as error:
        raise HTTPException(status_code=500, detail="Tracking lookup failed") from error
    if result is None:
        raise HTTPException(status_code=404, detail="Order not found")
    return result
