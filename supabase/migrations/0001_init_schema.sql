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
