-- Additive only — adds an optional Serial No. / IMEI field captured by the
-- cashier at sale time (Sales & Invoices → New Sale), so it can be shown on
-- the printed/viewed Tax Invoice per line item. Does not alter or drop any
-- existing column, constraint, or data on sales_items, and does not change
-- how inventory stock is counted — this is manual record-keeping per sale
-- line, the same way the shop's paper invoices capture it, not a
-- serialized-inventory ledger.

alter table public.sales_items
  add column if not exists serial_no text;

comment on column public.sales_items.serial_no is
  'Serial number(s) / IMEI(s) for this line, entered by the cashier at sale time. Comma-separated when quantity > 1 (e.g. two phones sold on one line). Optional — null when not applicable (accessories, etc.) or not captured.';

-- Table-level grants already exist for anon/authenticated on sales_items
-- (verified live) — re-asserted explicitly per project convention so this
-- migration is self-contained and doesn't rely on that prior state.
grant all on public.sales_items to anon, authenticated;
