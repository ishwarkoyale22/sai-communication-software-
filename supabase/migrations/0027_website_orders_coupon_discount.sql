-- Additive only — adds coupon/discount tracking to website_orders for the
-- customer website's checkout flow. Does not alter or drop any existing
-- column, constraint, or data on website_orders.

alter table public.website_orders
  add column if not exists coupon_code text;

alter table public.website_orders
  add column if not exists discount_amount numeric default 0;

comment on column public.website_orders.coupon_code is
  'Coupon code applied at checkout, if any (matches offers.coupon_code for offer_type = coupon).';
comment on column public.website_orders.discount_amount is
  'Total discount amount applied to this order (from a coupon and/or an active offer) — defaults to 0 for orders with no discount.';

-- Table-level grants already exist for anon/authenticated on
-- website_orders (verified live) — re-asserted explicitly per request so
-- this migration is self-contained and doesn't rely on that prior state.
grant all on public.website_orders to anon, authenticated;
