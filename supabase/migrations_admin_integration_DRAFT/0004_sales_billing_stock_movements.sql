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
