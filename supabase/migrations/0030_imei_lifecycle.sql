-- Phase 3A of IMEI/serial tracking (Phase 1: free-text serial_no on
-- sales_items; Phase 2: inventory_units with a single serial_no + 3
-- statuses). This extends inventory_units into a full dual-IMEI stock unit
-- with the complete lifecycle, plus an immutable imei_history audit trail.
-- Additive only — every existing column, row, and behavior on
-- inventory_units keeps working; is_serialized-gated stock sync is
-- untouched. Reuses the existing `suppliers` table rather than inventing a
-- new purchase-order system this app doesn't otherwise have.

alter table public.inventory_units
  add column if not exists imei_1 text,
  add column if not exists imei_2 text,
  add column if not exists purchase_price numeric,
  add column if not exists purchase_invoice_ref text,
  add column if not exists supplier_id uuid references public.suppliers(id) on delete set null,
  add column if not exists current_location text,
  add column if not exists replaced_from_unit_id uuid references public.inventory_units(id) on delete set null,
  add column if not exists replaced_by_unit_id uuid references public.inventory_units(id) on delete set null,
  add column if not exists customer_id uuid references public.customers(id) on delete set null,
  add column if not exists created_by uuid,
  add column if not exists updated_by uuid,
  add column if not exists updated_at timestamptz not null default now();

comment on column public.inventory_units.imei_1 is 'Primary IMEI (15-digit, Luhn-validated at the app layer). Null for serial-only accessories.';
comment on column public.inventory_units.imei_2 is 'Secondary IMEI for dual-SIM devices — same physical unit as imei_1, not a separate stock unit.';
comment on column public.inventory_units.serial_no is 'Serial number for this unit — used as the sole identifier for non-IMEI serialized products, or alongside imei_1/imei_2 for phones that also print a serial.';

-- serial_no was NOT NULL from Phase 2, when it was the only identifier a
-- unit could have. Now that imei_1/imei_2 exist as alternatives, it must be
-- nullable — a phone can be identified by IMEI alone with no separate
-- serial number. The check below still requires at least one identifier.
alter table public.inventory_units alter column serial_no drop not null;

alter table public.inventory_units drop constraint if exists inventory_units_has_identifier_check;
alter table public.inventory_units add constraint inventory_units_has_identifier_check
  check (imei_1 is not null or imei_2 is not null or serial_no is not null);

-- Expand the lifecycle beyond in_stock/sold/returned to the full state
-- machine (transitions are validated at the application layer, not here).
alter table public.inventory_units drop constraint if exists inventory_units_status_check;
alter table public.inventory_units add constraint inventory_units_status_check
  check (status in ('in_stock', 'sold', 'returned', 'warranty', 'repair', 'replaced', 'damaged', 'lost', 'pending_imei', 'cancelled'));

create index if not exists inventory_units_imei_1_lookup_idx on public.inventory_units (imei_1);
create index if not exists inventory_units_imei_2_lookup_idx on public.inventory_units (imei_2);
create index if not exists inventory_units_supplier_id_idx on public.inventory_units (supplier_id);
create index if not exists inventory_units_customer_id_idx on public.inventory_units (customer_id);

-- A given IMEI must be globally unique and must never appear as imei_1 on
-- one unit and imei_2 on another — a plain per-column unique index can't
-- express that, so this trigger checks both columns on every insert/update.
create or replace function public.validate_imei_uniqueness()
returns trigger
language plpgsql
as $$
begin
  if new.imei_1 is not null and new.imei_1 = new.imei_2 then
    raise exception 'IMEI 1 and IMEI 2 cannot be the same.';
  end if;

  if new.imei_1 is not null and exists (
    select 1 from public.inventory_units
    where id <> new.id and (imei_1 = new.imei_1 or imei_2 = new.imei_1)
  ) then
    raise exception 'IMEI % already exists.', new.imei_1;
  end if;

  if new.imei_2 is not null and exists (
    select 1 from public.inventory_units
    where id <> new.id and (imei_1 = new.imei_2 or imei_2 = new.imei_2)
  ) then
    raise exception 'IMEI % already exists.', new.imei_2;
  end if;

  return new;
end;
$$;

drop trigger if exists inventory_units_validate_imei on public.inventory_units;
create trigger inventory_units_validate_imei
before insert or update of imei_1, imei_2 on public.inventory_units
for each row execute function public.validate_imei_uniqueness();

drop trigger if exists inventory_units_set_updated_at on public.inventory_units;
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create trigger inventory_units_set_updated_at
before update on public.inventory_units
for each row execute function public.set_updated_at();

-- Immutable per-unit event log — the full PURCHASE -> IN_STOCK -> SOLD ->
-- RETURNED -> WARRANTY -> REPLACED -> ... chain from the spec. Rows are
-- never deleted or edited; corrections are new rows (event_type='note' or
-- a cancellation event), matching "never delete historical IMEI events."
create table if not exists public.imei_history (
  id uuid primary key default gen_random_uuid(),
  stock_unit_id uuid not null references public.inventory_units(id) on delete cascade,
  imei_1 text,
  imei_2 text,
  event_type text not null check (event_type in (
    'purchase', 'in_stock', 'sale', 'return', 'warranty', 'repair',
    'replaced', 'status_change', 'cancelled', 'note'
  )),
  event_date timestamptz not null default now(),
  reference_type text,
  reference_id text,
  from_status text,
  to_status text,
  customer_id uuid references public.customers(id) on delete set null,
  supplier_id uuid references public.suppliers(id) on delete set null,
  notes text,
  created_by uuid,
  created_at timestamptz not null default now()
);

comment on table public.imei_history is 'Immutable chronological event log per stock unit — never updated or deleted, only appended to.';

create index if not exists imei_history_stock_unit_id_idx on public.imei_history (stock_unit_id);
create index if not exists imei_history_event_date_idx on public.imei_history (event_date);
create index if not exists imei_history_imei_1_idx on public.imei_history (imei_1);
create index if not exists imei_history_imei_2_idx on public.imei_history (imei_2);

alter table public.imei_history enable row level security;
drop policy if exists admin_all_imei_history on public.imei_history;
create policy admin_all_imei_history on public.imei_history
  for all
  using (is_admin());

-- History rows are append-only from the app's perspective — block UPDATE
-- and DELETE outright (even for admins) so "never delete historical IMEI
-- events" is enforced at the database, not just by convention.
revoke update, delete on public.imei_history from anon, authenticated;
grant select, insert on public.imei_history to anon, authenticated;
