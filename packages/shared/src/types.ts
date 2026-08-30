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

export interface FinancePartner {
  id: string;
  name: string;
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

