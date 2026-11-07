export type OrderStatus = 'draft' | 'confirmed' | 'in_transit' | 'completed';
export type TrackingStatus = 'delivered' | 'partially_delivered' | 'in_transit' | 'pending' | 'unknown' | 'not_queried' | 'not_implemented' | 'unavailable';

export interface OrderLine {
  id: number;
  sku: string;
  product_name: string;
  quantity: number;
  rrp_incl_gst: string;
  gst_rate_percent: string;
  ex_gst_unit_price: string;
  line_subtotal_ex_gst: string;
  tracking_group?: string | null;
  product_weight_g?: number | null;
}

export interface Shipment {
  id: number;
  tracking_group: string;
  carrier: string;
  carrier_id: number | null;
  shipping_account_profile_id?: string | null;
  shipping_account_label?: string | null;
  shipping_account_number_masked?: string | null;
  tracking_number: string | null;
  shipping_fee: string;
  shipping_quote_status: 'quoted' | 'not_quoted' | 'unavailable';
  order_line_ids: number[];
}

export interface ShippingAccountProfile {
  id: string;
  label: string;
  account_number_masked: string;
  environment: 'test' | 'production' | string;
  enabled: boolean;
  pricing_enabled: boolean;
  default_for_pricing: boolean;
  configured: boolean;
}

export interface Carrier {
  id: number;
  code: string;
  name: string;
  description: string | null;
  is_active: boolean;
  used?: boolean;
  rate_capability: 'SUPPORTED' | 'NOT_IMPLEMENTED' | string;
  tracking_capability: 'SUPPORTED' | 'NOT_IMPLEMENTED' | string;
}

export interface ShippingQuote {
  quote_id: string;
  service_name: string;
  product_id: string | null;
  total_cost: string;
  shipping_cost: string;
  fuel_surcharge: string;
  gst: string;
}

export interface ApiErrorPayload {
  detail?: string | { code?: string; message?: string };
}

export interface Order {
  id: number;
  order_id: string;
  order_date: string;
  status: OrderStatus;
  company_name: string;
  customer: { name: string; phone: string; email: string };
  shipping_address: Record<string, string>;
  line_items: OrderLine[];
  shipments: Shipment[];
  summary: { currency: 'AUD'; subtotal_ex_gst: string; gst_rate: string; gst_amount: string; shipment_fee: string; total: string };
}
