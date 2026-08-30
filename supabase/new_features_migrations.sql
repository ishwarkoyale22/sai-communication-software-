-- ============================================================================
-- 0007_repair_channel.sql
-- Distinguishes online vs offline repair entries, mirroring the existing
-- sales.sale_type pattern (client requirement #15). Defaults existing rows
-- to 'offline' since every repair so far was walk-in/manual.
-- ============================================================================

alter table repairs
  add column if not exists channel text not null default 'offline' check (channel in ('online', 'offline'));

create index if not exists idx_repairs_channel on repairs (channel);
-- ============================================================================
-- 0008_client_reports.sql
-- Staff can create a report for a specific client and attach a file; Admin
-- can view every submitted report (client requirement #3).
-- Follows the existing wholesaler-invoices pattern: a private Storage bucket
-- + a table row per submission. Create the bucket manually the same way
-- (see README) — bucket creation itself stays a manual dashboard step to
-- match how wholesaler-invoices was set up; this migration only adds the
-- table, RLS, and the matching storage.objects policies.
-- ============================================================================

create table if not exists client_reports (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers (id) on delete cascade,
  staff_id uuid not null references staff (id),
  title text not null,
  notes text,
  file_url text, -- Supabase Storage path in the 'client-reports' bucket
  created_at timestamptz not null default now()
);

create index if not exists idx_client_reports_customer on client_reports (customer_id, created_at desc);
create index if not exists idx_client_reports_staff on client_reports (staff_id, created_at desc);

alter table client_reports enable row level security;

drop policy if exists "admin_all_client_reports" on client_reports;
create policy "admin_all_client_reports" on client_reports for all using (is_admin()) with check (is_admin());

drop policy if exists "staff_insert_client_reports" on client_reports;
create policy "staff_insert_client_reports" on client_reports for insert
  with check (is_staff() and staff_id = current_staff_id());

drop policy if exists "staff_read_own_client_reports" on client_reports;
create policy "staff_read_own_client_reports" on client_reports for select
  using (is_staff() and staff_id = current_staff_id());

-- ----------------------------------------------------------------------------
-- Storage: 'client-reports' bucket — create it manually in the dashboard
-- (Storage → New bucket → name "client-reports", private), same as the
-- existing 'wholesaler-invoices' bucket. These policies then govern it.
-- ----------------------------------------------------------------------------
drop policy if exists "admin_all_client_report_files" on storage.objects;
create policy "admin_all_client_report_files" on storage.objects for all
  to authenticated
  using (bucket_id = 'client-reports' and is_admin())
  with check (bucket_id = 'client-reports' and is_admin());

drop policy if exists "staff_insert_client_report_files" on storage.objects;
create policy "staff_insert_client_report_files" on storage.objects for insert
  to authenticated
  with check (bucket_id = 'client-reports' and is_staff());

drop policy if exists "staff_read_client_report_files" on storage.objects;
create policy "staff_read_client_report_files" on storage.objects for select
  to authenticated
  using (bucket_id = 'client-reports' and is_staff());
-- ============================================================================
-- 0009_reviews.sql
-- Public online customer reviews (client requirement #4). Distinct from the
-- existing `customer_notes` table, which is internal staff notes about a
-- customer — this is a customer-submitted, admin-moderated public review.
-- ============================================================================

create table if not exists reviews (
  id uuid primary key default gen_random_uuid(),
  customer_name text not null,
  phone text,
  rating integer not null check (rating between 1 and 5),
  comment text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);

create index if not exists idx_reviews_status on reviews (status);

alter table reviews enable row level security;

-- anyone can submit a review
drop policy if exists "public_insert_reviews" on reviews;
create policy "public_insert_reviews" on reviews for insert
  to anon
  with check (true);

-- anyone (including the website) can read approved reviews, e.g. a
-- "Customer Stories" section — pending/rejected stay admin-only
drop policy if exists "public_read_approved_reviews" on reviews;
create policy "public_read_approved_reviews" on reviews for select
  to anon
  using (status = 'approved');

-- admin manages everything (approve/reject/delete)
drop policy if exists "admin_all_reviews" on reviews;
create policy "admin_all_reviews" on reviews for all using (is_admin()) with check (is_admin());

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'reviews'
  ) then
    alter publication supabase_realtime add table reviews;
  end if;
end $$;
-- ============================================================================
-- 0010_brands_services.sql
-- Brand & Service management (client requirement #9). Mirrors the existing
-- `categories` pattern from 0005: products.brand stays a free-text column
-- (no app-code break) but now references brands.name via FK, so brands are
-- admin-manageable instead of arbitrary uncontrolled text. Services move
-- from static website copy to an admin-manageable table.
-- ============================================================================

create table if not exists brands (
  name text primary key,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- backfill any brand names already sitting on products so the FK below
-- doesn't reject existing data
insert into brands (name)
  select distinct brand from products where brand is not null
  on conflict (name) do nothing;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'products_brand_fkey') then
    alter table products
      add constraint products_brand_fkey foreign key (brand)
      references brands (name) on update cascade;
  end if;
end $$;

create table if not exists services (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- seed with the site's current static services so nothing changes visually
-- the moment this migration runs
insert into services (name, description, sort_order) values
  ('Repairs', 'In-house repair for mobiles, TVs, ACs & laptops. Bring in your device for a free estimate — we''ll keep you posted at every stage.', 1),
  ('EMI Options', 'Buy now, pay monthly with our finance partners — Bajaj Finance, Home Credit, IDFC First Bank and more, available at checkout in-store.', 2),
  ('Gift Hampers', 'Curated electronics gift hampers for festivals and special occasions — mix and match products or pick a ready-made bundle.', 3)
on conflict do nothing;

alter table brands enable row level security;
alter table services enable row level security;

drop policy if exists "admin_all_brands" on brands;
create policy "admin_all_brands" on brands for all using (is_admin()) with check (is_admin());
drop policy if exists "staff_read_brands" on brands;
create policy "staff_read_brands" on brands for select using (is_staff());
drop policy if exists "public_read_active_brands" on brands;
create policy "public_read_active_brands" on brands for select to anon using (is_active = true);

drop policy if exists "admin_all_services" on services;
create policy "admin_all_services" on services for all using (is_admin()) with check (is_admin());
drop policy if exists "staff_read_services" on services;
create policy "staff_read_services" on services for select using (is_staff());
drop policy if exists "public_read_active_services" on services;
create policy "public_read_active_services" on services for select to anon using (is_active = true);
-- ============================================================================
-- 0011_security_fixes.sql
-- Fixes an authorization gap: process_wholesaler_invoice runs as
-- `security definer` (bypasses RLS) but never checked the caller was admin,
-- so any anon/staff API caller could invoke it directly to inflate stock or
-- rewrite purchase_price on arbitrary products. adjust_stock_manual already
-- did this correctly (0005) — this brings process_wholesaler_invoice in line
-- with it. No schema/data change, just a stricter function body.
-- ============================================================================

create or replace function process_wholesaler_invoice(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  item record;
  v_new_qty integer;
begin
  if not is_admin() then
    raise exception 'Only admin can process wholesaler invoices';
  end if;

  for item in
    select * from invoice_items where invoice_id = p_invoice_id
  loop
    if item.product_id is not null then
      update products
      set stock_qty = stock_qty + item.qty,
          purchase_price = item.unit_cost
      where id = item.product_id
      returning stock_qty into v_new_qty;

      insert into stock_movements (product_id, change_qty, resulting_qty, movement_type, reference_table, reference_id)
      values (item.product_id, item.qty, v_new_qty, 'purchase', 'invoice_items', item.id);
    end if;
  end loop;

  update wholesaler_invoices
  set processed = true
  where id = p_invoice_id;
end;
$$;
