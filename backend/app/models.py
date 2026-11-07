from datetime import date
from decimal import Decimal
import re
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class InputModel(BaseModel):
    model_config = ConfigDict(extra="ignore")


class Customer(InputModel):
    name: str = Field(min_length=1)
    phone: str = Field(min_length=1)
    email: str = Field(min_length=1)

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        value = value.strip()
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value):
            raise ValueError("Enter a valid email address")
        return value

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, value: str) -> str:
        value = value.strip()
        digits = re.sub(r"\D", "", value)
        if not 7 <= len(digits) <= 15:
            raise ValueError("Enter a valid phone number")
        return value


class ShippingAddress(InputModel):
    street: str = Field(min_length=1)
    address_line2: str | None = None
    suburb: str = Field(min_length=1)
    state: str = Field(min_length=1)
    postcode: str = Field(pattern=r"^\d{4}$")
    country: str = Field(min_length=1)


class OrderLine(InputModel):
    sku: str = Field(min_length=1)
    quantity: int = Field(strict=True, gt=0)
    tracking_group: str | None = None
    rrp_incl_gst: Decimal | None = Field(default=None, gt=0)
    # 客户可以按订单行覆盖商品默认税率；省略时由服务端沿用历史值或默认 10%。
    gst_rate_percent: Decimal | None = Field(default=None, ge=0, le=100)

    @field_validator("rrp_incl_gst")
    @classmethod
    def validate_finite_rrp(cls, value: Decimal | None) -> Decimal | None:
        if value is not None and not value.is_finite():
            raise ValueError("rrp_incl_gst must be a finite positive amount")
        return value

    @field_validator("gst_rate_percent")
    @classmethod
    def validate_gst_rate(cls, value: Decimal | None) -> Decimal | None:
        if value is None:
            return value
        if not value.is_finite() or value.as_tuple().exponent < -2:
            raise ValueError("gst_rate_percent must be a finite percentage with at most 2 decimal places")
        return value


class Shipment(InputModel):
    tracking_group: str = Field(default="Shipment 1", min_length=1)
    carrier: str | None = None
    carrier_id: int | None = Field(default=None, gt=0)
    tracking_number: str | None = None
    shipping_account_profile_id: str | None = Field(default=None, max_length=80)

    @model_validator(mode="after")
    def require_carrier(self) -> "Shipment":
        if self.carrier_id is None and not (self.carrier and self.carrier.strip()):
            raise ValueError("Carrier is required")
        return self


class Order(InputModel):
    order_id: str = Field(min_length=1)
    order_date: date
    status: str = Field(min_length=1)
    company_name: str = Field(min_length=1)
    customer: Customer
    shipping_address: ShippingAddress
    line_items: list[OrderLine] = Field(min_length=1)
    shipments: list[Shipment] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_shipment_groups(self) -> "Order":
        known_groups = {shipment.tracking_group for shipment in self.shipments}
        missing_groups = sorted(
            {line.tracking_group for line in self.line_items} - known_groups
        )
        if missing_groups:
            raise ValueError(
                f"order {self.order_id} has line items with no shipment for: "
                + ", ".join(missing_groups)
            )
        return self


class CreateOrderInput(InputModel):
    order_date: date
    status: str = Field(default="draft", pattern=r"^(draft|confirmed|in_transit|completed|Confirmed|In Transit|Completed)$")
    company_name: str = Field(min_length=1)
    customer: Customer
    shipping_address: ShippingAddress
    line_items: list[OrderLine] = Field(min_length=1)
    shipments: list[Shipment] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_shipment_groups(self) -> "CreateOrderInput":
        known_groups = {shipment.tracking_group for shipment in self.shipments}
        if not self.shipments:
            return self
        missing_groups = sorted({line.tracking_group for line in self.line_items if line.tracking_group} - known_groups)
        if missing_groups:
            raise ValueError("Each order line must be assigned to a shipment")
        keys = [(s.carrier.casefold(), s.tracking_number.strip()) for s in self.shipments if s.tracking_number and s.tracking_number.strip()]
        if len(keys) != len(set(keys)):
            raise ValueError("Duplicate carrier and tracking number in this order")
        return self


class OrderDataset(InputModel):
    currency: str = Field(pattern=r"^[A-Z]{3}$")
    orders: list[Order] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_unique_order_ids(self) -> "OrderDataset":
        order_ids = [order.order_id for order in self.orders]
        if len(order_ids) != len(set(order_ids)):
            raise ValueError("orders.json contains duplicate order_id values")
        return self


class Measurement(InputModel):
    value: Decimal = Field(gt=0)
    unit: str = Field(min_length=1)


class QuoteLocation(InputModel):
    type: str | None = None
    lines: list[str] = Field(default_factory=list)
    suburb: str = Field(min_length=1)
    state: str = Field(min_length=2, max_length=3)
    postcode: str = Field(pattern=r"^\d{4}$")
    country: str = Field(default="AU", pattern=r"^[A-Z]{2}$")


class QuotePackage(InputModel):
    weight: Decimal = Field(gt=0)
    length: Decimal = Field(gt=0)
    width: Decimal = Field(gt=0)
    height: Decimal = Field(gt=0)


class ShippingRateInput(InputModel):
    origin: QuoteLocation
    destination: QuoteLocation
    packages: list[QuotePackage] = Field(min_length=1)
    carrier_id: int | None = Field(default=None, gt=0)
    shipping_account_profile_id: str | None = Field(default=None, max_length=80)
    order_no: str | None = None
    shipment_id: int | None = None


class ApplyQuoteInput(InputModel):
    quote_id: str = Field(min_length=1)


class PlannerPackage(InputModel):
    weight_kg: Decimal = Field(gt=0)
    length_cm: Decimal = Field(gt=0)
    width_cm: Decimal = Field(gt=0)
    height_cm: Decimal = Field(gt=0)


class ShippingQuotePreviewInput(InputModel):
    carrier_id: int = Field(gt=0)
    shipping_account_profile_id: str | None = Field(default=None, max_length=80)
    order_line_ids: list[int] = Field(min_length=1)
    origin: QuoteLocation
    destination: QuoteLocation
    packages: list[PlannerPackage] = Field(min_length=1)
    shipment_id: int | None = None
    tracking_number: str | None = None


class PlannedShipmentInput(ShippingQuotePreviewInput):
    packages: list[PlannerPackage] = Field(default_factory=list)


class Dimensions(InputModel):
    length: Measurement | None = None
    width: Measurement | None = None
    height: Measurement | None = None


class Product(InputModel):
    sku: str = Field(min_length=1)
    name: str = Field(min_length=1)
    description: str = ""
    rrp_incl_gst: Decimal = Field(gt=0)
    currency: str = Field(pattern=r"^[A-Z]{3}$")
    weight: Measurement | None = None
    dimensions: Dimensions | None = None
    volume: Measurement | None = None
    volumetric_gross_weight: Measurement | None = None
    size: str | None = None
    barcode: str | None = None
    dosage_type: str | None = None
    product_type: str | None = None
    schedule: str | None = None
    status: str | None = None

    @field_validator("rrp_incl_gst")
    @classmethod
    def validate_finite_price(cls, value: Decimal) -> Decimal:
        if not value.is_finite():
            raise ValueError("rrp_incl_gst must be a finite decimal amount")
        return value


class ProductCatalog(InputModel):
    price_currency: str = Field(pattern=r"^[A-Z]{3}$")
    rrp_includes_gst: bool
    gst_rate: Decimal = Field(gt=0, lt=1)
    products: list[Product] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_catalog(self) -> "ProductCatalog":
        if not self.rrp_includes_gst:
            raise ValueError("products.json must declare that RRP includes GST")
        if self.gst_rate != Decimal("0.10"):
            raise ValueError("assessment GST rate must be 0.10")
        skus = [product.sku for product in self.products]
        if len(skus) != len(set(skus)):
            raise ValueError("products.json contains duplicate SKU values")
        mismatched_currency = sorted(
            product.sku
            for product in self.products
            if product.currency != self.price_currency
        )
        if mismatched_currency:
            raise ValueError(
                "product currency differs from catalog currency for SKU(s): "
                + ", ".join(mismatched_currency)
            )
        return self


class CustomerResponse(BaseModel):
    name: str
    phone: str
    email: str


class ShippingAddressResponse(BaseModel):
    street: str
    suburb: str
    state: str
    postcode: str
    country: str


class ShipmentResponse(BaseModel):
    tracking_group: str
    carrier: str
    carrier_id: int | None = None
    carrier_code: str | None = None
    shipping_account_profile_id: str | None = None
    shipping_account_label: str | None = None
    shipping_account_number_masked: str | None = None
    tracking_number: str
    tracking_status: str = "not_queried"
    id: int | None = None
    shipping_fee: str = "0.00"
    shipping_quote_status: str = "not_quoted"
    selected_product_id: str | None = None
    related_skus: list[str] = Field(default_factory=list)
    order_line_ids: list[int] = Field(default_factory=list)
    packages: list[dict] = Field(default_factory=list)
    origin: dict | None = None
    destination: dict | None = None


class TrackingEventResponse(BaseModel):
    date: str
    description: str | None = None
    location: str | None = None


class ArticleTrackingResponse(BaseModel):
    article_id: str | None = None
    product_type: str | None = None
    raw_status: str | None = None
    status: str
    last_updated: str | None = None
    events: list[TrackingEventResponse] = Field(default_factory=list)


class ShipmentTrackingResponse(BaseModel):
    tracking_group: str
    carrier: str
    tracking_number: str
    overall_status: str
    overall_status_raw: str | None = None
    total_articles: int | None = None
    delivered_articles: int | None = None
    last_updated: str | None = None
    consignment_events: list[TrackingEventResponse] = Field(default_factory=list)
    articles: list[ArticleTrackingResponse] = Field(default_factory=list)
    test_data_time_mismatch: bool = False
    tracking_error: str | None = None
    tracking_error_code: str | None = None


class OrderLineResponse(BaseModel):
    id: int | None = None
    sku: str
    product_name: str
    description: str
    quantity: int
    tracking_group: str
    rrp_incl_gst: str
    gst_rate_percent: str
    ex_gst_unit_price: str
    line_subtotal_ex_gst: str
    currency: str
    product_weight_g: int | None = None


class OrderSummaryResponse(BaseModel):
    currency: str
    subtotal_ex_gst: str
    gst_rate: str
    gst_amount: str
    shipment_fee: str
    shipment_fee_status: str
    total: str


class OrderDetailResponse(BaseModel):
    id: int | None = None
    order_id: str
    order_date: date
    status: str
    company_name: str
    customer: CustomerResponse
    shipping_address: ShippingAddressResponse
    line_items: list[OrderLineResponse]
    shipments: list[ShipmentResponse]
    summary: OrderSummaryResponse
    calculation_note: str
    currency: str = "AUD"
    address_line2: str | None = None
