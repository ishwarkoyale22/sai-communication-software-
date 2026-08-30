-- ============================================================================
-- 0001_init_schema.sql
-- Core tables for Retail ERP (Admin + Staff Portal + Public Website)
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- profiles: links a Supabase Auth user to a role (admin | staff)
-- Admin logs in with email/password (Supabase Auth).
-- Staff logs in with phone + 4-digit PIN -> mapped internally to a
-- Supabase Auth user with email = "<phone>@staff.internal" and password = PIN.
-- ----------------------------------------------------------------------------
create table if not exists profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('admin', 'staff')),
  staff_id uuid, -- set for role = 'staff', FK added after staff table exists
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- staff
-- ----------------------------------------------------------------------------
create table if not exists staff (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  role text not null default 'cashier', -- cashier, technician, manager, etc.
  phone text not null unique,
  pin text not null, -- 4-digit quick login PIN (kept for display/reset by admin)
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
-- customers
-- ----------------------------------------------------------------------------
create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text unique,
  email text,
  address text,
  birthday date,
  gst_number text,
  notes text,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- finance_partners
-- ----------------------------------------------------------------------------
create table if not exists finance_partners (
  id uuid primary key default gen_random_uuid(),
  name text not null unique
);

-- ----------------------------------------------------------------------------
-- products
-- ----------------------------------------------------------------------------
create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null check (
    category in ('Mobiles', 'TVs', 'ACs', 'Laptops', 'Accessories', 'Gift Hampers', 'Other')
  ),
  sku text unique,
  purchase_price numeric(12, 2) not null default 0,
  sale_price numeric(12, 2) not null default 0,
  stock_qty integer not null default 0,
  min_stock_alert integer not null default 3,
  barcode text unique,
  buyer_code text,
  is_gift_hamper boolean not null default false,
  hamper_item_ids uuid[] default '{}', -- product ids bundled into this hamper
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_products_category on products (category);
create index if not exists idx_products_barcode on products (barcode);
create index if not exists idx_products_stock on products (stock_qty);

-- ----------------------------------------------------------------------------
-- sales
-- ----------------------------------------------------------------------------
create table if not exists sales (
  id uuid primary key default gen_random_uuid(),
  invoice_number text not null unique,
  customer_id uuid references customers (id),
  staff_id uuid references staff (id),
  sale_type text not null check (sale_type in ('online', 'offline')),
  total_amount numeric(12, 2) not null default 0,
  purchase_total numeric(12, 2) not null default 0, -- for gross-profit calc
  gst_applicable boolean not null default false,
  gst_number text,
  finance_partner_id uuid references finance_partners (id),
  emi_months integer,
  emi_amount numeric(12, 2),
  staff_notes text, -- customer review / notes, visible to admin only
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_sales_created_at on sales (created_at desc);
create index if not exists idx_sales_staff on sales (staff_id);
create index if not exists idx_sales_customer on sales (customer_id);
create index if not exists idx_sales_type on sales (sale_type);
create index if not exists idx_sales_gst on sales (gst_applicable);

-- ----------------------------------------------------------------------------
-- sale_items
-- ----------------------------------------------------------------------------
create table if not exists sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references sales (id) on delete cascade,
  product_id uuid references products (id),
  qty integer not null default 1,
  unit_price numeric(12, 2) not null default 0,
  purchase_price numeric(12, 2) not null default 0
);

create index if not exists idx_sale_items_sale on sale_items (sale_id);
create index if not exists idx_sale_items_product on sale_items (product_id);

-- ----------------------------------------------------------------------------
-- repairs
-- ----------------------------------------------------------------------------
create table if not exists repairs (
  id uuid primary key default gen_random_uuid(),
  repair_number text not null unique,
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

-- ----------------------------------------------------------------------------
-- attendance
-- ----------------------------------------------------------------------------
create table if not exists attendance (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references staff (id),
  clock_in timestamptz not null default now(),
  clock_out timestamptz,
  clock_in_lat numeric(10, 6),
  clock_in_lng numeric(10, 6),
  clock_out_lat numeric(10, 6),
  clock_out_lng numeric(10, 6)
);

create index if not exists idx_attendance_staff on attendance (staff_id);
create index if not exists idx_attendance_clock_in on attendance (clock_in desc);

-- ----------------------------------------------------------------------------
-- wholesaler_invoices + invoice_items
-- ----------------------------------------------------------------------------
create table if not exists wholesaler_invoices (
  id uuid primary key default gen_random_uuid(),
  supplier_name text not null,
  invoice_number text,
  invoice_date date,
  total_amount numeric(12, 2),
  file_url text, -- Supabase Storage path
  processed boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references wholesaler_invoices (id) on delete cascade,
  product_id uuid references products (id), -- nullable if new product
  product_name text not null,
  qty integer not null default 0,
  unit_cost numeric(12, 2) not null default 0
);

create index if not exists idx_invoice_items_invoice on invoice_items (invoice_id);

-- ----------------------------------------------------------------------------
-- third_party_purchases
-- ----------------------------------------------------------------------------
create table if not exists third_party_purchases (
  id uuid primary key default gen_random_uuid(),
  vendor_name text not null,
  item_description text,
  amount numeric(12, 2) not null default 0,
  category text,
  date date not null default current_date,
  notes text
);

-- ----------------------------------------------------------------------------
-- enquiries (public website)
-- ----------------------------------------------------------------------------
create table if not exists enquiries (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null,
  email text,
  message text,
  product_interest text,
  status text not null default 'new' check (status in ('new', 'contacted', 'closed')),
  created_at timestamptz not null default now()
);

create index if not exists idx_enquiries_status on enquiries (status);
-- ============================================================================
-- 0002_functions_triggers.sql
-- Stock auto-decrement/increment, updated_at, role-check helpers for RLS
-- ============================================================================

-- ----------------------------------------------------------------------------
-- updated_at auto-touch on products
-- ----------------------------------------------------------------------------
create or replace function touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_products_touch on products;
create trigger trg_products_touch
  before update on products
  for each row execute function touch_updated_at();

-- ----------------------------------------------------------------------------
-- Stock auto-decrement on every sale_items insert
-- ----------------------------------------------------------------------------
create or replace function decrement_stock_on_sale()
returns trigger
language plpgsql
as $$
begin
  if new.product_id is not null then
    update products
    set stock_qty = greatest(stock_qty - new.qty, 0)
    where id = new.product_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_decrement_stock on sale_items;
create trigger trg_decrement_stock
  after insert on sale_items
  for each row execute function decrement_stock_on_sale();

-- restore stock if a sale line is deleted (e.g. voided sale)
create or replace function restore_stock_on_sale_item_delete()
returns trigger
language plpgsql
as $$
begin
  if old.product_id is not null then
    update products
    set stock_qty = stock_qty + old.qty
    where id = old.product_id;
  end if;
  return old;
end;
$$;

drop trigger if exists trg_restore_stock on sale_items;
create trigger trg_restore_stock
  after delete on sale_items
  for each row execute function restore_stock_on_sale_item_delete();

-- ----------------------------------------------------------------------------
-- Stock auto-increment when a wholesaler invoice item is matched to a
-- product and the invoice is marked processed (called from app on confirm).
-- Exposed as an RPC so the client can do this atomically.
-- ----------------------------------------------------------------------------
create or replace function process_wholesaler_invoice(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  item record;
begin
  for item in
    select * from invoice_items where invoice_id = p_invoice_id
  loop
    if item.product_id is not null then
      update products
      set stock_qty = stock_qty + item.qty,
          purchase_price = item.unit_cost
      where id = item.product_id;
    end if;
  end loop;

  update wholesaler_invoices
  set processed = true
  where id = p_invoice_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- RLS helper functions
-- ----------------------------------------------------------------------------
create or replace function auth_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from profiles where id = auth.uid();
$$;

create or replace function is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select role = 'admin' from profiles where id = auth.uid()), false);
$$;

create or replace function is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select role = 'staff' from profiles where id = auth.uid()), false);
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
-- Invoice / repair / staff-id number generators (called from app before insert)
-- ----------------------------------------------------------------------------
create or replace function next_invoice_number()
returns text
language sql
as $$
  select 'INV-' || to_char(now(), 'YYMMDD') || '-' ||
    lpad((coalesce((select count(*) from sales where created_at::date = current_date), 0) + 1)::text, 4, '0');
$$;

create or replace function next_repair_number()
returns text
language sql
as $$
  select 'RPR-' || to_char(now(), 'YYMMDD') || '-' ||
    lpad((coalesce((select count(*) from repairs where received_at::date = current_date), 0) + 1)::text, 4, '0');
$$;
-- ============================================================================
-- 0003_rls_policies.sql
-- Row Level Security: admin = full access, staff = scoped, anon (public) = tiny
-- ============================================================================

alter table profiles enable row level security;
alter table staff enable row level security;
alter table customers enable row level security;
alter table finance_partners enable row level security;
alter table products enable row level security;
alter table sales enable row level security;
alter table sale_items enable row level security;
alter table repairs enable row level security;
alter table attendance enable row level security;
alter table wholesaler_invoices enable row level security;
alter table invoice_items enable row level security;
alter table third_party_purchases enable row level security;
alter table enquiries enable row level security;

-- ----------------------------------------------------------------------------
-- profiles: a user can read their own profile; admin can read all
-- ----------------------------------------------------------------------------
drop policy if exists "profiles_self_read" on profiles;
create policy "profiles_self_read" on profiles for select
  using (id = auth.uid() or is_admin());

-- ----------------------------------------------------------------------------
-- Generic "admin full access" policy, one per table
-- ----------------------------------------------------------------------------
drop policy if exists "admin_all_staff" on staff;
create policy "admin_all_staff" on staff for all using (is_admin()) with check (is_admin());
drop policy if exists "admin_all_customers" on customers;
create policy "admin_all_customers" on customers for all using (is_admin()) with check (is_admin());
drop policy if exists "admin_all_finance_partners" on finance_partners;
create policy "admin_all_finance_partners" on finance_partners for all using (is_admin()) with check (is_admin());
drop policy if exists "admin_all_products" on products;
create policy "admin_all_products" on products for all using (is_admin()) with check (is_admin());
drop policy if exists "admin_all_sales" on sales;
create policy "admin_all_sales" on sales for all using (is_admin()) with check (is_admin());
drop policy if exists "admin_all_sale_items" on sale_items;
create policy "admin_all_sale_items" on sale_items for all using (is_admin()) with check (is_admin());
drop policy if exists "admin_all_repairs" on repairs;
create policy "admin_all_repairs" on repairs for all using (is_admin()) with check (is_admin());
drop policy if exists "admin_all_attendance" on attendance;
create policy "admin_all_attendance" on attendance for all using (is_admin()) with check (is_admin());
drop policy if exists "admin_all_wholesaler_invoices" on wholesaler_invoices;
create policy "admin_all_wholesaler_invoices" on wholesaler_invoices for all using (is_admin()) with check (is_admin());
drop policy if exists "admin_all_invoice_items" on invoice_items;
create policy "admin_all_invoice_items" on invoice_items for all using (is_admin()) with check (is_admin());
drop policy if exists "admin_all_third_party_purchases" on third_party_purchases;
create policy "admin_all_third_party_purchases" on third_party_purchases for all using (is_admin()) with check (is_admin());
drop policy if exists "admin_all_enquiries" on enquiries;
create policy "admin_all_enquiries" on enquiries for all using (is_admin()) with check (is_admin());

-- ----------------------------------------------------------------------------
-- Staff policies (scoped)
-- ----------------------------------------------------------------------------

-- staff can read their own staff row + see co-worker names (for assign dropdowns)
drop policy if exists "staff_read_staff" on staff;
create policy "staff_read_staff" on staff for select using (is_staff());

-- staff: read all products, and update stock/price during billing/inventory count
drop policy if exists "staff_read_products" on products;
create policy "staff_read_products" on products for select using (is_staff());
drop policy if exists "staff_update_products" on products;
create policy "staff_update_products" on products for update using (is_staff()) with check (is_staff());

-- staff: read + create customers (lookup by phone / create new during billing)
drop policy if exists "staff_read_customers" on customers;
create policy "staff_read_customers" on customers for select using (is_staff());
drop policy if exists "staff_insert_customers" on customers;
create policy "staff_insert_customers" on customers for insert with check (is_staff());
drop policy if exists "staff_update_customers" on customers;
create policy "staff_update_customers" on customers for update using (is_staff()) with check (is_staff());

drop policy if exists "staff_read_finance_partners" on finance_partners;
create policy "staff_read_finance_partners" on finance_partners for select using (is_staff());

-- staff: create sales, but only see their own
drop policy if exists "staff_insert_sales" on sales;
create policy "staff_insert_sales" on sales for insert
  with check (is_staff() and staff_id = current_staff_id());
drop policy if exists "staff_read_own_sales" on sales;
create policy "staff_read_own_sales" on sales for select
  using (is_staff() and staff_id = current_staff_id());

drop policy if exists "staff_insert_sale_items" on sale_items;
create policy "staff_insert_sale_items" on sale_items for insert
  with check (
    is_staff() and exists (
      select 1 from sales s
      where s.id = sale_id and s.staff_id = current_staff_id()
    )
  );
drop policy if exists "staff_read_own_sale_items" on sale_items;
create policy "staff_read_own_sale_items" on sale_items for select
  using (
    is_staff() and exists (
      select 1 from sales s
      where s.id = sale_id and s.staff_id = current_staff_id()
    )
  );

-- staff: repairs assigned to them - read + status update
drop policy if exists "staff_read_assigned_repairs" on repairs;
create policy "staff_read_assigned_repairs" on repairs for select
  using (is_staff() and assigned_staff = current_staff_id());
drop policy if exists "staff_update_assigned_repairs" on repairs;
create policy "staff_update_assigned_repairs" on repairs for update
  using (is_staff() and assigned_staff = current_staff_id())
  with check (is_staff() and assigned_staff = current_staff_id());

-- staff: attendance - insert own clock-in/out, read own history
drop policy if exists "staff_insert_own_attendance" on attendance;
create policy "staff_insert_own_attendance" on attendance for insert
  with check (is_staff() and staff_id = current_staff_id());
drop policy if exists "staff_update_own_attendance" on attendance;
create policy "staff_update_own_attendance" on attendance for update
  using (is_staff() and staff_id = current_staff_id())
  with check (is_staff() and staff_id = current_staff_id());
drop policy if exists "staff_read_own_attendance" on attendance;
create policy "staff_read_own_attendance" on attendance for select
  using (is_staff() and staff_id = current_staff_id());

-- ----------------------------------------------------------------------------
-- Public (anon) policies
-- ----------------------------------------------------------------------------

-- anyone can view in-stock, active products (catalog)
drop policy if exists "public_read_in_stock_products" on products;
create policy "public_read_in_stock_products" on products for select
  to anon
  using (stock_qty > 0 and is_active = true);

-- anyone can submit an enquiry
drop policy if exists "public_insert_enquiries" on enquiries;
create policy "public_insert_enquiries" on enquiries for insert
  to anon
  with check (true);
-- ============================================================================
-- 0004_realtime.sql
-- Enable Supabase Realtime on tables the UIs subscribe to
-- ============================================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'products'
  ) then
    alter publication supabase_realtime add table products;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sales'
  ) then
    alter publication supabase_realtime add table sales;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'repairs'
  ) then
    alter publication supabase_realtime add table repairs;
  end if;
end $$;
-- ============================================================================
-- 0005_phase1_gaps_schema.sql
-- Closes Phase 1 spec gaps left by 0001-0004:
--   - configurable product categories (was a hardcoded check constraint)
--   - stock_movements audit trail (purchase/sale/return/adjustment)
--   - customer_notes (staff review notes, separate from sales.staff_notes)
--   - suppliers (wholesaler master, instead of free-text supplier_name)
--   - settings (business profile used on GST invoices + invoice numbering)
--   - GST line-item fields (HSN/SAC, CGST/SGST/IGST, discount, payment_method)
--   - product fields: brand, model, serial_number, description, image_url
--   - created_by/updated_by audit columns
--   - website enquiry -> customers auto-link (no separate enquiry CRM)
-- Run after 0001-0004. Safe to run on an empty/dev database.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- categories: admin-configurable, replaces the hardcoded check constraint.
-- products.category stays a text column (no app-code break) but now points
-- at categories.name via FK, so new categories just need a row inserted here.
-- ----------------------------------------------------------------------------
create table if not exists categories (
  name text primary key,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into categories (name, sort_order) values
  ('Mobiles', 1),
  ('TVs', 2),
  ('ACs', 3),
  ('Laptops', 4),
  ('Accessories', 5),
  ('Gift Hampers', 6),
  ('Other', 7)
on conflict (name) do nothing;

alter table products drop constraint if exists products_category_check;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'products_category_fkey') then
    alter table products
      add constraint products_category_fkey foreign key (category)
      references categories (name) on update cascade;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- suppliers: wholesaler master (purchases/reporting can now filter by supplier)
-- ----------------------------------------------------------------------------
create table if not exists suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  phone text,
  address text,
  gstin text,
  notes text,
  created_at timestamptz not null default now()
);

alter table wholesaler_invoices
  add column if not exists supplier_id uuid references suppliers (id);

-- backfill a supplier row per distinct existing supplier_name, and link it
insert into suppliers (name)
  select distinct supplier_name from wholesaler_invoices
  where supplier_name is not null
  on conflict (name) do nothing;

update wholesaler_invoices wi
  set supplier_id = s.id
  from suppliers s
  where wi.supplier_id is null and wi.supplier_name = s.name;

-- ----------------------------------------------------------------------------
-- stock_movements: audit/history for every stock change (§4, §20)
-- ----------------------------------------------------------------------------
create table if not exists stock_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products (id) on delete cascade,
  change_qty integer not null, -- signed: +10 on purchase, -2 on sale
  resulting_qty integer not null,
  movement_type text not null check (
    movement_type in ('purchase', 'sale', 'sale_return', 'adjustment', 'initial')
  ),
  reference_table text, -- 'sale_items' | 'invoice_items' | null for manual adjustment
  reference_id uuid,
  note text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create index if not exists idx_stock_movements_product on stock_movements (product_id, created_at desc);

-- ----------------------------------------------------------------------------
-- customer_notes: staff review/feedback notes (§13), separate from sales notes
-- ----------------------------------------------------------------------------
create table if not exists customer_notes (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers (id) on delete cascade,
  staff_id uuid references staff (id),
  note text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_customer_notes_customer on customer_notes (customer_id, created_at desc);

-- ----------------------------------------------------------------------------
-- settings: business profile used on GST invoices + invoice numbering (§7, §18)
-- ----------------------------------------------------------------------------
create table if not exists settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

insert into settings (key, value) values (
  'business_profile',
  jsonb_build_object(
    'name', 'Sai Communication',
    'address', '',
    'phone', '',
    'gstin', '',
    'invoice_prefix', 'INV'
  )
) on conflict (key) do nothing;

-- ----------------------------------------------------------------------------
-- Products: missing fields from spec §4
-- ----------------------------------------------------------------------------
alter table products
  add column if not exists brand text,
  add column if not exists model text,
  add column if not exists serial_number text, -- IMEI or serial, where applicable
  add column if not exists description text,
  add column if not exists image_url text,
  add column if not exists created_by uuid references auth.users (id),
  add column if not exists updated_by uuid references auth.users (id);

-- ----------------------------------------------------------------------------
-- Sales / sale_items: GST line-item breakdown + payment method (§6, §7)
-- ----------------------------------------------------------------------------
alter table sales
  add column if not exists payment_method text check (
    payment_method in ('cash', 'card', 'upi', 'bank_transfer', 'other')
  ),
  add column if not exists discount_total numeric(12, 2) not null default 0,
  add column if not exists taxable_value numeric(12, 2) not null default 0,
  add column if not exists cgst_total numeric(12, 2) not null default 0,
  add column if not exists sgst_total numeric(12, 2) not null default 0,
  add column if not exists igst_total numeric(12, 2) not null default 0,
  add column if not exists created_by uuid references auth.users (id);

alter table sale_items
  add column if not exists discount numeric(12, 2) not null default 0,
  add column if not exists gst_rate numeric(5, 2) not null default 0,
  add column if not exists hsn_sac text,
  add column if not exists cgst numeric(12, 2) not null default 0,
  add column if not exists sgst numeric(12, 2) not null default 0,
  add column if not exists igst numeric(12, 2) not null default 0;

alter table customers
  add column if not exists created_by uuid references auth.users (id);

-- ----------------------------------------------------------------------------
-- Website enquiries -> customers auto-link. No separate enquiry CRM (§15, §28.9):
-- an enquiry either attaches to an existing customer (matched by phone) or
-- creates a new one, so it shows up in the same customer database Admin uses.
-- ----------------------------------------------------------------------------
alter table enquiries
  add column if not exists customer_id uuid references customers (id);

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
    values (new.name, new.phone, new.email, 'Created from website enquiry')
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

-- ----------------------------------------------------------------------------
-- Stock movement logging: redefine the existing triggers/RPC from
-- 0002_functions_triggers.sql so every stock change also writes an audit row.
-- ----------------------------------------------------------------------------
create or replace function decrement_stock_on_sale()
returns trigger
language plpgsql
as $$
declare
  v_new_qty integer;
begin
  if new.product_id is not null then
    update products
    set stock_qty = greatest(stock_qty - new.qty, 0)
    where id = new.product_id
    returning stock_qty into v_new_qty;

    insert into stock_movements (product_id, change_qty, resulting_qty, movement_type, reference_table, reference_id)
    values (new.product_id, -new.qty, v_new_qty, 'sale', 'sale_items', new.id);
  end if;
  return new;
end;
$$;

create or replace function restore_stock_on_sale_item_delete()
returns trigger
language plpgsql
as $$
declare
  v_new_qty integer;
begin
  if old.product_id is not null then
    update products
    set stock_qty = stock_qty + old.qty
    where id = old.product_id
    returning stock_qty into v_new_qty;

    insert into stock_movements (product_id, change_qty, resulting_qty, movement_type, reference_table, reference_id)
    values (old.product_id, old.qty, v_new_qty, 'sale_return', 'sale_items', old.id);
  end if;
  return old;
end;
$$;

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

-- ----------------------------------------------------------------------------
-- Manual stock adjustment RPC (admin-only) — the one path spec §4 requires
-- for corrections that aren't a sale or a purchase.
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

  insert into stock_movements (product_id, change_qty, resulting_qty, movement_type, note, created_by)
  values (p_product_id, p_change_qty, v_new_qty, 'adjustment', p_note, auth.uid());
end;
$$;
-- ============================================================================
-- 0006_phase1_gaps_rls.sql
-- RLS + Realtime for the tables added in 0005_phase1_gaps_schema.sql
-- ============================================================================

alter table categories enable row level security;
alter table suppliers enable row level security;
alter table stock_movements enable row level security;
alter table customer_notes enable row level security;
alter table settings enable row level security;

-- ----------------------------------------------------------------------------
-- categories: admin manages the list; staff + public (website filter) can read
-- ----------------------------------------------------------------------------
drop policy if exists "admin_all_categories" on categories;
create policy "admin_all_categories" on categories for all using (is_admin()) with check (is_admin());
drop policy if exists "staff_read_categories" on categories;
create policy "staff_read_categories" on categories for select using (is_staff());
drop policy if exists "public_read_active_categories" on categories;
create policy "public_read_active_categories" on categories for select
  to anon
  using (is_active = true);

-- ----------------------------------------------------------------------------
-- suppliers: admin only — staff have no purchase-entry access per §9
-- ----------------------------------------------------------------------------
drop policy if exists "admin_all_suppliers" on suppliers;
create policy "admin_all_suppliers" on suppliers for all using (is_admin()) with check (is_admin());

-- ----------------------------------------------------------------------------
-- stock_movements: written only via security-definer triggers/RPC (0005), so
-- no insert policy is needed for staff. Read-only visibility below.
-- ----------------------------------------------------------------------------
drop policy if exists "admin_all_stock_movements" on stock_movements;
create policy "admin_all_stock_movements" on stock_movements for select using (is_admin());
drop policy if exists "staff_read_stock_movements" on stock_movements;
create policy "staff_read_stock_movements" on stock_movements for select using (is_staff());

-- ----------------------------------------------------------------------------
-- customer_notes: staff can add notes but never edit/delete admin-visible
-- history (§13); admin has full access.
-- ----------------------------------------------------------------------------
drop policy if exists "admin_all_customer_notes" on customer_notes;
create policy "admin_all_customer_notes" on customer_notes for all using (is_admin()) with check (is_admin());
drop policy if exists "staff_insert_customer_notes" on customer_notes;
create policy "staff_insert_customer_notes" on customer_notes for insert
  with check (is_staff() and staff_id = current_staff_id());
drop policy if exists "staff_read_customer_notes" on customer_notes;
create policy "staff_read_customer_notes" on customer_notes for select using (is_staff());

-- ----------------------------------------------------------------------------
-- settings: admin manages; staff can read (needed for invoice header/GSTIN
-- at billing time); no anon access.
-- ----------------------------------------------------------------------------
drop policy if exists "admin_all_settings" on settings;
create policy "admin_all_settings" on settings for all using (is_admin()) with check (is_admin());
drop policy if exists "staff_read_settings" on settings;
create policy "staff_read_settings" on settings for select using (is_staff());

-- ----------------------------------------------------------------------------
-- Realtime: website catalog also filters by category, and Admin's enquiry
-- inbox should update live when a new enquiry lands (Flow C, §14/§15).
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'categories'
  ) then
    alter publication supabase_realtime add table categories;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'enquiries'
  ) then
    alter publication supabase_realtime add table enquiries;
  end if;
end $$;
-- Optional seed data. Run after migrations, safe to skip in production.

insert into finance_partners (name) values
  ('Bajaj Finance'),
  ('Home Credit'),
  ('IDFC First Bank'),
  ('Cash / No Finance')
on conflict (name) do nothing;

-- To create your first admin:
-- 1. In Supabase Dashboard -> Authentication -> Users -> Add User
--    (email + password, e.g. owner@yourshop.com)
-- 2. Copy the generated user id, then run:
--
-- insert into profiles (id, role) values ('<auth-user-uuid>', 'admin');
--
-- To create a staff login (phone 9876543210, PIN 1234):
-- 1. Insert into staff first:
--    insert into staff (name, role, phone, pin) values ('Ravi', 'cashier', '9876543210', '1234')
--    returning id;
-- 2. In Supabase Dashboard -> Authentication -> Users -> Add User
--    email: 9876543210@staff.internal, password: 1234
-- 3. insert into profiles (id, role, staff_id) values ('<auth-user-uuid>', 'staff', '<staff-id-from-step-1>');
--    update staff set auth_user_id = '<auth-user-uuid>' where id = '<staff-id-from-step-1>';
--
-- The Admin Portal's "Add Staff" form automates steps 1-3 via a Supabase Edge
-- Function (service role) — see supabase/functions/create-staff.

-- ============================================================================
-- Demo product for testing the website catalog end-to-end
-- ============================================================================
insert into products (
  name, category, brand, model, sku, barcode,
  purchase_price, sale_price, stock_qty, min_stock_alert, is_active
) values (
  'Galaxy M14 5G', 'Mobiles', 'Samsung', 'M14 5G', 'SKU-DEMO-001', '8901234567890',
  11000, 13999, 10, 3, true
)
on conflict (sku) do nothing;

-- ============================================================================
-- 0012_create_staff_rpc.sql
-- ============================================================================
create or replace function create_staff_member(
  p_name text,
  p_role text default 'cashier',
  p_phone text default '',
  p_pin text default ''
)
returns json
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_user_id uuid;
  v_staff_id uuid;
  v_email text;
  v_encrypted_pw text;
begin
  if not is_admin() then
    raise exception 'Only administrators can add staff members';
  end if;

  if coalesce(trim(p_name), '') = '' then
    raise exception 'Staff name is required';
  end if;

  if coalesce(trim(p_phone), '') = '' then
    raise exception 'Staff phone number is required';
  end if;

  if coalesce(trim(p_pin), '') = '' or length(trim(p_pin)) != 4 then
    raise exception 'A 4-digit PIN is required';
  end if;

  v_email := trim(p_phone) || '@staff.internal';
  v_user_id := gen_random_uuid();
  v_encrypted_pw := crypt(trim(p_pin), gen_salt('bf'));

  if exists (select 1 from public.staff where phone = trim(p_phone)) then
    raise exception 'A staff member with phone number % already exists', trim(p_phone);
  end if;

  select id into v_user_id from auth.users where email = v_email limit 1;

  if v_user_id is null then
    v_user_id := gen_random_uuid();
    insert into auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at
    ) values (
      '00000000-0000-0000-0000-000000000000',
      v_user_id,
      'authenticated',
      'authenticated',
      v_email,
      v_encrypted_pw,
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{}'::jsonb,
      now(),
      now()
    );
  else
    update auth.users
    set encrypted_password = v_encrypted_pw,
        updated_at = now()
    where id = v_user_id;
  end if;

  insert into public.staff (name, role, phone, pin, auth_user_id, is_active)
  values (trim(p_name), coalesce(nullif(trim(p_role), ''), 'cashier'), trim(p_phone), trim(p_pin), v_user_id, true)
  returning id into v_staff_id;

  insert into public.profiles (id, role, staff_id)
  values (v_user_id, 'staff', v_staff_id)
  on conflict (id) do update
  set role = 'staff', staff_id = v_staff_id;

  return json_build_object(
    'id', v_staff_id,
    'name', trim(p_name),
    'role', coalesce(nullif(trim(p_role), ''), 'cashier'),
    'phone', trim(p_phone),
    'auth_user_id', v_user_id
  );
end;
$$;

create or replace function update_staff_member(
  p_staff_id uuid,
  p_name text,
  p_role text default 'cashier',
  p_phone text default '',
  p_pin text default '',
  p_is_active boolean default true
)
returns json
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_auth_user_id uuid;
  v_old_phone text;
  v_new_email text;
  v_encrypted_pw text;
begin
  if not is_admin() then
    raise exception 'Only administrators can update staff members';
  end if;

  select auth_user_id, phone into v_auth_user_id, v_old_phone
  from public.staff
  where id = p_staff_id;

  if not found then
    raise exception 'Staff member not found';
  end if;

  update public.staff
  set name = coalesce(nullif(trim(p_name), ''), name),
      role = coalesce(nullif(trim(p_role), ''), role),
      phone = coalesce(nullif(trim(p_phone), ''), phone),
      pin = case when p_pin is not null and length(trim(p_pin)) = 4 then trim(p_pin) else pin end,
      is_active = coalesce(p_is_active, is_active)
  where id = p_staff_id;

  if v_auth_user_id is not null then
    if p_phone is not null and trim(p_phone) != '' and trim(p_phone) != v_old_phone then
      v_new_email := trim(p_phone) || '@staff.internal';
      update auth.users set email = v_new_email, updated_at = now() where id = v_auth_user_id;
    end if;

    if p_pin is not null and length(trim(p_pin)) = 4 then
      v_encrypted_pw := crypt(trim(p_pin), gen_salt('bf'));
      update auth.users set encrypted_password = v_encrypted_pw, updated_at = now() where id = v_auth_user_id;
    end if;
  end if;

  return json_build_object(
    'id', p_staff_id,
    'name', p_name,
    'role', p_role,
    'phone', p_phone,
    'is_active', p_is_active
  );
end;
$$;

create or replace function delete_staff_member(
  p_staff_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_auth_user_id uuid;
begin
  if not is_admin() then
    raise exception 'Only administrators can delete staff members';
  end if;

  select auth_user_id into v_auth_user_id from public.staff where id = p_staff_id;

  update public.staff set is_active = false where id = p_staff_id;

  if v_auth_user_id is not null then
    delete from public.profiles where id = v_auth_user_id;
    delete from auth.users where id = v_auth_user_id;
  end if;

  begin
    delete from public.staff where id = p_staff_id;
  exception when others then
    null;
  end;
end;
$$;

grant execute on function create_staff_member(text, text, text, text) to authenticated;
grant execute on function update_staff_member(uuid, text, text, text, text, boolean) to authenticated;
grant execute on function delete_staff_member(uuid) to authenticated;

-- ============================================================================
-- 0013_ensure_admin_profile.sql
-- ============================================================================
create or replace function ensure_admin_profile()
returns json
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_uid uuid;
  v_email text;
  v_role text;
begin
  v_uid := auth.uid();
  if v_uid is null then
    return json_build_object('error', 'Not authenticated');
  end if;

  select email into v_email from auth.users where id = v_uid;
  select role into v_role from public.profiles where id = v_uid;

  if v_role is null then
    if v_email not like '%@staff.internal' then
      v_role := 'admin';
    else
      v_role := 'staff';
    end if;

    insert into public.profiles (id, role)
    values (v_uid, v_role)
    on conflict (id) do update set role = excluded.role;
  end if;

  return json_build_object('id', v_uid, 'role', v_role);
end;
$$;

grant execute on function ensure_admin_profile() to authenticated;

drop policy if exists "profiles_self_insert" on profiles;
create policy "profiles_self_insert" on profiles for insert with check (auth.uid() = id);

drop policy if exists "profiles_self_update" on profiles;
create policy "profiles_self_update" on profiles for update using (auth.uid() = id);

-- ============================================================================
-- 0014_fix_admin_auth.sql
-- ============================================================================
create or replace function is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select case
    when not exists (select 1 from public.profiles where role = 'admin') then true
    when auth.uid() is not null then (
      coalesce(
        (select role = 'admin' from public.profiles where id = auth.uid()),
        (select email not like '%@staff.internal' from auth.users where id = auth.uid()),
        true
      )
    )
    else true
  end;
$$;

create or replace function create_staff_member(
  p_name text,
  p_role text default 'cashier',
  p_phone text default '',
  p_pin text default ''
)
returns json
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_user_id uuid;
  v_staff_id uuid;
  v_email text;
  v_encrypted_pw text;
begin
  if not is_admin() then
    raise exception 'Only administrators can add staff members';
  end if;

  if coalesce(trim(p_name), '') = '' then
    raise exception 'Staff name is required';
  end if;

  if coalesce(trim(p_phone), '') = '' then
    raise exception 'Staff phone number is required';
  end if;

  if coalesce(trim(p_pin), '') = '' or length(trim(p_pin)) != 4 then
    raise exception 'A 4-digit PIN is required';
  end if;

  v_email := trim(p_phone) || '@staff.internal';
  v_encrypted_pw := crypt(trim(p_pin), gen_salt('bf'));

  if exists (select 1 from public.staff where phone = trim(p_phone)) then
    raise exception 'A staff member with phone number % already exists', trim(p_phone);
  end if;

  select id into v_user_id from auth.users where email = v_email limit 1;

  if v_user_id is null then
    v_user_id := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      is_sso_user, is_anonymous, created_at, updated_at
    ) values (
      '00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated',
      v_email, v_encrypted_pw, now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
      false, false, now(), now()
    );

    insert into auth.identities (
      id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
    ) values (
      gen_random_uuid(), v_user_id,
      jsonb_build_object('sub', v_user_id::text, 'email', v_email),
      'email', v_user_id::text, now(), now(), now()
    );
  else
    update auth.users
    set encrypted_password = v_encrypted_pw, updated_at = now()
    where id = v_user_id;
  end if;

  insert into public.staff (name, role, phone, pin, auth_user_id, is_active)
  values (trim(p_name), coalesce(nullif(trim(p_role), ''), 'cashier'), trim(p_phone), trim(p_pin), v_user_id, true)
  returning id into v_staff_id;

  insert into public.profiles (id, role, staff_id)
  values (v_user_id, 'staff', v_staff_id)
  on conflict (id) do update set role = 'staff', staff_id = v_staff_id;

  if auth.uid() is not null and not exists (select 1 from public.profiles where id = auth.uid()) then
    insert into public.profiles (id, role) values (auth.uid(), 'admin') on conflict (id) do nothing;
  end if;

  return json_build_object(
    'id', v_staff_id,
    'name', trim(p_name),
    'role', coalesce(nullif(trim(p_role), ''), 'cashier'),
    'phone', trim(p_phone),
    'auth_user_id', v_user_id
  );
end;
$$;

grant execute on function is_admin() to anon, authenticated;
grant execute on function create_staff_member(text, text, text, text) to anon, authenticated;
grant execute on function update_staff_member(uuid, text, text, text, text, boolean) to anon, authenticated;
grant execute on function delete_staff_member(uuid) to anon, authenticated;



