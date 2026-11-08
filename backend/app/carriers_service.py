"""持久化维护承运商主数据；集成类型仅通过服务端允许列表选择。"""
from sqlalchemy import or_, select, func

from . import database
from .database import CarrierRow, ShipmentRow


class CarrierError(ValueError):
    """表示承运商资料违反可用性或历史关联约束。"""
    pass


def _dto(row: CarrierRow, used: bool | None = None) -> dict:
    """将数据库行转成 API 格式，并统一补齐可编辑页面所需的 used 标志。"""
    return {
        "id": row.id, "code": row.code, "name": row.name,
        "description": row.description or "", "integration_type": row.integration_type,
        "is_active": row.is_active, "rate_capability": row.rate_capability,
        "tracking_capability": row.tracking_capability,
        "used": bool(used) if used is not None else False,
    }


def list_carriers(search: str | None = None, active_only: bool = False) -> list[dict]:
    """按名称和代码检索承运商，并为列表批量标记历史 Shipment 引用。"""
    with database.SessionLocal() as session:
        stmt = select(CarrierRow).order_by(CarrierRow.name, CarrierRow.id)
        if active_only:
            stmt = stmt.where(CarrierRow.is_active.is_(True))
        if search:
            term = f"%{search.strip()}%"
            stmt = stmt.where(or_(CarrierRow.name.ilike(term), CarrierRow.code.ilike(term)))
        rows = session.scalars(stmt).all()
        used_ids = {value for value in session.scalars(select(ShipmentRow.carrier_id).where(ShipmentRow.carrier_id.is_not(None))).all()}
        return [_dto(row, row.id in used_ids) for row in rows]


def get_carrier(carrier_id: int) -> dict | None:
    """读取承运商详情；不存在时返回 None，具体 HTTP 映射留给路由层。"""
    with database.SessionLocal() as session:
        row = session.get(CarrierRow, carrier_id)
        if not row:
            return None
        used = session.scalar(select(func.count()).select_from(ShipmentRow).where(ShipmentRow.carrier_id == carrier_id)) or 0
        return _dto(row, used > 0)


def create_carrier(payload: dict) -> dict:
    """规范化代码后创建新记录；自定义承运商默认没有报价或追踪适配器。"""
    code = str(payload.get("code", "")).strip().upper()
    name = str(payload.get("name", "")).strip()
    if not code or not name:
        raise CarrierError("Carrier code and name are required")
    if len(code) > 60 or not all(char.isalnum() or char in "_-" for char in code):
        raise CarrierError("Carrier code may contain only letters, numbers, underscores and hyphens")
    with database.SessionLocal.begin() as session:
        if session.scalar(select(CarrierRow.id).where(CarrierRow.code == code)):
            raise FileExistsError("Carrier code already exists")
        row = CarrierRow(code=code, name=name, description=(str(payload.get("description") or "").strip() or None),
            integration_type="NONE", is_active=bool(payload.get("is_active", True)),
            rate_capability="NOT_IMPLEMENTED", tracking_capability="NOT_IMPLEMENTED")
        session.add(row)
        session.flush()
        result = _dto(row)
    return result


def update_carrier(carrier_id: int, changes: dict) -> dict:
    """局部更新承运商；历史记录引用后锁定代码，但名称和启用状态仍可维护。"""
    with database.SessionLocal.begin() as session:
        row = session.get(CarrierRow, carrier_id)
        if not row:
            raise LookupError("Carrier not found")
        used = bool(session.scalar(select(func.count()).select_from(ShipmentRow).where(ShipmentRow.carrier_id == carrier_id)))
        if "code" in changes and str(changes["code"]).strip().upper() != row.code:
            if used:
                raise CarrierError("Carrier code cannot be changed after it is used by a Shipment")
            code = str(changes["code"]).strip().upper()
            if not code or not all(char.isalnum() or char in "_-" for char in code):
                raise CarrierError("Invalid carrier code")
            duplicate = session.scalar(select(CarrierRow.id).where(CarrierRow.code == code, CarrierRow.id != carrier_id))
            if duplicate:
                raise FileExistsError("Carrier code already exists")
            row.code = code
        if "name" in changes:
            name = str(changes["name"]).strip()
            if not name:
                raise CarrierError("Carrier name is required")
            row.name = name
        if "description" in changes:
            row.description = str(changes["description"] or "").strip() or None
        if "is_active" in changes:
            row.is_active = bool(changes["is_active"])
        result = _dto(row, used)
    return result


def delete_carrier(carrier_id: int) -> None:
    """只删除未被 Shipment 使用的承运商，避免破坏历史物流数据。"""
    with database.SessionLocal.begin() as session:
        row = session.get(CarrierRow, carrier_id)
        if not row:
            raise LookupError("Carrier not found")
        used = bool(session.scalar(select(func.count()).select_from(ShipmentRow).where(ShipmentRow.carrier_id == carrier_id)))
        if used:
            raise CarrierError("This carrier is used by existing shipments. You can deactivate it instead.")
        session.delete(row)
