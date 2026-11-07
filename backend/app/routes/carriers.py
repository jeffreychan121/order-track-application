from fastapi import APIRouter, HTTPException, Query

from .. import carriers_service

router = APIRouter(prefix="/api/carriers", tags=["Carriers"])


@router.get("")
def list_carriers(search: str | None = None, active_only: bool = Query(False)):
    return carriers_service.list_carriers(search=search, active_only=active_only)


@router.get("/{carrier_id}")
def get_carrier(carrier_id: int):
    row = carriers_service.get_carrier(carrier_id)
    if not row:
        raise HTTPException(status_code=404, detail="Carrier not found")
    return row


@router.post("", status_code=201)
def create_carrier(payload: dict):
    try:
        return carriers_service.create_carrier(payload)
    except FileExistsError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except carriers_service.CarrierError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@router.patch("/{carrier_id}")
def update_carrier(carrier_id: int, payload: dict):
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
    try:
        carriers_service.delete_carrier(carrier_id)
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except carriers_service.CarrierError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
