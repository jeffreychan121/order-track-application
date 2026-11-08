from fastapi import APIRouter, HTTPException, Query

from .. import carriers_service

router = APIRouter(prefix="/api/carriers", tags=["Carriers"])


@router.get("")
def list_carriers(search: str | None = None, active_only: bool = Query(False)):
    """列出承运商，并附带是否已被历史 Shipment 引用的信息。"""
    return carriers_service.list_carriers(search=search, active_only=active_only)


@router.get("/{carrier_id}")
def get_carrier(carrier_id: int):
    """读取单个承运商；未找到时返回 404。"""
    row = carriers_service.get_carrier(carrier_id)
    if not row:
        raise HTTPException(status_code=404, detail="Carrier not found")
    return row


@router.post("", status_code=201)
def create_carrier(payload: dict):
    """创建未绑定外部适配器的新承运商记录。"""
    try:
        return carriers_service.create_carrier(payload)
    except FileExistsError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except carriers_service.CarrierError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@router.patch("/{carrier_id}")
def update_carrier(carrier_id: int, payload: dict):
    """更新承运商资料；已被 Shipment 使用的承运商代码不可更改。"""
    try:
        return carriers_service.update_carrier(carrier_id, payload)
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except FileExistsError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except carriers_service.CarrierError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@router.delete("/{carrier_id}", status_code=204)
def delete_carrier(carrier_id: int):
    """删除未被 Shipment 引用的承运商；已引用时提示改为停用。"""
    try:
        carriers_service.delete_carrier(carrier_id)
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except carriers_service.CarrierError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
