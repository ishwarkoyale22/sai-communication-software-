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
