from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query

from .. import db_service
from ..data_service import get_order_tracking, refresh_shipment_tracking as refresh_saved_shipment_tracking
from ..logging_service import get_stack_frames, log_api_event
from ..models import CreateOrderInput, OrderDetailResponse, ShipmentTrackingResponse
from ..tracking_service import TrackingResult, get_tracking_result

router = APIRouter(tags=["OMS"])


def _business_error(error: Exception) -> HTTPException:
    """把业务层的资源不存在与输入/状态错误映射成稳定的 HTTP 状态码。"""
    if isinstance(error, LookupError):
        return HTTPException(status_code=404, detail=str(error))
    return HTTPException(status_code=422, detail=str(error))


@router.get("/api/health")
def health():
    """提供本地 API 存活探针；不在此接口执行数据库写入。"""
    return {"status": "ok", "database": "sqlite"}


@router.get("/api/products")
@router.get("/api/orders/products", include_in_schema=False)
def list_products(search: str | None = Query(default=None)):
    """按 SKU、名称或描述查询商品；旧商品查询路径复用此处理函数。"""
    return db_service.list_products(search)


@router.post("/api/products", status_code=201)
def create_product(payload: dict):
    """创建商品并区分重复 SKU 与商品字段校验错误。"""
    try:
        return db_service.create_product(payload)
    except FileExistsError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except db_service.BusinessError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@router.get("/api/products/{sku}")
def product_detail(sku: str):
    """按 SKU 返回商品；找不到时使用统一的 404 响应。"""
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
    """按条件读取订单及其汇总，筛选与排序由持久化服务完成。"""
    return db_service.list_orders(search=search, status=status, sort_by=sort_by)


@router.post("/api/orders", response_model=OrderDetailResponse, status_code=201)
def create_order(payload: CreateOrderInput):
    """创建订单；模型校验先执行，服务层业务错误再转换为 HTTP 错误。"""
    try:
        return db_service.create_order(payload)
    except db_service.BusinessError as error:
        raise _business_error(error) from error


@router.get("/api/orders/{order_id}", response_model=OrderDetailResponse)
def read_order(order_id: str):
    """读取订单详情，响应包含订单行、Shipment 与金额汇总。"""
    order = db_service.get_order(order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    return order


@router.patch("/api/orders/{order_id}", response_model=OrderDetailResponse)
def update_order(order_id: str, payload: dict):
    """更新草稿订单；非草稿订单的修改由业务层拒绝。"""
    try:
        return db_service.update_draft(order_id, payload)
    except (db_service.BusinessError, LookupError) as error:
        raise _business_error(error) from error


@router.patch("/api/orders/{order_id}/status", response_model=OrderDetailResponse)
def change_status(order_id: str, payload: dict):
    """请求订单状态迁移，合法路径与前置条件统一由业务层验证。"""
    target = str(payload.get("status", ""))
    try:
        return db_service.transition_status(order_id, target)
    except (db_service.BusinessError, LookupError) as error:
        raise _business_error(error) from error


@router.post("/api/orders/{order_id}/shipments", response_model=OrderDetailResponse)
def create_shipment(order_id: str, payload: dict):
    """为草稿订单新增 Shipment，并允许同时分配现有订单行。"""
    try:
        return db_service.add_shipment(order_id, payload)
    except (db_service.BusinessError, LookupError) as error:
        raise _business_error(error) from error


@router.patch("/api/shipments/{shipment_id}")
def update_shipment(shipment_id: int, payload: dict):
    """更新 Shipment；可编辑字段由当前订单状态约束。"""
    try:
        return db_service.patch_shipment(shipment_id, payload)
    except (db_service.BusinessError, LookupError) as error:
        raise _business_error(error) from error


@router.delete("/api/shipments/{shipment_id}", status_code=204)
def delete_shipment(shipment_id: int):
    """删除草稿订单中的 Shipment，并保留未分配的订单行。"""
    try:
        db_service.delete_shipment(shipment_id)
    except (db_service.BusinessError, LookupError) as error:
        raise _business_error(error) from error


@router.post("/api/orders/tracking", response_model=ShipmentTrackingResponse)
def query_tracking(payload: dict):
    """手动查询单个运单号；此入口强制刷新，不读取缓存结果。"""
    carrier = str(payload.get("carrier", "")).strip()
    tracking_number = str(payload.get("tracking_number", "")).strip()
    if not carrier or not tracking_number:
        raise HTTPException(status_code=422, detail="Carrier and tracking number are required")
    try:
        result = get_tracking_result(carrier, tracking_number, refresh=True)
        if not isinstance(result, TrackingResult):
            raise TypeError("Tracking adapter returned an unsupported result type")
    except Exception as error:
        log_api_event(
            "manual_tracking_query_unhandled_error",
            level=40,
            carrier=carrier,
            tracking_number=tracking_number,
            error_type=type(error).__name__,
            stack_frames=get_stack_frames(error),
        )
        result = TrackingResult(
            status="unavailable",
            error="The tracking provider could not complete this request. Try again later.",
            error_code="SERVICE_UNAVAILABLE",
        )
    return _tracking_dto(result, carrier, tracking_number, "Manual query")


@router.post("/api/shipments/{shipment_id}/tracking", response_model=ShipmentTrackingResponse)
def refresh_shipment_tracking(shipment_id: int):
    """显式刷新已保存 Shipment，并将成功结果或失败诊断写入 SQLite。"""
    try:
        result = refresh_saved_shipment_tracking(shipment_id)
    except Exception as error:
        log_api_event(
            "shipment_tracking_refresh_failed",
            level=40,
            shipment_id=shipment_id,
            error_type=type(error).__name__,
            stack_frames=get_stack_frames(error),
        )
        raise HTTPException(status_code=500, detail="Shipment tracking refresh failed") from error
    if result is None:
        raise HTTPException(status_code=404, detail="Shipment not found")
    return result


def _tracking_dto(result, carrier: str, tracking_number: str, tracking_group: str):
    """将适配器结果转换为 OMS 对外的统一追踪响应结构。"""
    queried_at = datetime.now(timezone.utc).isoformat()
    return ShipmentTrackingResponse(
        tracking_group=tracking_group, carrier=carrier, tracking_number=tracking_number,
        overall_status=result.status, overall_status_raw=result.raw_status,
        total_articles=result.article_count if result.error_code is None and result.status != "not_implemented" else None,
        delivered_articles=result.delivered_article_count if result.error_code is None and result.status != "not_implemented" else None,
        last_updated=result.last_updated, consignment_events=result.events,
        articles=[{"article_id": a.article_id, "product_type": a.product_type, "raw_status": a.raw_status,
                  "status": a.status, "last_updated": a.last_updated, "events": a.events} for a in result.articles],
        tracking_error=result.error, tracking_error_code=result.error_code,
        tracking_query_status=("not_implemented" if result.status == "not_implemented"
                               else "failed" if result.error_code or result.status == "unavailable" else "success"),
        tracking_last_attempt_at=queried_at,
        tracking_last_successful_at=(queried_at if not result.error_code and result.status not in {"unavailable", "not_implemented"} else None),
        tracking_stale=False)


@router.get("/api/orders/{order_id}/tracking", response_model=list[ShipmentTrackingResponse])
def read_order_tracking(order_id: str, refresh: bool = False):
    """查询订单下已有运单；单票查询异常会记录调用帧并返回通用错误。"""
    try:
        result = get_order_tracking(order_id, refresh=refresh)
    except Exception as error:
        log_api_event(
            "tracking_lookup_failed",
            level=40,
            order_id=order_id,
            error_type=type(error).__name__,
            stack_frames=get_stack_frames(error),
        )
        raise HTTPException(status_code=500, detail="Tracking lookup failed") from error
    if result is None:
        raise HTTPException(status_code=404, detail="Order not found")
    return result
