from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from decimal import Decimal

from .. import db_service
from .. import database
from ..database import CarrierRow, OrderLineRow, OrderRow
from ..models import ApplyQuoteInput, PlannedShipmentInput, ShippingQuotePreviewInput, ShippingRateInput
from ..shipping_service import (
    QuoteError, cached_quote, get_pricing_account_products, get_rates,
    get_shipping_account_descriptor, get_shipping_accounts,
)

router = APIRouter(prefix="/api/shipping", tags=["Shipping"])


@router.get("/accounts")
def shipping_accounts():
    """返回服务端配置的报价账号档案，不向浏览器暴露账号原值或凭据。"""
    try:
        return get_shipping_accounts()
    except QuoteError as error:
        raise HTTPException(status_code=500, detail={"code": error.code, "message": str(error)}) from error


@router.get("/accounts/{profile_id}/products")
def account_products(profile_id: str, refresh: bool = Query(default=False)):
    """读取指定服务端报价账号的合同邮寄产品，浏览器只传档案 ID。"""
    try:
        return get_pricing_account_products(profile_id, refresh=refresh)
    except QuoteError as error:
        status = 404 if error.code == "ACCOUNT_NOT_AVAILABLE" else 502
        raise HTTPException(status_code=status, detail={"code": error.code, "message": str(error)}) from error


@router.get("/account-products")
def pricing_account_products(account_id: str | None = Query(default=None), refresh: bool = Query(default=False)):
    """保留旧路径兼容，同时允许选择服务端配置的账号档案。"""
    try:
        return get_pricing_account_products(account_id, refresh=refresh)
    except QuoteError as error:
        status = 404 if error.code == "ACCOUNT_NOT_AVAILABLE" else 502
        raise HTTPException(status_code=status, detail={"code": error.code, "message": str(error)}) from error


@router.post("/rates")
def quote_shipping(payload: ShippingRateInput):
    """查询报价前校验承运商适配器，防止把 TNT 或未知承运商发给 Australia Post。"""
    carrier_name = "Australia Post"
    if payload.carrier_id is not None:
        with database.SessionLocal() as session:
            carrier = session.get(CarrierRow, payload.carrier_id)
            if not carrier:
                raise HTTPException(status_code=404, detail="Carrier not found")
            if not carrier.is_active:
                raise HTTPException(status_code=422, detail="This carrier is inactive")
            if carrier.code == "TNT":
                raise HTTPException(status_code=501, detail={"code": "NOT_IMPLEMENTED", "message": "TNT rate service is not implemented."})
            if carrier.integration_type != "AUSTRALIA_POST":
                raise HTTPException(status_code=501, detail={"code": "NOT_IMPLEMENTED", "message": f"No rate adapter is configured for {carrier.name}."})
            carrier_name = carrier.name
    data = payload.model_dump(mode="json")
    data["carrier"] = carrier_name
    try:
        return {"rates": get_rates(data)}
    except QuoteError as error:
        raise HTTPException(status_code=502, detail={"code": error.code, "message": str(error)}) from error


@router.post("/shipments/{shipment_id}/apply-rate")
def apply_rate(shipment_id: int, payload: ApplyQuoteInput):
    """只接受与目标 Shipment 绑定的缓存报价，并保存其运费快照。"""
    try:
        quote = cached_quote(payload.quote_id, shipment_id=shipment_id)
        return db_service.apply_shipping_quote(shipment_id, quote)
    except QuoteError as error:
        raise HTTPException(status_code=422, detail={"code": error.code, "message": str(error)}) from error
    except (db_service.BusinessError, LookupError) as error:
        status = 404 if isinstance(error, LookupError) else 422
        raise HTTPException(status_code=status, detail=str(error)) from error


@router.post("/orders/{order_no}/quotes/preview")
def preview_order_quote(order_no: str, payload: ShippingQuotePreviewInput):
    """预览草稿订单的 Shipment 报价，并校验分配、重量和承运商约束。"""
    plan = payload.model_dump(mode="json", exclude={"shipment_id"})
    with database.SessionLocal() as session:
        order = session.scalar(select(OrderRow).where(OrderRow.order_no == order_no))
        if not order:
            raise HTTPException(status_code=404, detail="Order not found")
        if order.status != "draft":
            raise HTTPException(status_code=422, detail="Shipping plans can only be changed while the order is draft")
        carrier = session.get(CarrierRow, payload.carrier_id)
        if not carrier:
            raise HTTPException(status_code=404, detail="Carrier not found")
        if not carrier.is_active:
            raise HTTPException(status_code=422, detail="This carrier is inactive")
        # TNT 尚未接通；其余能力标记只作展示元数据，适配器由 integration_type 决定。
        if carrier.code == "TNT":
            raise HTTPException(status_code=501, detail={"code": "NOT_IMPLEMENTED", "message": "TNT rate service is not implemented."})
        if carrier.integration_type != "AUSTRALIA_POST":
            raise HTTPException(status_code=501, detail={"code": "NOT_IMPLEMENTED", "message": f"No rate adapter is configured for {carrier.name}."})
        order_row = session.scalar(select(OrderRow).where(OrderRow.order_no == order_no).options(
            selectinload(OrderRow.lines).selectinload(OrderLineRow.product),
            selectinload(OrderRow.lines).selectinload(OrderLineRow.shipments)))
        try:
            net_weight_g = db_service.product_weight_for_lines(session, order_row, payload.order_line_ids,
                allowed_shipment_id=payload.shipment_id)
        except db_service.BusinessError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        gross_weight_g = sum(Decimal(str(package.weight_kg)) * 1000 for package in payload.packages)
        if gross_weight_g < net_weight_g:
            raise HTTPException(status_code=422, detail="Package gross weight cannot be less than selected product net weight")
        if payload.shipment_id:
            shipment = next((item for item in order_row.shipments if item.id == payload.shipment_id), None)
            if not shipment:
                raise HTTPException(status_code=422, detail="Shipment does not belong to this order")
            if shipment.tracking_number and shipment.carrier_id != carrier.id:
                raise HTTPException(status_code=422, detail="Carrier cannot be changed after a tracking number is assigned")
    plan["carrier_id"] = payload.carrier_id
    plan["shipment_id"] = payload.shipment_id
    plan["tracking_number"] = payload.tracking_number
    plan["shipping_account_profile_id"] = payload.shipping_account_profile_id
    data = {
        "origin": payload.origin.model_dump(), "destination": payload.destination.model_dump(),
        "packages": [{"weight": str(p.weight_kg), "length": str(p.length_cm), "width": str(p.width_cm), "height": str(p.height_cm)} for p in payload.packages],
        "order_no": order_no, "shipment_id": payload.shipment_id, "planner_context": plan,
        "carrier": carrier.name, "shipping_account_profile_id": payload.shipping_account_profile_id,
    }
    try:
        return {"rates": get_rates(data), "product_weight_g": net_weight_g}
    except QuoteError as error:
        raise HTTPException(status_code=502, detail={"code": error.code, "message": str(error)}) from error


@router.post("/orders/{order_no}/shipments/save")
def save_planned(order_no: str, payload: PlannedShipmentInput):
    """保存尚未应用报价的 Shipment 计划及账号展示快照。"""
    try:
        plan = payload.model_dump(mode="json")
        if payload.shipping_account_profile_id:
            account = get_shipping_account_descriptor(payload.shipping_account_profile_id)
            plan["shipping_account_label"] = account["label"]
            plan["shipping_account_number_masked"] = account["account_number_masked"]
        return db_service.save_planned_shipment(order_no, plan)
    except QuoteError as error:
        raise HTTPException(status_code=422, detail={"code": error.code, "message": str(error)}) from error
    except (db_service.BusinessError, LookupError) as error:
        status = 404 if isinstance(error, LookupError) else 422
        raise HTTPException(status_code=status, detail=str(error)) from error


@router.post("/orders/{order_no}/quotes/apply")
def apply_planned_quote(order_no: str, payload: ApplyQuoteInput):
    """按订单编号核对报价归属，再将缓存中的 Shipping Planner 方案落库。"""
    try:
        quote = cached_quote(payload.quote_id, order_no=order_no)
        if not quote.get("planner_context"):
            raise QuoteError("QUOTE_MISMATCH", "Quote does not contain a saved shipping plan.")
        return db_service.save_planned_shipment(order_no, {}, quote=quote)
    except QuoteError as error:
        raise HTTPException(status_code=422, detail={"code": error.code, "message": str(error)}) from error
    except (db_service.BusinessError, LookupError) as error:
        status = 404 if isinstance(error, LookupError) else 422
        raise HTTPException(status_code=status, detail=str(error)) from error
