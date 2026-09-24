-- 0051: supplier bills need what a real GST purchase bill carries.
-- Wholesaler invoices already store line items in `items` (jsonb) but the form never filled it, and
-- neither table kept the supplier's GSTIN/address, place of supply, payment mode or terms.
-- Every column is optional, so existing rows and older code keep working unchanged.

alter table public.wholesaler_invoices
  add column if not exists wholesaler_gstin text,
  add column if not exists wholesaler_address text,
  add column if not exists wholesaler_state text,        -- e.g. '27-Maharashtra' (decides CGST+SGST vs IGST)
  add column if not exists place_of_supply text,         -- e.g. '27-Maharashtra'
  add column if not exists payment_mode text,            -- cash / upi / card / bank_transfer / cheque / credit
  add column if not exists terms text;

-- Third-party purchases were one item per row with no bill number, GST or payment details.
-- A purchase can now have several items (kept in `items`); item_name/quantity/unit_price/total_price
-- stay filled with a summary so the list, exports and older code keep working.
alter table public.third_party_purchases
  add column if not exists bill_number text,
  add column if not exists vendor_phone text,
  add column if not exists vendor_gstin text,
  add column if not exists vendor_address text,
  add column if not exists vendor_state text,
  add column if not exists place_of_supply text,
  add column if not exists payment_mode text,
  add column if not exists paid_amount numeric,
  add column if not exists items jsonb,
  add column if not exists terms text;
