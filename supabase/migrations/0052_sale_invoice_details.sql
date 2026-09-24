-- 0052: New Sale can now capture what a real GST tax invoice carries.
-- All columns are optional: existing sales keep printing exactly as before.
--   sales: customer GSTIN / address / state (B2B customers such as a hospital), the invoice date when it
--          differs from the entry date, the amount actually received (part payments / credit), and terms.
--   sales_items: HSN/SAC and a GST rate per line (a sale can mix 5% / 12% / 18% items).
alter table public.sales
  add column if not exists customer_gstin text,
  add column if not exists customer_address text,
  add column if not exists customer_state text,      -- e.g. '27-Maharashtra' (decides CGST+SGST vs IGST)
  add column if not exists invoice_date date,
  add column if not exists amount_received numeric,  -- null = fully paid (how every older sale worked)
  add column if not exists terms text;

alter table public.sales_items
  add column if not exists hsn_sac text,
  add column if not exists gst_rate numeric;
