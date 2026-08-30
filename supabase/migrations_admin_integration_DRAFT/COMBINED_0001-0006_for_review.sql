-- ============================================================================
-- 0001_admin_auth_and_staff.sql  (DRAFT — for review, not applied)
-- Adds Supabase-Auth-backed admin/staff identity on top of the existing
-- live schema. Does not touch products/brands/settings/customers/etc.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- profiles: links a Supabase Auth user to a role (admin | staff)
-- ----------------------------------------------------------------------------
create table if not exists profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('admin', 'staff')),
  staff_id uuid,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- staff
-- ----------------------------------------------------------------------------
create table if not exists staff (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  role text not null default 'cashier',
  phone text not null unique,
  pin text not null,
  auth_user_id uuid references auth.users (id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_staff_id_fkey') then
    alter table profiles
      add constraint profiles_staff_id_fkey foreign key (staff_id) references staff (id) on delete cascade;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- Helper functions used by every RLS policy below/in later files
-- ----------------------------------------------------------------------------
create or replace function is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin'
  );
$$;

create or replace function is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role in ('admin', 'staff')
  );
$$;

create or replace function current_staff_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select staff_id from profiles where id = auth.uid();
$$;

-- ----------------------------------------------------------------------------
-- RLS: profiles / staff (no public exposure — admin/staff only)
-- ----------------------------------------------------------------------------
alter table profiles enable row level security;

drop policy if exists "self_read_profile" on profiles;
create policy "self_read_profile" on profiles for select
  using (id = auth.uid());

drop policy if exists "admin_all_profiles" on profiles;
create policy "admin_all_profiles" on profiles for all
  using (is_admin()) with check (is_admin());

alter table staff enable row level security;

drop policy if exists "admin_all_staff" on staff;
create policy "admin_all_staff" on staff for all
  using (is_admin()) with check (is_admin());

drop policy if exists "staff_read_own_row" on staff;
create policy "staff_read_own_row" on staff for select
  using (is_staff() and id = current_staff_id());
-- ============================================================================
-- 0002_products_customers_enquiries_additive.sql  (DRAFT — for review)
-- Additive-only columns on EXISTING live tables: products, customers,
-- enquiries. No column is dropped, renamed, or has its data touched.
-- Depends on: 0001 (is_admin/is_staff functions).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- products: admin/ERP fields, all nullable/defaulted, existing rows unaffected
-- ----------------------------------------------------------------------------
alter table products
  add column if not exists sku text,
  add column if not exists purchase_price numeric(12, 2) not null default 0,
  add column if not exists min_stock_alert integer not null default 3,
  add column if not exists barcode text,
  add column if not exists buyer_code text,
  add column if not exists model text,
  add column if not exists serial_number text,
  add column if not exists created_by uuid references auth.users (id),
  add column if not exists updated_by uuid references auth.users (id);

-- unique constraints added separately (not inline) so a pre-existing
-- duplicate/blank value can't fail the whole migration silently
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'products_sku_key') then
    alter table products add constraint products_sku_key unique (sku);
  end if;
exception when others then
  raise notice 'Skipping products_sku_key unique constraint — duplicate/conflicting values exist. Review manually.';
end $$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'products_barcode_key') then
    alter table products add constraint products_barcode_key unique (barcode);
  end if;
exception when others then
  raise notice 'Skipping products_barcode_key unique constraint — duplicate/conflicting values exist. Review manually.';
end $$;

create index if not exists idx_products_stock_qty on products (stock_qty);

-- ----------------------------------------------------------------------------
-- customers: admin/ERP fields, additive only
-- ----------------------------------------------------------------------------
alter table customers
  add column if not exists birthday date,
  add column if not exists gst_number text,
  add column if not exists notes text,
  add column if not exists created_by uuid references auth.users (id);

-- ----------------------------------------------------------------------------
-- enquiries: link to customers, additive only
-- ----------------------------------------------------------------------------
alter table enquiries
  add column if not exists customer_id uuid references customers (id);

-- ----------------------------------------------------------------------------
-- RLS: extend existing tables with admin/staff access WITHOUT removing the
-- current public policies (public insert on enquiries/customers stays as-is
-- for the website; this only adds admin/staff read+write on top).
-- ----------------------------------------------------------------------------
drop policy if exists "admin_all_customers" on customers;
create policy "admin_all_customers" on customers for all
  using (is_admin()) with check (is_admin());

drop policy if exists "staff_read_customers" on customers;
create policy "staff_read_customers" on customers for select
  using (is_staff());

drop policy if exists "staff_insert_customers" on customers;
create policy "staff_insert_customers" on customers for insert
  with check (is_staff());

drop policy if exists "admin_all_enquiries" on enquiries;
create policy "admin_all_enquiries" on enquiries for all
  using (is_admin()) with check (is_admin());

drop policy if exists "staff_read_enquiries" on enquiries;
create policy "staff_read_enquiries" on enquiries for select
  using (is_staff());

drop policy if exists "admin_write_products" on products;
create policy "admin_write_products" on products for all
  using (is_admin()) with check (is_admin());

drop policy if exists "staff_update_products_stock" on products;
create policy "staff_update_products_stock" on products for update
  using (is_staff()) with check (is_staff());

-- ----------------------------------------------------------------------------
-- Website enquiry -> customers auto-link (mirrors live column names, not the
-- original monorepo's `name`/`product_interest` column names)
-- ----------------------------------------------------------------------------
create or replace function link_enquiry_to_customer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_id uuid;
begin
  select id into v_customer_id from customers where phone = new.phone limit 1;

  if v_customer_id is null then
    insert into customers (name, phone, email, notes)
    values (new.customer_name, new.phone, new.email, 'Created from website enquiry')
    returning id into v_customer_id;
  end if;

  new.customer_id := v_customer_id;
  return new;
end;
$$;

drop trigger if exists trg_link_enquiry_to_customer on enquiries;
create trigger trg_link_enquiry_to_customer
  before insert on enquiries
  for each row execute function link_enquiry_to_customer();
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
-- ============================================================================
-- 0004_sales_billing_stock_movements.sql  (DRAFT — for review, NOT applied)
-- REWRITTEN: sale_items and stock_movements now generalized across all
-- three sellable-item types (product / refurbished / hamper_product),
-- matching order_items' existing item_type + three-FK pattern.
--
-- Per confirmed business rule: gift hampers are assembled to order, not
-- kept as pre-assembled physical stock. gift_hamper_products.is_available
-- stays a plain admin-controlled boolean (no stock_qty added to it), and a
-- hamper SALE does NOT flip is_available — there is no real scarcity to
-- reflect, and doing so would incorrectly show a still-makeable hamper as
-- "out of stock." Hamper sales are still logged to stock_movements for
-- reporting, they just don't mutate gift_hamper_products at all.
--
-- New tables only: sales, sale_items, stock_movements. Reuses existing live
-- `finance_partners`, `refurbished_products`, `gift_hamper_products` as-is.
-- This migration wires stock deduction for IN-STORE sales only.
-- See 0006 (separate) for the website's `orders`/`order_items`.
-- Depends on: 0001, 0002 (products.purchase_price column).
-- ============================================================================

create table if not exists sales (
  id uuid primary key default gen_random_uuid(),
  invoice_number text not null unique,
  customer_id uuid references customers (id),
  staff_id uuid references staff (id),
  sale_type text not null check (sale_type in ('online', 'offline')),
  total_amount numeric(12, 2) not null default 0,
  purchase_total numeric(12, 2) not null default 0,
  gst_applicable boolean not null default false,
  gst_number text,
  finance_partner_id uuid references finance_partners (id),
  emi_months integer,
  emi_amount numeric(12, 2),
  payment_method text check (payment_method in ('cash', 'card', 'upi', 'bank_transfer', 'other')),
  discount_total numeric(12, 2) not null default 0,
  taxable_value numeric(12, 2) not null default 0,
  cgst_total numeric(12, 2) not null default 0,
  sgst_total numeric(12, 2) not null default 0,
  igst_total numeric(12, 2) not null default 0,
  staff_notes text,
  notes text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create index if not exists idx_sales_created_at on sales (created_at desc);
create index if not exists idx_sales_staff on sales (staff_id);
create index if not exists idx_sales_customer on sales (customer_id);

-- ----------------------------------------------------------------------------
-- sale_items: generalized to match order_items' item_type + three-FK
-- pattern, so in-store billing can sell products, refurbished units, or
-- made-to-order hampers with the same identification scheme the website
-- already uses.
-- ----------------------------------------------------------------------------
create table if not exists sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references sales (id) on delete cascade,
  item_type text not null default 'product' check (item_type in ('product', 'refurbished', 'hamper_product')),
  product_id uuid references products (id),
  refurbished_product_id uuid references refurbished_products (id),
  gift_hamper_product_id uuid references gift_hamper_products (id),
  qty integer not null default 1,
  unit_price numeric(12, 2) not null default 0,
  purchase_price numeric(12, 2) not null default 0,
  discount numeric(12, 2) not null default 0,
  gst_rate numeric(5, 2) not null default 0,
  hsn_sac text,
  cgst numeric(12, 2) not null default 0,
  sgst numeric(12, 2) not null default 0,
  igst numeric(12, 2) not null default 0,
  constraint sale_items_one_item_ref check (
    (item_type = 'product' and product_id is not null and refurbished_product_id is null and gift_hamper_product_id is null)
    or (item_type = 'refurbished' and refurbished_product_id is not null and product_id is null and gift_hamper_product_id is null)
    or (item_type = 'hamper_product' and gift_hamper_product_id is not null and product_id is null and refurbished_product_id is null)
  )
);

create index if not exists idx_sale_items_sale on sale_items (sale_id);
create index if not exists idx_sale_items_product on sale_items (product_id);
create index if not exists idx_sale_items_refurbished on sale_items (refurbished_product_id);
create index if not exists idx_sale_items_hamper on sale_items (gift_hamper_product_id);

-- ----------------------------------------------------------------------------
-- stock_movements: generalized the same way. product_id is now nullable
-- (exactly one of the three FKs is set, matching sale_items/order_items).
-- ----------------------------------------------------------------------------
create table if not exists stock_movements (
  id uuid primary key default gen_random_uuid(),
  item_type text not null default 'product' check (item_type in ('product', 'refurbished', 'hamper_product')),
  product_id uuid references products (id) on delete cascade,
  refurbished_product_id uuid references refurbished_products (id) on delete cascade,
  gift_hamper_product_id uuid references gift_hamper_products (id) on delete cascade,
  change_qty integer not null,
  resulting_qty integer, -- meaningful for item_type='product' only; null for boolean/made-to-order types
  movement_type text not null check (
    movement_type in ('purchase', 'sale', 'sale_return', 'adjustment', 'initial', 'web_order', 'web_order_cancel')
  ),
  reference_table text,
  reference_id uuid,
  note text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  constraint stock_movements_one_item_ref check (
    (item_type = 'product' and product_id is not null and refurbished_product_id is null and gift_hamper_product_id is null)
    or (item_type = 'refurbished' and refurbished_product_id is not null and product_id is null and gift_hamper_product_id is null)
    or (item_type = 'hamper_product' and gift_hamper_product_id is not null and product_id is null and refurbished_product_id is null)
  )
);

create index if not exists idx_stock_movements_product on stock_movements (product_id, created_at desc);
create index if not exists idx_stock_movements_refurbished on stock_movements (refurbished_product_id, created_at desc);
create index if not exists idx_stock_movements_hamper on stock_movements (gift_hamper_product_id, created_at desc);

-- ----------------------------------------------------------------------------
-- Stock triggers for IN-STORE sales only (sale_items). Branches per
-- item_type:
--   'product'     -> decrement/restore products.stock_qty (real quantity)
--   'refurbished' -> flip refurbished_products.is_available (real scarcity,
--                    boolean — each row is one unique physical unit)
--   'hamper_product' -> NO mutation to gift_hamper_products at all (made to
--                    order, no scarcity) — logged to stock_movements only,
--                    for reporting/audit purposes.
-- ----------------------------------------------------------------------------
create or replace function decrement_stock_on_sale()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_qty integer;
begin
  if new.item_type = 'product' and new.product_id is not null then
    update products
    set stock_qty = greatest(stock_qty - new.qty, 0)
    where id = new.product_id
    returning stock_qty into v_new_qty;

    insert into stock_movements (item_type, product_id, change_qty, resulting_qty, movement_type, reference_table, reference_id)
    values ('product', new.product_id, -new.qty, v_new_qty, 'sale', 'sale_items', new.id);

  elsif new.item_type = 'refurbished' and new.refurbished_product_id is not null then
    update refurbished_products
    set is_available = false
    where id = new.refurbished_product_id;

    insert into stock_movements (item_type, refurbished_product_id, change_qty, resulting_qty, movement_type, reference_table, reference_id, note)
    values ('refurbished', new.refurbished_product_id, -1, null, 'sale', 'sale_items', new.id, 'Marked unavailable — unique unit sold');

  elsif new.item_type = 'hamper_product' and new.gift_hamper_product_id is not null then
    -- Made-to-order: no availability change, audit-only log.
    insert into stock_movements (item_type, gift_hamper_product_id, change_qty, resulting_qty, movement_type, reference_table, reference_id, note)
    values ('hamper_product', new.gift_hamper_product_id, -new.qty, null, 'sale', 'sale_items', new.id, 'Made-to-order hamper — no inventory impact');
  end if;

  return new;
end;
$$;

drop trigger if exists trg_decrement_stock_on_sale on sale_items;
create trigger trg_decrement_stock_on_sale
  after insert on sale_items
  for each row execute function decrement_stock_on_sale();

create or replace function restore_stock_on_sale_item_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_qty integer;
begin
  if old.item_type = 'product' and old.product_id is not null then
    update products
    set stock_qty = stock_qty + old.qty
    where id = old.product_id
    returning stock_qty into v_new_qty;

    insert into stock_movements (item_type, product_id, change_qty, resulting_qty, movement_type, reference_table, reference_id)
    values ('product', old.product_id, old.qty, v_new_qty, 'sale_return', 'sale_items', old.id);

  elsif old.item_type = 'refurbished' and old.refurbished_product_id is not null then
    update refurbished_products
    set is_available = true
    where id = old.refurbished_product_id;

    insert into stock_movements (item_type, refurbished_product_id, change_qty, resulting_qty, movement_type, reference_table, reference_id, note)
    values ('refurbished', old.refurbished_product_id, 1, null, 'sale_return', 'sale_items', old.id, 'Marked available again — sale reversed');

  elsif old.item_type = 'hamper_product' and old.gift_hamper_product_id is not null then
    insert into stock_movements (item_type, gift_hamper_product_id, change_qty, resulting_qty, movement_type, reference_table, reference_id, note)
    values ('hamper_product', old.gift_hamper_product_id, old.qty, null, 'sale_return', 'sale_items', old.id, 'Made-to-order hamper sale reversed — no inventory impact');
  end if;

  return old;
end;
$$;

drop trigger if exists trg_restore_stock_on_sale_item_delete on sale_items;
create trigger trg_restore_stock_on_sale_item_delete
  after delete on sale_items
  for each row execute function restore_stock_on_sale_item_delete();

-- ----------------------------------------------------------------------------
-- Manual stock adjustment RPC (admin-only) — products only (the only type
-- with a real quantity to adjust manually).
-- ----------------------------------------------------------------------------
create or replace function adjust_stock_manual(p_product_id uuid, p_change_qty integer, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_qty integer;
begin
  if not is_admin() then
    raise exception 'Only admin can make manual stock adjustments';
  end if;

  update products
  set stock_qty = greatest(stock_qty + p_change_qty, 0)
  where id = p_product_id
  returning stock_qty into v_new_qty;

  insert into stock_movements (item_type, product_id, change_qty, resulting_qty, movement_type, note, created_by)
  values ('product', p_product_id, p_change_qty, v_new_qty, 'adjustment', p_note, auth.uid());
end;
$$;

-- ----------------------------------------------------------------------------
-- Manual refurbished-unit availability toggle RPC (admin-only) — for
-- corrections (e.g. relisting a unit that was mistakenly marked sold).
-- ----------------------------------------------------------------------------
create or replace function adjust_refurbished_availability(p_id uuid, p_is_available boolean, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'Only admin can adjust refurbished unit availability';
  end if;

  update refurbished_products set is_available = p_is_available where id = p_id;

  insert into stock_movements (item_type, refurbished_product_id, change_qty, resulting_qty, movement_type, note, created_by)
  values ('refurbished', p_id, case when p_is_available then 1 else -1 end, null, 'adjustment', p_note, auth.uid());
end;
$$;

-- ----------------------------------------------------------------------------
-- RLS: no public exposure for sales/sale_items/stock_movements
-- ----------------------------------------------------------------------------
alter table sales enable row level security;
alter table sale_items enable row level security;
alter table stock_movements enable row level security;

drop policy if exists "admin_all_sales" on sales;
create policy "admin_all_sales" on sales for all
  using (is_admin()) with check (is_admin());

drop policy if exists "staff_manage_own_sales" on sales;
create policy "staff_manage_own_sales" on sales for all
  using (is_staff() and staff_id = current_staff_id())
  with check (is_staff() and staff_id = current_staff_id());

drop policy if exists "admin_all_sale_items" on sale_items;
create policy "admin_all_sale_items" on sale_items for all
  using (is_admin()) with check (is_admin());

drop policy if exists "staff_manage_own_sale_items" on sale_items;
create policy "staff_manage_own_sale_items" on sale_items for all
  using (
    is_staff() and exists (
      select 1 from sales s where s.id = sale_items.sale_id and s.staff_id = current_staff_id()
    )
  )
  with check (
    is_staff() and exists (
      select 1 from sales s where s.id = sale_items.sale_id and s.staff_id = current_staff_id()
    )
  );

drop policy if exists "admin_all_stock_movements" on stock_movements;
create policy "admin_all_stock_movements" on stock_movements for all
  using (is_admin()) with check (is_admin());

drop policy if exists "staff_read_stock_movements" on stock_movements;
create policy "staff_read_stock_movements" on stock_movements for select
  using (is_staff());

-- finance_partners: reuse existing live table, add admin/staff RLS only
drop policy if exists "admin_all_finance_partners" on finance_partners;
create policy "admin_all_finance_partners" on finance_partners for all
  using (is_admin()) with check (is_admin());

drop policy if exists "staff_read_finance_partners" on finance_partners;
create policy "staff_read_finance_partners" on finance_partners for select
  using (is_staff());
-- ============================================================================
-- 0005_repairs_reports_reviews_purchases.sql  (DRAFT — for review)
-- New: repairs (work-order tracking, linked to existing repair_enquiries),
-- client_reports, reviews, third_party_purchases, wholesaler_invoices,
-- invoice_items. Reuses existing live `suppliers` table as-is.
-- Depends on: 0001, 0002.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- repairs: admin/staff work-order tracking. Separate from the existing
-- `repair_enquiries` table (which stays exactly as the website uses it for
-- intake) — linked via repair_enquiry_id so the original customer message
-- is never duplicated or altered.
-- ----------------------------------------------------------------------------
create table if not exists repairs (
  id uuid primary key default gen_random_uuid(),
  repair_number text not null unique,
  repair_enquiry_id uuid references repair_enquiries (id) on delete set null,
  customer_id uuid references customers (id),
  assigned_staff uuid references staff (id),
  device_name text not null,
  issue_description text,
  estimated_cost numeric(12, 2),
  final_cost numeric(12, 2),
  status text not null default 'received' check (
    status in ('received', 'in_progress', 'waiting_parts', 'ready', 'collected')
  ),
  received_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_repairs_status on repairs (status);

alter table repairs enable row level security;

drop policy if exists "admin_all_repairs" on repairs;
create policy "admin_all_repairs" on repairs for all
  using (is_admin()) with check (is_admin());

drop policy if exists "staff_manage_assigned_repairs" on repairs;
create policy "staff_manage_assigned_repairs" on repairs for all
  using (is_staff() and assigned_staff = current_staff_id())
  with check (is_staff() and assigned_staff = current_staff_id());

-- repair_enquiries: reuse existing live table as-is; add admin/staff read
-- access only (public insert policy from the website is untouched)
drop policy if exists "admin_all_repair_enquiries" on repair_enquiries;
create policy "admin_all_repair_enquiries" on repair_enquiries for all
  using (is_admin()) with check (is_admin());

drop policy if exists "staff_read_repair_enquiries" on repair_enquiries;
create policy "staff_read_repair_enquiries" on repair_enquiries for select
  using (is_staff());

-- ----------------------------------------------------------------------------
-- client_reports
-- ----------------------------------------------------------------------------
create table if not exists client_reports (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers (id) on delete cascade,
  staff_id uuid not null references staff (id),
  title text not null,
  notes text,
  file_url text, -- Supabase Storage path, bucket 'client-reports' (create manually)
  created_at timestamptz not null default now()
);

create index if not exists idx_client_reports_customer on client_reports (customer_id, created_at desc);

alter table client_reports enable row level security;

drop policy if exists "admin_all_client_reports" on client_reports;
create policy "admin_all_client_reports" on client_reports for all
  using (is_admin()) with check (is_admin());

drop policy if exists "staff_insert_client_reports" on client_reports;
create policy "staff_insert_client_reports" on client_reports for insert
  with check (is_staff() and staff_id = current_staff_id());

drop policy if exists "staff_read_own_client_reports" on client_reports;
create policy "staff_read_own_client_reports" on client_reports for select
  using (is_staff() and staff_id = current_staff_id());

-- ----------------------------------------------------------------------------
-- reviews: public-submitted, admin-moderated. No existing equivalent live.
-- ----------------------------------------------------------------------------
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

drop policy if exists "public_insert_reviews" on reviews;
create policy "public_insert_reviews" on reviews for insert
  to anon with check (true);

drop policy if exists "public_read_approved_reviews" on reviews;
create policy "public_read_approved_reviews" on reviews for select
  to anon using (status = 'approved');

drop policy if exists "admin_all_reviews" on reviews;
create policy "admin_all_reviews" on reviews for all
  using (is_admin()) with check (is_admin());

-- ----------------------------------------------------------------------------
-- third_party_purchases: deliberately a NEW/different table from the
-- existing live `third_party_sources` (which is a website sourcing-
-- attribution table, not vendor purchase bookkeeping) — no reuse, no clash.
-- ----------------------------------------------------------------------------
create table if not exists third_party_purchases (
  id uuid primary key default gen_random_uuid(),
  vendor_name text not null,
  item_description text,
  amount numeric(12, 2) not null default 0,
  category text,
  date date not null default current_date,
  notes text,
  created_by uuid references auth.users (id)
);

alter table third_party_purchases enable row level security;

drop policy if exists "admin_all_third_party_purchases" on third_party_purchases;
create policy "admin_all_third_party_purchases" on third_party_purchases for all
  using (is_admin()) with check (is_admin());

-- ----------------------------------------------------------------------------
-- wholesaler_invoices + invoice_items. Reuses existing live `suppliers`
-- table as-is via supplier_id.
-- ----------------------------------------------------------------------------
create table if not exists wholesaler_invoices (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid references suppliers (id),
  supplier_name text not null,
  invoice_number text,
  invoice_date date,
  total_amount numeric(12, 2),
  file_url text, -- Supabase Storage path, bucket 'wholesaler-invoices' (create manually)
  processed boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references wholesaler_invoices (id) on delete cascade,
  product_id uuid references products (id),
  product_name text not null,
  qty integer not null default 0,
  unit_cost numeric(12, 2) not null default 0
);

create index if not exists idx_invoice_items_invoice on invoice_items (invoice_id);

alter table wholesaler_invoices enable row level security;
alter table invoice_items enable row level security;

drop policy if exists "admin_all_wholesaler_invoices" on wholesaler_invoices;
create policy "admin_all_wholesaler_invoices" on wholesaler_invoices for all
  using (is_admin()) with check (is_admin());

drop policy if exists "admin_all_invoice_items" on invoice_items;
create policy "admin_all_invoice_items" on invoice_items for all
  using (is_admin()) with check (is_admin());

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

  update wholesaler_invoices set processed = true where id = p_invoice_id;
end;
$$;

-- suppliers: reuse existing live table as-is, add admin/staff RLS only
drop policy if exists "admin_all_suppliers" on suppliers;
create policy "admin_all_suppliers" on suppliers for all
  using (is_admin()) with check (is_admin());

drop policy if exists "staff_read_suppliers" on suppliers;
create policy "staff_read_suppliers" on suppliers for select
  using (is_staff());
-- ============================================================================
-- 0006_web_order_stock_sync.sql  (DRAFT — for review, NOT applied)
--
-- Order-status-driven stock sync for the website's `orders`/`order_items`.
-- Generalized to match order_items' existing item_type
-- ('product' | 'refurbished' | 'accessory' | 'hamper_product') and the same
-- per-type rules as 0004's in-store sale_items:
--   'product'        -> products.stock_qty decrement/restore, clamped at 0
--   'refurbished'     -> refurbished_products.is_available flip (unique unit)
--   'hamper_product'  -> made-to-order, NO mutation — audit log only
--   'accessory'       -> no backing table exists in the live schema at all;
--                        skipped with a note, not an error (see explanation)
--
-- Depends on: 0004 (generalized stock_movements table).
-- Does NOT touch order_items. Does NOT add a CHECK constraint on
-- orders.order_status (per prior confirmation the admin UI's status list
-- may not be exhaustive/future-proof).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Idempotency/guard column on the existing `orders` table. Nullable,
--    defaulted to NULL — no existing row's meaning changes.
-- ----------------------------------------------------------------------------
alter table orders
  add column if not exists stock_deducted_at timestamptz;

-- ----------------------------------------------------------------------------
-- 2. Trigger function: fires on every `orders` UPDATE, decides what to do
--    based on the order_status transition, then loops that order's
--    order_items and branches per item_type.
--
--    Concurrency/negative-stock safety: each `products` row touched is
--    locked by its `UPDATE ... RETURNING` for the duration of this
--    trigger's transaction, and stock_qty is clamped with GREATEST(...,0).
--    refurbished_products' boolean flip is a plain UPDATE, inherently
--    idempotent-safe per row (setting false to an already-false row is a
--    no-op in effect). hamper_product items never mutate any row.
-- ----------------------------------------------------------------------------
create or replace function sync_stock_on_order_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  item record;
  v_new_qty integer;
begin
  -- === DEDUCT: pending/other -> confirmed, not yet deducted ===============
  if new.order_status = 'confirmed'
     and old.order_status is distinct from 'confirmed'
     and new.stock_deducted_at is null
  then
    for item in
      select item_type, product_id, refurbished_product_id, gift_hamper_product_id, quantity
      from order_items
      where order_id = new.id
    loop
      if item.item_type = 'product' and item.product_id is not null then
        update products
        set stock_qty = greatest(stock_qty - item.quantity, 0)
        where id = item.product_id
        returning stock_qty into v_new_qty;

        insert into stock_movements
          (item_type, product_id, change_qty, resulting_qty, movement_type, reference_table, reference_id, note)
        values
          ('product', item.product_id, -item.quantity, v_new_qty, 'web_order', 'orders', new.id,
           'Order ' || coalesce(new.order_number, new.id::text) || ' confirmed');

      elsif item.item_type = 'refurbished' and item.refurbished_product_id is not null then
        update refurbished_products
        set is_available = false
        where id = item.refurbished_product_id;

        insert into stock_movements
          (item_type, refurbished_product_id, change_qty, resulting_qty, movement_type, reference_table, reference_id, note)
        values
          ('refurbished', item.refurbished_product_id, -1, null, 'web_order', 'orders', new.id,
           'Order ' || coalesce(new.order_number, new.id::text) || ' confirmed — unit marked unavailable');

      elsif item.item_type = 'hamper_product' and item.gift_hamper_product_id is not null then
        -- Made-to-order: no availability change, audit-only log.
        insert into stock_movements
          (item_type, gift_hamper_product_id, change_qty, resulting_qty, movement_type, reference_table, reference_id, note)
        values
          ('hamper_product', item.gift_hamper_product_id, -item.quantity, null, 'web_order', 'orders', new.id,
           'Order ' || coalesce(new.order_number, new.id::text) || ' confirmed — made-to-order, no inventory impact');

      -- else: item_type = 'accessory' (or anything else unrecognized) — no
      -- backing table exists for accessories in the live schema, so there
      -- is nothing to deduct or log against. Intentionally skipped, not an
      -- error, so a mixed-cart order (e.g. product + accessory) still
      -- confirms cleanly.
      end if;
    end loop;

    new.stock_deducted_at := now();

  -- === RESTORE: confirmed/anything -> cancelled/refunded, only if we
  --     actually deducted for this order earlier ===========================
  elsif new.order_status in ('cancelled', 'refunded')
        and old.order_status is distinct from new.order_status
        and new.stock_deducted_at is not null
  then
    for item in
      select item_type, product_id, refurbished_product_id, gift_hamper_product_id, quantity
      from order_items
      where order_id = new.id
    loop
      if item.item_type = 'product' and item.product_id is not null then
        update products
        set stock_qty = stock_qty + item.quantity
        where id = item.product_id
        returning stock_qty into v_new_qty;

        insert into stock_movements
          (item_type, product_id, change_qty, resulting_qty, movement_type, reference_table, reference_id, note)
        values
          ('product', item.product_id, item.quantity, v_new_qty, 'web_order_cancel', 'orders', new.id,
           'Order ' || coalesce(new.order_number, new.id::text) || ' ' || new.order_status);

      elsif item.item_type = 'refurbished' and item.refurbished_product_id is not null then
        update refurbished_products
        set is_available = true
        where id = item.refurbished_product_id;

        insert into stock_movements
          (item_type, refurbished_product_id, change_qty, resulting_qty, movement_type, reference_table, reference_id, note)
        values
          ('refurbished', item.refurbished_product_id, 1, null, 'web_order_cancel', 'orders', new.id,
           'Order ' || coalesce(new.order_number, new.id::text) || ' ' || new.order_status || ' — unit marked available again');

      elsif item.item_type = 'hamper_product' and item.gift_hamper_product_id is not null then
        insert into stock_movements
          (item_type, gift_hamper_product_id, change_qty, resulting_qty, movement_type, reference_table, reference_id, note)
        values
          ('hamper_product', item.gift_hamper_product_id, item.quantity, null, 'web_order_cancel', 'orders', new.id,
           'Order ' || coalesce(new.order_number, new.id::text) || ' ' || new.order_status || ' — made-to-order, no inventory impact');
      end if;
    end loop;

    -- Clear the guard so a later re-confirmation (e.g. cancelled -> confirmed
    -- after a dispute is resolved) can deduct again cleanly.
    new.stock_deducted_at := null;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sync_stock_on_order_status_change on orders;
create trigger trg_sync_stock_on_order_status_change
  before update on orders
  for each row
  execute function sync_stock_on_order_status_change();

-- ----------------------------------------------------------------------------
-- Notes:
-- - BEFORE UPDATE (not AFTER) so `new.stock_deducted_at := ...` inside the
--   function is what actually gets written to the row, in the same
--   statement/lock — no separate follow-up UPDATE needed.
-- - order_items is never written to or triggered from — only read.
-- - No existing table, column, policy, or row is dropped, renamed, or
--   altered destructively. `orders` gains exactly one nullable column.
-- - 'accessory' order items remain untracked by any stock system, exactly
--   as they are today (no regression) — flagged in 0004/prior review, not
--   addressed here since it's a pre-existing gap, not something this
--   migration introduces.
-- ============================================================================
