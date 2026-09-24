// Shared domain types, mirroring supabase/migrations/0001_init_schema.sql
// and the gap-filling 0005/0006 migrations.

// Category is admin-configurable (categories table) as of 0005 — this list is
// just the seeded default, used as a fallback before the categories table has
// loaded. Prefer fetching from `categories` (select name where is_active).
export type Category = string;

export const CATEGORIES: Category[] = [
  "Mobiles",
  "TVs",
  "ACs",
  "Laptops",
  "Accessories",
  "Gift Hampers",
  "Other",
];

export interface DbCategory {
  name: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
}

export interface Brand {
  name: string;
  is_active: boolean;
  created_at: string;
}

export interface Service {
  id: string;
  name: string;
  description: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
}

export interface Product {
  id: string;
  name: string;
  category: Category;
  brand: string | null;
  model: string | null;
  serial_number: string | null;
  description: string | null;
  image_url: string | null;
  sku: string | null;
  purchase_price: number;
  sale_price: number;
  stock_qty: number;
  min_stock_alert: number;
  barcode: string | null;
  buyer_code: string | null;
  is_gift_hamper: boolean;
  hamper_item_ids: string[] | null;
  is_active: boolean;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

// The live product/stock table is `inventory`, not `products` — the
// `Product`/`CATEGORIES` types above describe a schema that predates a
// migration applied directly to the database (see WholesalerInvoices'
// history for the same drift). This is the type that actually matches
// `public.inventory` today; use it for anything reading real stock data
// (the website's catalog/homepage, the staff app), not `Product`.
export type InventoryCategory = "Smartphones" | "Feature Phones" | "Tablets" | "Accessories" | "Refurbished";

export const INVENTORY_CATEGORIES: InventoryCategory[] = [
  "Smartphones",
  "Feature Phones",
  "Tablets",
  "Accessories",
  "Refurbished",
];

export interface Inventory {
  id: string;
  name: string;
  brand_id: string | null;
  brand?: { name: string } | null; // populated via `.select("*, brand:brands(name)")`
  model: string;
  category: InventoryCategory | null;
  product_type: "new" | "refurbished";
  price: number;
  original_price: number | null;
  stock: number;
  images: string[] | null;
  specs: Record<string, unknown> | null;
  condition: "Excellent" | "Good" | "Fair" | null;
  grade: "A" | "B" | "C" | null;
  battery_health: number | null;
  warranty_months: number;
  is_featured: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  cost_price: number | null;
  /** When true, stock is tracked per physical unit in `inventory_units` (see InventoryUnit) and `stock` is auto-derived — not manually edited. */
  is_serialized: boolean;
}

export type InventoryUnitStatus =
  | "in_stock"
  | "sold"
  | "returned"
  | "warranty"
  | "repair"
  | "replaced"
  | "damaged"
  | "lost"
  | "pending_imei"
  | "cancelled";

/** One physical unit (IMEI/serial) of a product with `inventory.is_serialized = true`. */
export interface InventoryUnit {
  id: string;
  inventory_id: string;
  /** Primary IMEI (15-digit, Luhn-valid). Null for serial-only accessories. */
  imei_1: string | null;
  /** Secondary IMEI for dual-SIM devices — same physical unit as imei_1. */
  imei_2: string | null;
  /** Serial number — sole identifier for non-IMEI serialized products, or alongside imei_1/imei_2. */
  serial_no: string | null;
  status: InventoryUnitStatus;
  sale_item_id: string | null;
  purchase_price: number | null;
  purchase_invoice_ref: string | null;
  supplier_id: string | null;
  current_location: string | null;
  /** Set on the NEW unit issued in a replacement — points at the OLD unit it replaces. */
  replaced_from_unit_id: string | null;
  /** Set on the OLD unit once replaced — points at the NEW unit issued in its place. */
  replaced_by_unit_id: string | null;
  customer_id: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  sold_at: string | null;
}

export type ImeiHistoryEventType =
  | "purchase"
  | "in_stock"
  | "sale"
  | "return"
  | "warranty"
  | "repair"
  | "replaced"
  | "status_change"
  | "cancelled"
  | "note";

/** Immutable audit event on a stock unit's lifecycle timeline. */
export interface ImeiHistoryEvent {
  id: string;
  stock_unit_id: string;
  imei_1: string | null;
  imei_2: string | null;
  event_type: ImeiHistoryEventType;
  event_date: string;
  reference_type: string | null;
  reference_id: string | null;
  from_status: InventoryUnitStatus | null;
  to_status: InventoryUnitStatus | null;
  customer_id: string | null;
  supplier_id: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
}

export interface Supplier {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  gstin: string | null;
  notes: string | null;
  created_at: string;
}

export type StockMovementType = "purchase" | "sale" | "sale_return" | "adjustment" | "initial";

export interface StockMovement {
  id: string;
  product_id: string;
  change_qty: number;
  resulting_qty: number;
  movement_type: StockMovementType;
  reference_table: string | null;
  reference_id: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
}

export interface CustomerNote {
  id: string;
  customer_id: string;
  staff_id: string | null;
  note: string;
  created_at: string;
}

export interface BusinessProfile {
  name: string;
  address: string;
  phone: string;
  gstin: string;
  invoice_prefix: string;
}

export type SaleType = "online" | "offline";
export type PaymentMethod = "cash" | "card" | "upi" | "bank_transfer" | "other";
// The live `sales.payment_method` check constraint — matches "cash",
// "upi", "card", "emi", "credit" (not the values in PaymentMethod above,
// which predate the same schema drift documented on the Inventory type).
export type SalePaymentMethod = "cash" | "upi" | "card" | "emi" | "credit" | "bank_transfer";
export type SaleTypeLive = "in_store" | "website" | "emi";
export type SalePaymentStatus = "paid" | "pending" | "partial";

export interface Sale {
  id: string;
  invoice_number: string;
  customer_id: string | null;
  staff_id: string | null;
  sale_type: SaleType;
  payment_method: PaymentMethod | null;
  total_amount: number;
  purchase_total: number;
  discount_total: number;
  taxable_value: number;
  cgst_total: number;
  sgst_total: number;
  igst_total: number;
  gst_applicable: boolean;
  gst_number: string | null;
  finance_partner_id: string | null;
  emi_months: number | null;
  emi_amount: number | null;
  staff_notes: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
}

export interface SaleItem {
  id: string;
  sale_id: string;
  product_id: string | null;
  qty: number;
  unit_price: number;
  purchase_price: number;
  discount: number;
  gst_rate: number;
  hsn_sac: string | null;
  cgst: number;
  sgst: number;
  igst: number;
}

export interface Customer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  birthday: string | null;
  gst_number: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
}

export type RepairStatus =
  | "received"
  | "in_progress"
  | "waiting_parts"
  | "ready"
  | "collected";

export const REPAIR_STATUSES: RepairStatus[] = [
  "received",
  "in_progress",
  "waiting_parts",
  "ready",
  "collected",
];

export type RepairChannel = "online" | "offline";

export interface Repair {
  id: string;
  repair_number: string;
  repair_enquiry_id: string | null;
  customer_id: string | null;
  assigned_staff: string | null;
  device_name: string;
  issue_description: string | null;
  estimated_cost: number | null;
  final_cost: number | null;
  status: RepairStatus;
  channel: RepairChannel;
  received_at: string;
  completed_at: string | null;
}

// Submitted from the public website's repair enquiry form (table:
// repair_enquiries). Distinct from `Repair`, which is the admin/staff
// work-order created FROM one of these via the Repair Enquiries page.
export interface RepairEnquiry {
  id: string;
  enquiry_number: string;
  customer_name: string;
  phone: string;
  email: string | null;
  phone_brand: string;
  phone_model: string;
  problem_type: string;
  description: string | null;
  image_urls: string[];
  video_urls: string[];
  preferred_contact: string;
  status: string;
  admin_notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Staff {
  id: string;
  name: string;
  role: string;
  phone: string;
  pin: string;
  auth_user_id: string | null;
  is_active: boolean;
  created_at: string;
}

export interface Attendance {
  id: string;
  staff_id: string;
  clock_in: string;
  clock_out: string | null;
  clock_in_lat: number | null;
  clock_in_lng: number | null;
  clock_out_lat: number | null;
  clock_out_lng: number | null;
}

export interface WholesalerInvoice {
  id: string;
  supplier_name: string;
  invoice_number: string | null;
  invoice_date: string | null;
  total_amount: number | null;
  file_url: string | null;
  processed: boolean;
  created_at: string;
}

export interface InvoiceItem {
  id: string;
  invoice_id: string;
  product_id: string | null;
  product_name: string;
  qty: number;
  unit_cost: number;
}

export interface ThirdPartyPurchase {
  id: string;
  vendor_name: string;
  item_description: string | null;
  amount: number;
  category: string | null;
  date: string;
  notes: string | null;
}

export type FinanceIntegrationType = "manual" | "portal_based" | "pos_based" | "api_integrated";

export interface FinancePartner {
  id: string;
  name: string;
  short_code: string | null;
  description: string | null;
  logo_url: string | null;
  min_amount: number | null;
  max_amount: number | null;
  available_tenures: number[];
  processing_fee_pct: number;
  integration_type: FinanceIntegrationType;
  contact_notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type FinanceStatus =
  | "draft"
  | "application_started"
  | "submitted"
  | "pending"
  | "approved"
  | "disbursement_pending"
  | "disbursed"
  | "settlement_pending"
  | "settled"
  | "rejected"
  | "cancelled"
  | "failed";

export const FINANCE_STATUSES: FinanceStatus[] = [
  "draft",
  "application_started",
  "submitted",
  "pending",
  "approved",
  "disbursement_pending",
  "disbursed",
  "settlement_pending",
  "settled",
  "rejected",
  "cancelled",
  "failed",
];

/** Allowed next statuses per current status — mirrors the DB trigger in 0031_finance_module.sql; keep both in sync. */
export const FINANCE_STATUS_TRANSITIONS: Record<FinanceStatus, FinanceStatus[]> = {
  draft: ["application_started", "cancelled"],
  application_started: ["submitted", "cancelled"],
  submitted: ["pending", "cancelled"],
  pending: ["approved", "rejected", "cancelled"],
  approved: ["disbursement_pending", "cancelled"],
  disbursement_pending: ["disbursed", "failed", "cancelled"],
  disbursed: ["settlement_pending"],
  settlement_pending: ["settled", "failed"],
  settled: [],
  rejected: [],
  cancelled: [],
  failed: [],
};

export type ReconciliationStatus = "pending" | "matched" | "mismatch";

export interface FinanceTransaction {
  id: string;
  customer_id: string | null;
  sale_id: string | null;
  stock_unit_id: string | null;
  /** Nullable — required for new finance sales at the app layer (Finance.tsx), but legacy backfilled emi_finance rows whose free-text company didn't match a real partner are allowed a null link rather than inventing one. */
  finance_partner_id: string | null;
  invoice_number: string | null;
  customer_name: string;
  customer_phone: string | null;
  product_name: string;
  brand: string | null;
  model: string | null;
  imei_1: string | null;
  imei_2: string | null;
  serial_no: string | null;
  sale_amount: number;
  down_payment: number;
  customer_paid_amount: number;
  finance_amount: number;
  tenure_months: number;
  emi_amount: number;
  finance_date: string;
  application_number: string | null;
  agreement_number: string | null;
  status: FinanceStatus;
  notes: string | null;
  expected_settlement_amount: number | null;
  actual_settlement_amount: number | null;
  processing_fee: number;
  commission: number;
  other_deduction: number;
  adjustment: number;
  settlement_date: string | null;
  settlement_reference: string | null;
  reconciliation_status: ReconciliationStatus;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  finance_partner?: { name: string; short_code: string | null } | null;
}

export interface FinanceStatusHistoryEvent {
  id: string;
  finance_transaction_id: string;
  from_status: FinanceStatus | null;
  to_status: FinanceStatus;
  note: string | null;
  changed_by: string | null;
  created_at: string;
}

export interface Enquiry {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  message: string | null;
  product_interest: string | null;
  status: "new" | "contacted" | "closed";
  customer_id: string | null; // auto-linked to customers on insert, see 0005 trigger
  created_at: string;
}

export interface ClientReport {
  id: string;
  customer_id: string;
  staff_id: string;
  title: string;
  notes: string | null;
  file_url: string | null;
  created_at: string;
}

export type ReviewStatus = "pending" | "approved" | "rejected";

export interface Review {
  id: string;
  customer_name: string;
  phone: string | null;
  rating: number;
  comment: string | null;
  status: ReviewStatus;
  created_at: string;
}

export interface Profile {
  id: string;
  role: "admin" | "staff";
  staff_id: string | null;
}

export type WebOrderStatus = "pending" | "confirmed" | "processing" | "ready" | "delivered" | "cancelled";

export interface WebOrderItem {
  id: string;
  order_id: string;
  item_type: string;
  product_id: string | null;
  name: string;
  brand: string | null;
  quantity: number;
  unit_price: number;
  total_price: number;
  variant_info?: Record<string, any>;
}

export interface WebPayment {
  id: string;
  order_id: string;
  payment_method: string;
  payment_gateway: string;
  transaction_id: string | null;
  amount: number;
  payment_status: string;
  created_at: string;
}

export interface WebOrder {
  id: string;
  order_number: string;
  customer_id: string | null;
  customer_name: string;
  customer_phone: string;
  customer_email: string | null;
  customer_address: string | null;
  order_type: string;
  payment_type: "full" | "emi";
  finance_partner_id: string | null;
  finance_tenure: number | null;
  finance_down_payment: number | null;
  finance_monthly_emi: number | null;
  subtotal: number;
  discount_amount: number;
  total_amount: number;
  order_status: WebOrderStatus;
  delivery_type: string;
  delivery_status: string;
  internal_notes: string | null;
  created_at: string;
  updated_at: string;
  order_items?: WebOrderItem[];
  payments?: WebPayment[];
}

