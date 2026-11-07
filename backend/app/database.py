"""OMS 的 SQLite 持久化；种子数据导入设计为可重复执行。"""

from __future__ import annotations

import os
from datetime import date, datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

from sqlalchemy import (Boolean, Date, DateTime, ForeignKey, Integer, String, Table, Column,
                        UniqueConstraint, create_engine, event, inspect, select, text)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship, sessionmaker

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DB = PROJECT_ROOT / "data" / "oms.db"


def _database_url() -> str:
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
                    "SELECT id, order_id, rrp_incl_gst_cents, quantity FROM order_lines"
                )).mappings()
                order_totals: dict[int, tuple[int, int]] = {}
                for line in line_rows:
                    gross_cents = int(line["rrp_incl_gst_cents"]) * int(line["quantity"])
                    net_cents = _net_line_cents(gross_cents, 1000)
                    connection.execute(text(
                        "UPDATE order_lines SET line_subtotal_ex_gst_cents = :net WHERE id = :id"
                    ), {"net": net_cents, "id": line["id"]})
                    # 总小计和 GST 分别累加到所属订单，沿用整数分避免二进制浮点误差。
                    order_id = int(line["order_id"])
                    subtotal, gst = order_totals.get(order_id, (0, 0))
                    order_totals[order_id] = (subtotal + net_cents, gst + gross_cents - net_cents)
                for order in connection.execute(text(
                    "SELECT id, shipping_fee_cents FROM orders"
                )).mappings():
                    subtotal, gst = order_totals.get(int(order["id"]), (0, 0))
                    shipping = int(order["shipping_fee_cents"] or 0)
                    connection.execute(text(
                        "UPDATE orders SET subtotal_ex_gst_cents = :subtotal, gst_cents = :gst, "
                        "total_cents = :total WHERE id = :id"
                    ), {"subtotal": subtotal, "gst": gst, "total": subtotal + gst + shipping, "id": order["id"]})


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
        for shipment in session.scalars(select(ShipmentRow).where(ShipmentRow.carrier_id.is_(None))).all():
            # 只精确匹配已知名称；历史混合名称含义不明确，因此不自动猜测其集成类型。
            if shipment.carrier in by_name:
                shipment.carrier_id = by_name[shipment.carrier].id


def _cents(value: str | int | float) -> int:
    return int((Decimal(str(value)) * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def _net_line_cents(gross_cents: int, rate_basis_points: int) -> int:
    """按含税行总额舍入 GST，再返回未税行小计。"""
    denominator = Decimal(10_000 + rate_basis_points)
    gst = Decimal(gross_cents * rate_basis_points) / denominator
    gst_cents = int(gst.quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    return gross_cents - gst_cents


def seed_initial_data() -> None:
    """Import the assessment JSON once, without overwriting existing DB records."""
    import json
    products_path = PROJECT_ROOT / "data" / "products.json"
    orders_path = PROJECT_ROOT / "data" / "orders.json"
    created_orders_path = PROJECT_ROOT / "data" / "created_orders.json"
    with SessionLocal.begin() as session:
        if products_path.exists():
            catalog = json.loads(products_path.read_text(encoding="utf-8"))
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
        if orders_path.exists():
            dataset = json.loads(orders_path.read_text(encoding="utf-8"))
            order_items = list(dataset.get("orders", []))
            if created_orders_path.exists():
                # 保留旧版 JSON 存储阶段已经创建的订单记录。
                legacy_created = json.loads(created_orders_path.read_text(encoding="utf-8"))
                order_items.extend(legacy_created.get("orders", []))
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
                gst = 0
                for line in item.get("line_items", []):
                    product = session.get(ProductRow, line["sku"])
                    if not product:
                        raise ValueError(f"Seed order references unknown SKU {line['sku']}")
                    rate_basis_points = 1000
                    gross_line_cents = product.rrp_incl_gst_cents * int(line["quantity"])
                    line_cents = _net_line_cents(gross_line_cents, rate_basis_points)
                    db_line = OrderLineRow(order_id=row.id, sku=product.sku, quantity=line["quantity"],
                        rrp_incl_gst_cents=product.rrp_incl_gst_cents, gst_rate_basis_points=rate_basis_points,
                        line_subtotal_ex_gst_cents=line_cents)
                    row.lines.append(db_line)
                    session.flush()
                    shipment = by_group.get(line.get("tracking_group"))
                    if shipment:
                        shipment.lines.append(db_line)
                    subtotal += line_cents
                    gst += gross_line_cents - line_cents
                row.subtotal_ex_gst_cents, row.gst_cents = subtotal, gst
                row.shipping_fee_cents = sum(s.shipping_fee_cents for s in row.shipments)
                row.total_cents = subtotal + gst + row.shipping_fee_cents
