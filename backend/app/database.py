"""OMS 的 SQLite 持久化；种子数据导入设计为可重复执行。"""

from __future__ import annotations

import os
from collections.abc import Iterable
from datetime import date, datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

from sqlalchemy import (Boolean, Date, DateTime, ForeignKey, Integer, String, Text, Table, Column,
                        UniqueConstraint, create_engine, event, inspect, select, text)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship, sessionmaker

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DB = PROJECT_ROOT / "data" / "oms.db"


def _database_url() -> str:
    """读取 DATABASE_URL；默认 SQLite 文件位于项目 data 目录，便于稳定定位。"""
    value = os.getenv("DATABASE_URL", "").strip()
    if not value:
        DEFAULT_DB.parent.mkdir(parents=True, exist_ok=True)
        return f"sqlite:///{DEFAULT_DB}"
    if value.startswith("sqlite:///./"):
        return f"sqlite:///{(PROJECT_ROOT / value.removeprefix('sqlite:///./')).resolve()}"
    return value


DATABASE_URL = _database_url()
engine = None
SessionLocal = None


def configure_database(url: str | None = None) -> None:
    """创建 SQLAlchemy 引擎和会话工厂；测试切换数据库时会先释放旧引擎。"""
    global DATABASE_URL, engine, SessionLocal
    if engine is not None:
        engine.dispose()
    DATABASE_URL = url or _database_url()
    if DATABASE_URL.startswith("sqlite:"):
        raw_path = DATABASE_URL.removeprefix("sqlite:///")
        if raw_path and raw_path != ":memory:":
            Path(raw_path).expanduser().resolve().parent.mkdir(parents=True, exist_ok=True)
    connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
    engine = create_engine(DATABASE_URL, connect_args=connect_args, future=True)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

    @event.listens_for(engine, "connect")
    def _enable_foreign_keys(dbapi_connection, _connection_record):
        """SQLite 默认关闭外键，此连接钩子确保删除保护在每个连接上生效。"""
        if DATABASE_URL.startswith("sqlite"):
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()


configure_database()


class Base(DeclarativeBase):
    pass


shipment_order_lines = Table(
    "shipment_order_lines", Base.metadata,
    Column("shipment_id", ForeignKey("shipments.id", ondelete="CASCADE"), primary_key=True),
    Column("order_line_id", ForeignKey("order_lines.id", ondelete="CASCADE"), primary_key=True),
    UniqueConstraint("order_line_id", name="uq_order_line_single_shipment"),
    Column("allocated_quantity", Integer, nullable=False, server_default="1"),
)


class CarrierRow(Base):
    __tablename__ = "carriers"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(60), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str | None] = mapped_column(String(500))
    integration_type: Mapped[str] = mapped_column(String(40), default="NONE", nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    rate_capability: Mapped[str] = mapped_column(String(30), default="NOT_IMPLEMENTED", nullable=False)
    tracking_capability: Mapped[str] = mapped_column(String(30), default="NOT_IMPLEMENTED", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    shipments: Mapped[list["ShipmentRow"]] = relationship(back_populates="carrier_record")


class ProductRow(Base):
    __tablename__ = "products"
    sku: Mapped[str] = mapped_column(String(80), primary_key=True)
    name: Mapped[str] = mapped_column(String(300), nullable=False)
    description: Mapped[str] = mapped_column(String, default="", nullable=False)
    rrp_incl_gst_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    weight_g: Mapped[int | None] = mapped_column(Integer)
    length_mm: Mapped[int | None] = mapped_column(Integer)
    width_mm: Mapped[int | None] = mapped_column(Integer)
    height_mm: Mapped[int | None] = mapped_column(Integer)
    dosage_type: Mapped[str | None] = mapped_column(String(120))
    product_type: Mapped[str | None] = mapped_column(String(120))
    status: Mapped[str | None] = mapped_column(String(80))
    image_url: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    lines: Mapped[list["OrderLineRow"]] = relationship(back_populates="product")


class OrderRow(Base):
    __tablename__ = "orders"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    order_no: Mapped[str] = mapped_column(String(80), unique=True, nullable=False, index=True)
    order_date: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="draft", nullable=False)
    customer_name: Mapped[str] = mapped_column(String(200), nullable=False)
    company: Mapped[str] = mapped_column(String(200), nullable=False)
    phone: Mapped[str] = mapped_column(String(80), nullable=False)
    email: Mapped[str] = mapped_column(String(254), nullable=False)
    address_line1: Mapped[str] = mapped_column(String(300), nullable=False)
    address_line2: Mapped[str | None] = mapped_column(String(300))
    suburb: Mapped[str] = mapped_column(String(120), nullable=False)
    state: Mapped[str] = mapped_column(String(80), nullable=False)
    postcode: Mapped[str] = mapped_column(String(4), nullable=False)
    country: Mapped[str] = mapped_column(String(80), default="Australia", nullable=False)
    currency: Mapped[str] = mapped_column(String(3), default="AUD", nullable=False)
    subtotal_ex_gst_cents: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    gst_cents: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    shipping_fee_cents: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    total_cents: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    lines: Mapped[list["OrderLineRow"]] = relationship(back_populates="order", cascade="all, delete-orphan", order_by="OrderLineRow.id")
    shipments: Mapped[list["ShipmentRow"]] = relationship(back_populates="order", cascade="all, delete-orphan", order_by="ShipmentRow.id")


class OrderLineRow(Base):
    __tablename__ = "order_lines"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), nullable=False)
    sku: Mapped[str] = mapped_column(ForeignKey("products.sku", ondelete="RESTRICT"), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    rrp_incl_gst_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    gst_rate_basis_points: Mapped[int] = mapped_column(Integer, default=1000, server_default="1000", nullable=False)
    line_subtotal_ex_gst_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    order: Mapped[OrderRow] = relationship(back_populates="lines")
    product: Mapped[ProductRow] = relationship(back_populates="lines")
    shipments: Mapped[list["ShipmentRow"]] = relationship(secondary=shipment_order_lines, back_populates="lines")


class ShipmentRow(Base):
    __tablename__ = "shipments"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), nullable=False)
    carrier: Mapped[str] = mapped_column(String(80), nullable=False)
    carrier_id: Mapped[int | None] = mapped_column(ForeignKey("carriers.id", ondelete="RESTRICT"), nullable=True)
    shipping_account_profile_id: Mapped[str | None] = mapped_column(String(80))
    shipping_account_label: Mapped[str | None] = mapped_column(String(160))
    shipping_account_number_masked: Mapped[str | None] = mapped_column(String(30))
    tracking_number: Mapped[str | None] = mapped_column(String(120))
    shipping_fee_cents: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    shipping_quote_status: Mapped[str] = mapped_column(String(40), default="not_quoted", nullable=False)
    selected_product_id: Mapped[str | None] = mapped_column(String(40))
    quote_source: Mapped[str | None] = mapped_column(String(120))
    quoted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    origin_suburb: Mapped[str | None] = mapped_column(String(120))
    origin_state: Mapped[str | None] = mapped_column(String(3))
    origin_postcode: Mapped[str | None] = mapped_column(String(4))
    origin_type: Mapped[str | None] = mapped_column(String(40))
    origin_lines_json: Mapped[str | None] = mapped_column(String)
    origin_country: Mapped[str | None] = mapped_column(String(2))
    destination_suburb: Mapped[str | None] = mapped_column(String(120))
    destination_state: Mapped[str | None] = mapped_column(String(3))
    destination_postcode: Mapped[str | None] = mapped_column(String(4))
    destination_type: Mapped[str | None] = mapped_column(String(40))
    destination_lines_json: Mapped[str | None] = mapped_column(String)
    destination_country: Mapped[str | None] = mapped_column(String(2))
    tracking_group: Mapped[str | None] = mapped_column(String(80))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    order: Mapped[OrderRow] = relationship(back_populates="shipments")
    carrier_record: Mapped[CarrierRow | None] = relationship(back_populates="shipments")
    lines: Mapped[list[OrderLineRow]] = relationship(secondary=shipment_order_lines, back_populates="shipments")
    packages: Mapped[list["ShipmentPackageRow"]] = relationship(back_populates="shipment", cascade="all, delete-orphan")


class ShipmentTrackingSnapshotRow(Base):
    """保存每个 Shipment 最近一次成功追踪结果及最近一次查询状态。"""
    __tablename__ = "shipment_tracking_snapshots"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    shipment_id: Mapped[int] = mapped_column(ForeignKey("shipments.id", ondelete="CASCADE"), unique=True, nullable=False, index=True)
    carrier: Mapped[str] = mapped_column(String(80), nullable=False)
    tracking_number: Mapped[str] = mapped_column(String(120), nullable=False)
    overall_status: Mapped[str] = mapped_column(String(40), nullable=False)
    overall_status_raw: Mapped[str | None] = mapped_column(String(160))
    total_articles: Mapped[int | None] = mapped_column(Integer)
    delivered_articles: Mapped[int | None] = mapped_column(Integer)
    last_updated: Mapped[str | None] = mapped_column(String(80))
    result_json: Mapped[str] = mapped_column(Text, default="{}", nullable=False)
    last_successful_query_at: Mapped[str | None] = mapped_column(String(40))
    last_attempt_at: Mapped[str | None] = mapped_column(String(40))
    last_attempt_status: Mapped[str | None] = mapped_column(String(30))
    last_error_code: Mapped[str | None] = mapped_column(String(50))
    last_error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    shipment: Mapped[ShipmentRow] = relationship()


class ShipmentPackageRow(Base):
    __tablename__ = "shipment_packages"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    shipment_id: Mapped[int] = mapped_column(ForeignKey("shipments.id", ondelete="CASCADE"), nullable=False, index=True)
    gross_weight_g: Mapped[int] = mapped_column(Integer, nullable=False)
    length_mm: Mapped[int] = mapped_column(Integer, nullable=False)
    width_mm: Mapped[int] = mapped_column(Integer, nullable=False)
    height_mm: Mapped[int] = mapped_column(Integer, nullable=False)
    shipment: Mapped[ShipmentRow] = relationship(back_populates="packages")


def init_db() -> None:
    """创建缺少的表，再按顺序迁移旧库并补齐承运商和种子数据。"""
    Base.metadata.create_all(bind=engine)
    _migrate_legacy_schema()
    seed_carriers()
    seed_initial_data()


def _migrate_legacy_schema() -> None:
    """对已有本地 SQLite 数据库执行范围有限且可重复的迁移。"""
    if not DATABASE_URL.startswith("sqlite"):
        return
    with engine.begin() as connection:
        tables = set(inspect(connection).get_table_names())
        if "shipments" in tables:
            columns = {column["name"] for column in inspect(connection).get_columns("shipments")}
            additions = {
                "carrier_id": "INTEGER REFERENCES carriers(id) ON DELETE RESTRICT",
                "shipping_account_profile_id": "VARCHAR(80)",
                "shipping_account_label": "VARCHAR(160)",
                "shipping_account_number_masked": "VARCHAR(30)",
                "origin_suburb": "VARCHAR(120)", "origin_state": "VARCHAR(3)", "origin_postcode": "VARCHAR(4)",
                "destination_suburb": "VARCHAR(120)", "destination_state": "VARCHAR(3)", "destination_postcode": "VARCHAR(4)",
                "origin_type": "VARCHAR(40)", "origin_lines_json": "TEXT", "origin_country": "VARCHAR(2)",
                "destination_type": "VARCHAR(40)", "destination_lines_json": "TEXT", "destination_country": "VARCHAR(2)",
            }
            for name, declaration in additions.items():
                if name not in columns:
                    connection.execute(text(f"ALTER TABLE shipments ADD COLUMN {name} {declaration}"))
        if "shipment_order_lines" in tables:
            columns = {column["name"] for column in inspect(connection).get_columns("shipment_order_lines")}
            if "allocated_quantity" not in columns:
                connection.execute(text("ALTER TABLE shipment_order_lines ADD COLUMN allocated_quantity INTEGER NOT NULL DEFAULT 1"))
        if "order_lines" in tables:
            columns = {column["name"] for column in inspect(connection).get_columns("order_lines")}
            if "gst_rate_basis_points" not in columns:
                connection.execute(text(
                    "ALTER TABLE order_lines ADD COLUMN gst_rate_basis_points INTEGER NOT NULL DEFAULT 1000"
                ))
                # 旧订单曾先舍入单价再乘数量；迁移时按行含税总额重算，且保留既有 RRP 与 Shipment 费用。
                line_rows = connection.execute(text(
                    "SELECT id, rrp_incl_gst_cents, quantity FROM order_lines"
                )).mappings()
                for line in line_rows:
                    gross_cents = int(line["rrp_incl_gst_cents"]) * int(line["quantity"])
                    net_cents = _net_line_cents(gross_cents, 1000)
                    connection.execute(text(
                        "UPDATE order_lines SET line_subtotal_ex_gst_cents = :net WHERE id = :id"
                    ), {"net": net_cents, "id": line["id"]})
        # 按新口径幂等重算已有订单汇总，避免旧数据库继续显示行级 GST 总额。
        if "orders" in tables and "order_lines" in tables:
            line_bases_by_order: dict[int, list[tuple[int, int]]] = {}
            for line in connection.execute(text(
                "SELECT order_id, line_subtotal_ex_gst_cents, gst_rate_basis_points FROM order_lines"
            )).mappings():
                line_bases_by_order.setdefault(int(line["order_id"]), []).append(
                    (int(line["line_subtotal_ex_gst_cents"]), int(line["gst_rate_basis_points"]))
                )
            for order in connection.execute(text(
                "SELECT id, shipping_fee_cents FROM orders"
            )).mappings():
                order_id = int(order["id"])
                line_bases = line_bases_by_order.get(order_id, [])
                subtotal = sum(net_cents for net_cents, _ in line_bases)
                gst = _order_gst_cents(line_bases)
                shipping = int(order["shipping_fee_cents"] or 0)
                connection.execute(text(
                    "UPDATE orders SET subtotal_ex_gst_cents = :subtotal, gst_cents = :gst, "
                    "total_cents = :total WHERE id = :id"
                ), {"subtotal": subtotal, "gst": gst, "total": subtotal + gst + shipping, "id": order_id})


def seed_carriers() -> None:
    """写入真实承运商集成定义，并将含义不明确的历史名称保留为停用。"""
    definitions = [
        ("AUSTRALIA_POST", "Australia Post", "Australia Post eParcel rates and tracking.", "AUSTRALIA_POST", True, "SUPPORTED", "SUPPORTED"),
        ("STARTRACK", "StarTrack", "StarTrack carrier; API capability depends on account configuration.", "AUSTRALIA_POST", True, "NOT_IMPLEMENTED", "SUPPORTED"),
        ("TNT", "TNT", "TNT API authentication has not been verified for this account.", "TNT", True, "NOT_IMPLEMENTED", "NOT_IMPLEMENTED"),
        ("LEGACY_STARTRACK_AUSTRALIA_POST", "StarTrack / Australia Post", "Historical mixed carrier label retained as-is; choose a specific carrier for new shipments.", "NONE", False, "NOT_IMPLEMENTED", "NOT_IMPLEMENTED"),
        ("LEGACY_AUSTRALIA_POST_STARTRACK", "Australia Post / StarTrack", "Historical mixed carrier label retained as-is; choose a specific carrier for new shipments.", "NONE", False, "NOT_IMPLEMENTED", "NOT_IMPLEMENTED"),
    ]
    with SessionLocal.begin() as session:
        for code, name, description, integration, active, rates, tracking in definitions:
            carrier = session.scalar(select(CarrierRow).where(CarrierRow.code == code))
            if carrier is None:
                session.add(CarrierRow(code=code, name=name, description=description, integration_type=integration,
                    is_active=active, rate_capability=rates, tracking_capability=tracking))
        session.flush()
        by_name = {carrier.name: carrier for carrier in session.scalars(select(CarrierRow)).all()}
        australia_post = by_name.get("Australia Post")
        if australia_post is not None:
            # 这些历史测试运单已由 Australia Post API 单独查询成功；
            # 只更正已核验的记录，不推断其他混合承运商标签，也不改订单、运费或运单号。
            verified_historical_shipments = (
                ("PO-20251130-00072", "2FWZ50008569"),
                ("PO-20251203-00046", "2FWZ50008645"),
            )
            for order_no, tracking_number in verified_historical_shipments:
                shipment = session.scalar(select(ShipmentRow).join(OrderRow).where(
                    OrderRow.order_no == order_no,
                    ShipmentRow.tracking_number == tracking_number,
                    ShipmentRow.carrier == "StarTrack / Australia Post",
                ))
                if shipment is not None:
                    shipment.carrier = australia_post.name
                    shipment.carrier_id = australia_post.id
        for shipment in session.scalars(select(ShipmentRow).where(ShipmentRow.carrier_id.is_(None))).all():
            # 只精确匹配已知名称；历史混合名称含义不明确，因此不自动猜测其集成类型。
            if shipment.carrier in by_name:
                shipment.carrier_id = by_name[shipment.carrier].id


def _cents(value: str | int | float) -> int:
    """通过 Decimal 字符串化消除二进制浮点误差，再舍入到整数分。"""
    return int((Decimal(str(value)) * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def _net_line_cents(gross_cents: int, rate_basis_points: int) -> int:
    """按含税行总额舍入 GST，再返回未税行小计。"""
    denominator = Decimal(10_000 + rate_basis_points)
    gst = Decimal(gross_cents * rate_basis_points) / denominator
    gst_cents = int(gst.quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    return gross_cents - gst_cents


def _order_gst_cents(line_tax_bases: Iterable[tuple[int, int]]) -> int:
    """先按税率汇总未税金额，再对各税率组 GST 舍入到整数分。"""
    bases_by_rate: dict[int, int] = {}
    for net_cents, rate_basis_points in line_tax_bases:
        bases_by_rate[rate_basis_points] = bases_by_rate.get(rate_basis_points, 0) + net_cents
    return sum(
        int((Decimal(net_cents * rate_basis_points) / Decimal(10_000)).quantize(
            Decimal("1"), rounding=ROUND_HALF_UP
        ))
        for rate_basis_points, net_cents in bases_by_rate.items()
    )


def _read_seed_json(path: Path):
    """读取 JSON 种子文件；错误信息只说明文件名和错误类型，不回显数据内容。"""
    import json

    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError(f"Unable to read seed file {path.name}: {exc.__class__.__name__}") from exc


def _validate_seed_payload(raw, schema, source_name: str):
    """复用 API 的 Pydantic 输入模型校验种子数据，不回显可能含个人信息的值。"""
    from pydantic import ValidationError

    try:
        return schema.model_validate(raw)
    except ValidationError as exc:
        details = [
            f"{'.'.join(str(part) for part in error['loc'])}: {error['msg']}"
            for error in exc.errors(include_input=False)
        ]
        raise ValueError(f"Invalid seed data in {source_name}: " + "; ".join(details)) from exc


def _read_validated_seed(path: Path, schema):
    """读取并复用 API 的 Pydantic 输入模型校验种子文件。"""
    raw = _read_seed_json(path)
    _validate_seed_payload(raw, schema, path.name)
    return raw


def seed_initial_data() -> None:
    """先校验完整种子，再仅导入数据库中不存在的商品和订单。"""
    from .models import OrderDataset, ProductCatalog

    products_path = PROJECT_ROOT / "data" / "products.json"
    orders_path = PROJECT_ROOT / "data" / "orders.json"
    created_orders_path = PROJECT_ROOT / "data" / "created_orders.json"

    # 先在事务外校验所有输入，避免坏文件导致只导入一部分商品或订单。
    catalog = _read_validated_seed(products_path, ProductCatalog) if products_path.exists() else None
    dataset = _read_validated_seed(orders_path, OrderDataset) if orders_path.exists() else None
    order_items = list(dataset.get("orders", [])) if dataset else []
    if dataset and created_orders_path.exists():
        # 兼容旧版 JSON 存储的订单；允许空文件，但非空时使用相同订单 schema 校验。
        legacy_created = _read_seed_json(created_orders_path)
        if not isinstance(legacy_created, dict) or not isinstance(legacy_created.get("orders"), list):
            _validate_seed_payload(legacy_created, OrderDataset, created_orders_path.name)
        legacy_items = legacy_created["orders"]
        if legacy_items:
            _validate_seed_payload(legacy_created, OrderDataset, created_orders_path.name)
            order_items.extend(legacy_items)
    if dataset and order_items:
        # 合并后再校验一次，捕获主种子与兼容文件之间重复的订单号。
        _validate_seed_payload({"currency": dataset["currency"], "orders": order_items}, OrderDataset, "combined order seeds")

    if order_items:
        seeded_skus = {item["sku"] for item in (catalog or {}).get("products", [])}
        with SessionLocal() as session:
            existing_skus = set(session.scalars(select(ProductRow.sku)).all())
        referenced_skus = {line["sku"] for item in order_items for line in item["line_items"]}
        unknown_skus = sorted(referenced_skus - seeded_skus - existing_skus)
        if unknown_skus:
            raise ValueError("Seed orders reference unknown SKU(s): " + ", ".join(unknown_skus))

    with SessionLocal.begin() as session:
        if catalog:
            for item in catalog.get("products", []):
                if session.get(ProductRow, item["sku"]):
                    continue
                dimensions = item.get("dimensions") or {}
                measure = lambda key: int(Decimal(str((dimensions.get(key) or {}).get("value", 0))).quantize(Decimal("1"))) or None
                weight = item.get("weight") or {}
                session.add(ProductRow(
                    sku=item["sku"], name=item["name"], description=item.get("description", ""),
                    rrp_incl_gst_cents=_cents(item["rrp_incl_gst"]),
                    weight_g=int(Decimal(str(weight.get("value", 0))).quantize(Decimal("1"))) or None,
                    length_mm=measure("length"), width_mm=measure("width"), height_mm=measure("height"),
                    dosage_type=item.get("dosage_type"), product_type=item.get("product_type"),
                    status=item.get("status"), image_url=None,
                ))
        if dataset:
            for item in order_items:
                if session.query(OrderRow).filter_by(order_no=item["order_id"]).first():
                    continue
                source_status = item.get("status", "draft").casefold().replace(" ", "_")
                status = {"in_transit": "in_transit", "completed": "completed", "confirmed": "confirmed"}.get(source_status, "draft")
                address = item["shipping_address"]
                row = OrderRow(
                    order_no=item["order_id"], order_date=date.fromisoformat(item["order_date"]), status=status,
                    customer_name=item["customer"]["name"], company=item["company_name"],
                    phone=item["customer"]["phone"], email=item["customer"]["email"],
                    address_line1=address["street"], address_line2=address.get("address_line2"),
                    suburb=address["suburb"], state=address["state"], postcode=address["postcode"],
                    country=address.get("country", "Australia"), currency=dataset.get("currency", "AUD"),
                )
                session.add(row)
                session.flush()
                by_group = {}
                for shipment in item.get("shipments", []):
                    quote = shipment.get("shipping_quote") or {}
                    fee = shipment.get("shipping_fee", quote.get("total_cost", "0.00"))
                    carrier_name = shipment["carrier"]
                    carrier_row = session.scalar(select(CarrierRow).where(CarrierRow.name == carrier_name))
                    db_shipment = ShipmentRow(order_id=row.id, carrier=carrier_name, carrier_id=carrier_row.id if carrier_row else None,
                        tracking_number=shipment.get("tracking_number"), tracking_group=shipment.get("tracking_group"),
                        shipping_fee_cents=_cents(fee),
                        shipping_quote_status="quoted" if quote else "not_quoted",
                        selected_product_id=quote.get("product_id"), quote_source=quote.get("source"))
                    row.shipments.append(db_shipment)
                    by_group[shipment.get("tracking_group")] = db_shipment
                subtotal = 0
                line_tax_bases: list[tuple[int, int]] = []
                for line in item.get("line_items", []):
                    product = session.get(ProductRow, line["sku"])
                    if not product:
                        raise ValueError(f"Seed order references unknown SKU {line['sku']}")
                    # 种子订单支持与 API 相同的行级价格和税率快照；未提供时使用商品 RRP 和 10%。
                    saved_price_cents = (
                        _cents(line["rrp_incl_gst"])
                        if line.get("rrp_incl_gst") is not None
                        else product.rrp_incl_gst_cents
                    )
                    rate_basis_points = (
                        int(Decimal(str(line["gst_rate_percent"])) * 100)
                        if line.get("gst_rate_percent") is not None
                        else 1000
                    )
                    gross_line_cents = saved_price_cents * int(line["quantity"])
                    line_cents = _net_line_cents(gross_line_cents, rate_basis_points)
                    db_line = OrderLineRow(order_id=row.id, sku=product.sku, quantity=line["quantity"],
                        rrp_incl_gst_cents=saved_price_cents, gst_rate_basis_points=rate_basis_points,
                        line_subtotal_ex_gst_cents=line_cents)
                    row.lines.append(db_line)
                    session.flush()
                    shipment = by_group.get(line.get("tracking_group"))
                    if shipment:
                        shipment.lines.append(db_line)
                    subtotal += line_cents
                    line_tax_bases.append((line_cents, rate_basis_points))
                gst = _order_gst_cents(line_tax_bases)
                row.subtotal_ex_gst_cents, row.gst_cents = subtotal, gst
                row.shipping_fee_cents = sum(s.shipping_fee_cents for s in row.shipments)
                row.total_cents = subtotal + gst + row.shipping_fee_cents
