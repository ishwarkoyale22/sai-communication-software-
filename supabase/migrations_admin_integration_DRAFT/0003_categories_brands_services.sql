-- ============================================================================
-- 0003_categories_brands_services.sql  (DRAFT — for review)
-- New: categories, services. Reuses existing live `brands` table as-is
-- (adds RLS only — no column changes to brands, no data touched).
-- Depends on: 0001.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- categories: admin-configurable list. products.category stays free text
-- (no FK added) so existing product rows/website code are never at risk of
-- being rejected by a constraint.
-- ----------------------------------------------------------------------------
create table if not exists categories (
  name text primary key,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- seed from whatever categories already exist on live products, so the
-- admin dropdown reflects reality immediately (no destructive assumption
-- about a fixed category list)
insert into categories (name, sort_order)
  select distinct category, 0 from products where category is not null
  on conflict (name) do nothing;

alter table categories enable row level security;

drop policy if exists "admin_all_categories" on categories;
create policy "admin_all_categories" on categories for all
  using (is_admin()) with check (is_admin());

drop policy if exists "staff_read_categories" on categories;
create policy "staff_read_categories" on categories for select
  using (is_staff());

drop policy if exists "public_read_active_categories" on categories;
create policy "public_read_active_categories" on categories for select
  to anon using (is_active = true);

-- ----------------------------------------------------------------------------
-- services: admin-manageable "what we offer" list (repairs/EMI/etc.)
-- ----------------------------------------------------------------------------
create table if not exists services (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table services enable row level security;

drop policy if exists "admin_all_services" on services;
create policy "admin_all_services" on services for all
  using (is_admin()) with check (is_admin());

drop policy if exists "staff_read_services" on services;
create policy "staff_read_services" on services for select
  using (is_staff());

drop policy if exists "public_read_active_services" on services;
create policy "public_read_active_services" on services for select
  to anon using (is_active = true);

-- ----------------------------------------------------------------------------
-- brands: reuse existing live table (id, name, logo_url, display_order,
-- is_active, created_at) as-is. Only adding admin/staff RLS on top of
-- whatever public-read policy already exists — no column changes.
-- ----------------------------------------------------------------------------
drop policy if exists "admin_all_brands" on brands;
create policy "admin_all_brands" on brands for all
  using (is_admin()) with check (is_admin());

drop policy if exists "staff_read_brands" on brands;
create policy "staff_read_brands" on brands for select
  using (is_staff());
