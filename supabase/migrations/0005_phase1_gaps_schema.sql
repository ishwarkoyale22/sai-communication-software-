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
