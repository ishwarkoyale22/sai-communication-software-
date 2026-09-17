-- Phase 2 of serial/IMEI tracking (Phase 1 was the free-text serial_no on
-- sales_items from migration 0028). This adds OPTIONAL per-unit inventory
-- tracking: a product only uses this when inventory.is_serialized = true —
-- every other product keeps working exactly as before with the existing
-- manually-edited `inventory.stock` number. Nothing here changes behavior
-- for non-serialized products.
--
-- For a serialized product, each physical unit (IMEI/serial) is its own row
-- in inventory_units. `inventory.stock` for that product is then KEPT IN
-- SYNC automatically by a trigger that recounts in_stock units on every
-- insert/update/delete — so all the existing UI that reads `inventory.stock`
-- (Sales & Invoices dropdown, Inventory Catalog list/report, Dashboard,
-- low-stock warnings) continues to work unchanged, without needing to know
-- about inventory_units at all.

alter table public.inventory
  add column if not exists is_serialized boolean not null default false;

comment on column public.inventory.is_serialized is
  'When true, this product tracks individual units by serial/IMEI in inventory_units, and inventory.stock is auto-derived (count of in_stock units) rather than manually edited. Default false keeps existing manual-stock behavior for every other product.';

create table if not exists public.inventory_units (
  id uuid primary key default gen_random_uuid(),
  inventory_id uuid not null references public.inventory(id) on delete cascade,
  serial_no text not null,
  status text not null default 'in_stock' check (status in ('in_stock', 'sold', 'returned')),
  sale_item_id uuid references public.sales_items(id) on delete set null,
  created_at timestamptz not null default now(),
  sold_at timestamptz
);

comment on table public.inventory_units is
  'One row per physical serialized unit (e.g. a phone by IMEI) for products with inventory.is_serialized = true. status=in_stock means available to sell; sold/returned units stay on record for traceability.';

create unique index if not exists inventory_units_serial_no_key on public.inventory_units (serial_no);
create index if not exists inventory_units_inventory_id_idx on public.inventory_units (inventory_id);
create index if not exists inventory_units_status_idx on public.inventory_units (status);

-- Keeps inventory.stock equal to the live count of in_stock units, but only
-- for products actually marked is_serialized — never touches stock for any
-- non-serialized product, so manual stock edits everywhere else are unaffected.
create or replace function public.sync_inventory_stock_from_units()
returns trigger
language plpgsql
security definer
as $$
declare
  affected_inventory_id uuid := coalesce(new.inventory_id, old.inventory_id);
begin
  update public.inventory
  set stock = (
    select count(*) from public.inventory_units
    where inventory_id = affected_inventory_id and status = 'in_stock'
  )
  where id = affected_inventory_id and is_serialized = true;
  return null;
end;
$$;

drop trigger if exists inventory_units_sync_stock on public.inventory_units;
create trigger inventory_units_sync_stock
after insert or update or delete on public.inventory_units
for each row execute function public.sync_inventory_stock_from_units();

alter table public.inventory_units enable row level security;

drop policy if exists admin_all_inventory_units on public.inventory_units;
create policy admin_all_inventory_units on public.inventory_units
  for all
  using (is_admin());

grant all on public.inventory_units to anon, authenticated;
