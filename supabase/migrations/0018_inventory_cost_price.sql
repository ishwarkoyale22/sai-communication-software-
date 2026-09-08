-- Phase 1 (Dashboard: Gross Profit) — additive only.
-- The live `inventory` table (per apps/admin/src/pages/Inventory.tsx) has no
-- cost/purchase-price column — `original_price` is a "was" / MRP price, not
-- a cost basis, so Gross Profit cannot be computed without one. This adds a
-- nullable cost_price the admin can fill in per product; rows left null are
-- simply excluded from the Gross Profit calculation (never break existing
-- reads/writes — no other column is touched).

alter table public.inventory
  add column if not exists cost_price numeric;

comment on column public.inventory.cost_price is
  'Purchase/cost price used to compute Gross Profit on the Dashboard. Nullable — rows without a cost_price are excluded from profit calculations rather than assumed zero.';
