-- Phase 2 — additive only. Verified against the LIVE schema (via REST
-- introspection) that none of these columns/tables already exist before
-- writing this — do not trust supabase/migrations/*.sql's older DDL for
-- what's actually live (see Phase 1 notes for why).

-- §5 Customer Management: capture DOB on the customer record.
alter table public.customers
  add column if not exists birthday date;

-- §6 Enquiry Management: "After Contact" notes + a resolution note, kept
-- separate from the single `status` enum so a call log / outcome can be
-- recorded without losing history each time status changes.
alter table public.enquiries
  add column if not exists contact_notes text;
alter table public.enquiries
  add column if not exists resolution_notes text;

-- §8 Brand Management: mobile type/category per brand (e.g. "Budget",
-- "Flagship", "Feature Phone") — free text, admin-defined, not a fixed enum,
-- since the requirement doesn't specify a closed list.
alter table public.brands
  add column if not exists mobile_type text;

-- §7 Gift Hamper Management: a hamper becomes a bundle of up to 5 existing
-- inventory products with a quantity each, instead of one flat item. Kept as
-- its own join table against `hamper_items` (the hamper "shell": name,
-- price, stock) rather than repurposing `inventory` rows directly, so an
-- inventory product can appear inside multiple hampers without being
-- duplicated or losing its own standalone listing.
create table if not exists public.hamper_products (
  id uuid primary key default gen_random_uuid(),
  hamper_id uuid not null references public.hamper_items(id) on delete cascade,
  inventory_id uuid not null references public.inventory(id) on delete restrict,
  quantity integer not null default 1 check (quantity > 0),
  created_at timestamptz not null default now()
);

create index if not exists hamper_products_hamper_id_idx on public.hamper_products(hamper_id);

alter table public.hamper_products enable row level security;

-- This project gates access with RLS policies on top of a blanket table
-- grant (confirmed against a known-working table, hamper_items, which has
-- full grants to both anon/authenticated with RLS doing the real
-- filtering) — a brand new table has NO grant to anon/authenticated by
-- default here, so without this every request 403s with "permission
-- denied for table" regardless of the policies below.
grant all on public.hamper_products to anon, authenticated;

-- Mirror the existing hamper_items policies: authenticated staff/admin can
-- manage hamper composition; public (anon) can read for the storefront.
drop policy if exists "hamper_products_select_all" on public.hamper_products;
create policy "hamper_products_select_all" on public.hamper_products
  for select using (true);

drop policy if exists "hamper_products_write_authenticated" on public.hamper_products;
create policy "hamper_products_write_authenticated" on public.hamper_products
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- Enforce "up to 5 products" at the database level too (not just the UI),
-- via a trigger — a plain CHECK constraint can't count sibling rows.
create or replace function public.enforce_hamper_product_limit()
returns trigger
language plpgsql
as $$
begin
  if (select count(*) from public.hamper_products where hamper_id = new.hamper_id) >= 5 then
    raise exception 'A gift hamper can contain at most 5 products.';
  end if;
  return new;
end;
$$;

drop trigger if exists hamper_products_limit_trigger on public.hamper_products;
create trigger hamper_products_limit_trigger
  before insert on public.hamper_products
  for each row execute function public.enforce_hamper_product_limit();

-- New table needs to be added to the realtime publication explicitly too —
-- see 0017_realtime_publication_coverage.sql for why this is required
-- (a table not in supabase_realtime never fires postgres_changes events,
-- silently, no error). Guarded because `alter publication ... add table`
-- has no `if not exists` form and errors on a rerun.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'hamper_products'
  ) then
    alter publication supabase_realtime add table public.hamper_products;
  end if;
end $$;
