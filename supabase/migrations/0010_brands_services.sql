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
