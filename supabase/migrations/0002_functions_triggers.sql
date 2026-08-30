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
