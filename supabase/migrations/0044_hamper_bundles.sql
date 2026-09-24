-- ============================================================================
-- 0044_hamper_bundles.sql
--
-- Gift Hampers become real shop bundles built ONLY from existing `inventory`
-- products (via hamper_products). A hamper has no stock of its own:
--
--   available hampers = min over components of floor(component stock / qty)
--
-- Selling N hampers deducts N x qty of every component from `inventory.stock`
-- (the single source of truth) inside the DB, atomically, and the sale is
-- rejected if any component is short. Deleting a hamper sale (void/reversal)
-- puts every component back. Hamper sales reuse the normal `sales` /
-- `sales_items` rows, so GST, payment method, invoices and sales history need
-- no changes.
--
-- Cost model (computed, never typed in):
--   product cost = sum(inventory.cost_price x component qty)
--   total cost   = product cost + hamper_items.packaging_cost
--   profit       = selling price (hamper_items.price) - total cost
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) hamper_items: packaging cost; `stock` becomes a derived read-only cache
--    (kept only so the public storefront, which may still read the column,
--    sees the real number). It can no longer be set by hand.
-- ----------------------------------------------------------------------------
alter table public.hamper_items add column if not exists packaging_cost numeric not null default 0;

-- Components must be plain (non-serialized) stock — IMEI/serial phones have
-- their stock derived from inventory_units and can't be counted down here.
create or replace function public.hamper_available(p_hamper uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(min(
    case when coalesce(i.is_active, true) then floor(greatest(coalesce(i.stock, 0), 0)::numeric / hp.quantity) else 0 end
  ), 0)::int
  from public.hamper_products hp
  join public.inventory i on i.id = hp.inventory_id
  where hp.hamper_id = p_hamper;
$$;

create or replace function public.hamper_unit_cost(p_hamper uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(coalesce(i.cost_price, 0) * hp.quantity), 0) + coalesce((select packaging_cost from public.hamper_items where id = p_hamper), 0)
  from public.hamper_products hp
  join public.inventory i on i.id = hp.inventory_id
  where hp.hamper_id = p_hamper;
$$;

-- "Birthday Hamper (Gift Box x1, Charger x1, ...)" — what appears on the
-- invoice / sales history line so the customer sees what is inside.
create or replace function public.hamper_display_name(p_hamper uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select h.name || coalesce(' (' || nullif((
    select string_agg(trim(i.name || ' ' || coalesce(i.model, '')) || ' x' || hp.quantity, ', ' order by i.name)
    from public.hamper_products hp join public.inventory i on i.id = hp.inventory_id
    where hp.hamper_id = h.id
  ), '') || ')', '')
  from public.hamper_items h where h.id = p_hamper;
$$;

grant execute on function public.hamper_available(uuid) to anon, authenticated;
grant execute on function public.hamper_unit_cost(uuid) to anon, authenticated;
grant execute on function public.hamper_display_name(uuid) to anon, authenticated;

create or replace function public.hamper_items_force_derived_stock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.stock := public.hamper_available(new.id);
  return new;
end;
$$;

drop trigger if exists trg_hamper_items_derived_stock on public.hamper_items;
create trigger trg_hamper_items_derived_stock
  before insert or update on public.hamper_items
  for each row execute function public.hamper_items_force_derived_stock();

-- ----------------------------------------------------------------------------
-- 2) hamper_products: any number of components, no duplicates, qty >= 1,
--    non-serialized inventory only; keep the derived stock in sync.
-- ----------------------------------------------------------------------------
drop trigger if exists hamper_products_limit_trigger on public.hamper_products;

alter table public.hamper_products drop constraint if exists hamper_products_quantity_positive;
alter table public.hamper_products add constraint hamper_products_quantity_positive check (quantity > 0);
create unique index if not exists hamper_products_unique_component on public.hamper_products (hamper_id, inventory_id);

create or replace function public.hamper_products_validate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_serialized boolean;
  v_name text;
begin
  select is_serialized, name into v_serialized, v_name from public.inventory where id = new.inventory_id;
  if coalesce(v_serialized, false) then
    raise exception '"%" is tracked by IMEI/serial number and cannot be a hamper component.', v_name;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_hamper_products_validate on public.hamper_products;
create trigger trg_hamper_products_validate
  before insert or update on public.hamper_products
  for each row execute function public.hamper_products_validate();

create or replace function public.hamper_products_refresh_stock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    update public.hamper_items set stock = public.hamper_available(id) where id = old.hamper_id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    update public.hamper_items set stock = public.hamper_available(id) where id = new.hamper_id;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_hamper_products_refresh on public.hamper_products;
create trigger trg_hamper_products_refresh
  after insert or update or delete on public.hamper_products
  for each row execute function public.hamper_products_refresh_stock();

-- Any change to a component's stock / active flag re-derives the hampers it is in.
create or replace function public.inventory_refresh_hampers()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.hamper_items h
  set stock = public.hamper_available(h.id)
  where h.id in (select hamper_id from public.hamper_products where inventory_id = new.id);
  return new;
end;
$$;

drop trigger if exists trg_inventory_refresh_hampers on public.inventory;
create trigger trg_inventory_refresh_hampers
  after update of stock, is_active on public.inventory
  for each row
  when (old.stock is distinct from new.stock or old.is_active is distinct from new.is_active)
  execute function public.inventory_refresh_hampers();

-- ----------------------------------------------------------------------------
-- 3) Hamper sales ledger (mirrors gift_sales) + per-sale component ledger.
--    The component ledger records exactly what was deducted, so a reversal is
--    correct even if the hamper's recipe is edited later.
-- ----------------------------------------------------------------------------
create table if not exists public.hamper_sales (
  id uuid primary key default gen_random_uuid(),
  hamper_id uuid references public.hamper_items (id) on delete set null,
  hamper_name text not null,
  sale_id uuid references public.sales (id) on delete cascade,
  quantity integer not null check (quantity > 0),
  unit_price numeric not null default 0,
  unit_cost numeric not null default 0,   -- product cost + packaging at time of sale
  staff_id uuid references public.staff (id),
  created_at timestamptz not null default now()
);
create index if not exists idx_hamper_sales_hamper on public.hamper_sales (hamper_id, created_at desc);
create index if not exists idx_hamper_sales_sale on public.hamper_sales (sale_id);

create table if not exists public.hamper_sale_components (
  id uuid primary key default gen_random_uuid(),
  hamper_sale_id uuid not null references public.hamper_sales (id) on delete cascade,
  inventory_id uuid references public.inventory (id) on delete set null,
  quantity integer not null check (quantity > 0)  -- total units deducted for this sale line
);
create index if not exists idx_hamper_sale_components_sale on public.hamper_sale_components (hamper_sale_id);

alter table public.hamper_sales enable row level security;
alter table public.hamper_sale_components enable row level security;
grant all on public.hamper_sales to anon, authenticated;
grant all on public.hamper_sale_components to anon, authenticated;

drop policy if exists "hamper_sales_select_all" on public.hamper_sales;
create policy "hamper_sales_select_all" on public.hamper_sales for select using (true);
drop policy if exists "hamper_sales_insert_any" on public.hamper_sales;
create policy "hamper_sales_insert_any" on public.hamper_sales for insert with check (true);
drop policy if exists "hamper_sales_delete_authenticated" on public.hamper_sales;
create policy "hamper_sales_delete_authenticated" on public.hamper_sales for delete
  using (auth.role() = 'authenticated');

drop policy if exists "hamper_sale_components_select_all" on public.hamper_sale_components;
create policy "hamper_sale_components_select_all" on public.hamper_sale_components for select using (true);

-- Deduct components (blocks the whole statement/transaction on any shortage).
create or replace function public.apply_hamper_sale()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_count integer := 0;
  v_need integer;
begin
  if new.hamper_id is null then
    raise exception 'Hamper sale needs a hamper.';
  end if;

  -- Lock component rows in a fixed order (no deadlocks between two sales) and
  -- read the freshest stock after any wait.
  for r in
    select hp.inventory_id, hp.quantity, i.name, i.model, i.stock, i.is_active, i.is_serialized
    from public.hamper_products hp
    join public.inventory i on i.id = hp.inventory_id
    where hp.hamper_id = new.hamper_id
    order by hp.inventory_id
    for update of i
  loop
    v_count := v_count + 1;
    v_need := r.quantity * new.quantity;
    if coalesce(r.is_serialized, false) then
      raise exception '"%" is tracked by IMEI/serial and cannot be sold inside a hamper.', r.name;
    end if;
    if not coalesce(r.is_active, true) then
      raise exception 'Hamper "%" cannot be sold: component "% %" is inactive.', new.hamper_name, r.name, coalesce(r.model, '');
    end if;
    if coalesce(r.stock, 0) < v_need then
      raise exception 'Not enough stock for hamper "%": "% %" needs % (% x %) but only % in stock.',
        new.hamper_name, r.name, coalesce(r.model, ''), v_need, r.quantity, new.quantity, coalesce(r.stock, 0);
    end if;

    update public.inventory set stock = coalesce(stock, 0) - v_need where id = r.inventory_id;
    insert into public.hamper_sale_components (hamper_sale_id, inventory_id, quantity) values (new.id, r.inventory_id, v_need);
  end loop;

  if v_count = 0 then
    raise exception 'Hamper "%" has no component products, so it cannot be sold.', new.hamper_name;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_apply_hamper_sale on public.hamper_sales;
create trigger trg_apply_hamper_sale
  after insert on public.hamper_sales
  for each row execute function public.apply_hamper_sale();

-- Reversal: deleting a hamper sale line (or the whole sale, which cascades)
-- puts every deducted component back. BEFORE DELETE so the ledger is intact.
create or replace function public.reverse_hamper_sale()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.inventory i
  set stock = coalesce(i.stock, 0) + c.quantity
  from public.hamper_sale_components c
  where c.hamper_sale_id = old.id and c.inventory_id = i.id;
  return old;
end;
$$;

drop trigger if exists trg_reverse_hamper_sale on public.hamper_sales;
create trigger trg_reverse_hamper_sale
  before delete on public.hamper_sales
  for each row execute function public.reverse_hamper_sale();

-- A recorded hamper sale is immutable (change = delete + re-sell), otherwise
-- the ledger and stock would drift apart.
create or replace function public.hamper_sales_block_update()
returns trigger
language plpgsql
as $$
begin
  if new.hamper_id is distinct from old.hamper_id and new.hamper_id is null and old.hamper_id is not null then
    return new; -- hamper deleted from the catalogue (ON DELETE SET NULL); history stays
  end if;
  if new.quantity is distinct from old.quantity or new.hamper_id is distinct from old.hamper_id then
    raise exception 'A recorded hamper sale cannot be edited — delete it and sell again.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_hamper_sales_block_update on public.hamper_sales;
create trigger trg_hamper_sales_block_update
  before update on public.hamper_sales
  for each row execute function public.hamper_sales_block_update();

-- Atomic relative stock decrement for ordinary cart lines. Sales.tsx used to
-- write `stock = <stale snapshot> - qty`, which would silently overwrite a
-- hamper deduction made a moment earlier for the same product.
create or replace function public.decrement_inventory_stock(p_inventory_id uuid, p_qty integer)
returns void
language sql
security definer
set search_path = public
as $$
  update public.inventory set stock = greatest(0, coalesce(stock, 0) - p_qty) where id = p_inventory_id;
$$;
grant execute on function public.decrement_inventory_stock(uuid, integer) to authenticated;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'hamper_sales') then
    alter publication supabase_realtime add table public.hamper_sales;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 4) Sales Person portal: staff_create_sale now also accepts hampers.
--    p_hamper_items: [{"hamper_id": uuid, "quantity": int}, ...]
--    Price/cost/name come from the database, never from the client. Any
--    shortage raises inside this function, so the WHOLE sale rolls back.
-- ----------------------------------------------------------------------------
drop function if exists public.staff_create_sale(uuid, text, text, text, jsonb, jsonb);

create or replace function public.staff_create_sale(
  p_token uuid,
  p_customer_name text,
  p_customer_phone text,
  p_payment_method text,
  p_items jsonb,
  p_gift_items jsonb default '[]'::jsonb,
  p_hamper_items jsonb default '[]'::jsonb
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff_id uuid := resolve_staff_session(p_token);
  v_customer_id uuid;
  v_sale_id uuid;
  v_invoice_number text;
  v_total numeric := 0;
  v_item jsonb;
  v_gift jsonb;
  v_hamper jsonb;
  v_hamper_row record;
  v_qty integer;
  v_line_names text[] := '{}';
begin
  if p_customer_name is null or length(trim(p_customer_name)) = 0 then
    return json_build_object('success', false, 'error', 'Customer name is required.');
  end if;
  if (select count(*) from jsonb_array_elements(p_items)) + (select count(*) from jsonb_array_elements(p_gift_items)) + (select count(*) from jsonb_array_elements(p_hamper_items)) = 0 then
    return json_build_object('success', false, 'error', 'Add at least one item, gift or hamper.');
  end if;

  if p_customer_phone is not null and length(trim(p_customer_phone)) > 0 then
    select id into v_customer_id from customers where phone = trim(p_customer_phone);
    if v_customer_id is null then
      insert into customers (name, phone) values (trim(p_customer_name), trim(p_customer_phone)) returning id into v_customer_id;
    end if;
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_total := v_total + (v_item->>'quantity')::numeric * (v_item->>'unit_price')::numeric;
    v_line_names := v_line_names || (v_item->>'item_name');
  end loop;
  for v_gift in select * from jsonb_array_elements(p_gift_items) loop
    v_total := v_total + (v_gift->>'quantity')::numeric * (v_gift->>'unit_price')::numeric;
    v_line_names := v_line_names || coalesce((select name from gifts where id = (v_gift->>'gift_id')::uuid), 'Gift');
  end loop;
  for v_hamper in select * from jsonb_array_elements(p_hamper_items) loop
    select * into v_hamper_row from hamper_items where id = (v_hamper->>'hamper_id')::uuid;
    if not found or coalesce(v_hamper_row.is_active, true) = false then
      return json_build_object('success', false, 'error', 'A selected hamper is no longer available.');
    end if;
    v_total := v_total + (v_hamper->>'quantity')::numeric * v_hamper_row.price;
    v_line_names := v_line_names || v_hamper_row.name;
  end loop;

  v_invoice_number := 'INV-' || to_char(now(), 'YYYYMMDD') || '-' || floor(1000 + random() * 9000)::int;

  insert into sales (invoice_number, customer_id, customer_name, customer_phone, sale_type, total_amount, discount, final_amount, payment_method, payment_status, staff_id)
  values (v_invoice_number, v_customer_id, trim(p_customer_name), nullif(trim(p_customer_phone), ''), 'in_store', v_total, 0, v_total, coalesce(p_payment_method, 'cash'), 'paid', v_staff_id)
  returning id into v_sale_id;

  -- Ordinary items first, so a hamper containing the same product is checked
  -- against what is genuinely left.
  for v_item in select * from jsonb_array_elements(p_items) loop
    insert into sales_items (sale_id, inventory_id, item_name, quantity, unit_price, total_price)
    values (v_sale_id, (v_item->>'inventory_id')::uuid, v_item->>'item_name', (v_item->>'quantity')::int, (v_item->>'unit_price')::numeric,
      (v_item->>'quantity')::numeric * (v_item->>'unit_price')::numeric);

    update inventory set stock = greatest(0, stock - (v_item->>'quantity')::int) where id = (v_item->>'inventory_id')::uuid;
  end loop;

  for v_hamper in select * from jsonb_array_elements(p_hamper_items) loop
    v_qty := (v_hamper->>'quantity')::int;
    select * into v_hamper_row from hamper_items where id = (v_hamper->>'hamper_id')::uuid;

    insert into hamper_sales (hamper_id, hamper_name, sale_id, quantity, unit_price, unit_cost, staff_id)
    values (v_hamper_row.id, v_hamper_row.name, v_sale_id, v_qty, v_hamper_row.price, hamper_unit_cost(v_hamper_row.id), v_staff_id);

    insert into sales_items (sale_id, inventory_id, item_name, quantity, unit_price, total_price)
    values (v_sale_id, null, hamper_display_name(v_hamper_row.id), v_qty, v_hamper_row.price, v_qty * v_hamper_row.price);
  end loop;

  for v_gift in select * from jsonb_array_elements(p_gift_items) loop
    insert into gift_sales (gift_id, sale_id, quantity, unit_price, unit_cost, staff_id)
    values ((v_gift->>'gift_id')::uuid, v_sale_id, (v_gift->>'quantity')::int, (v_gift->>'unit_price')::numeric, coalesce((v_gift->>'unit_cost')::numeric, 0), v_staff_id);
  end loop;

  insert into notifications (for_admin, type, title, body, related_id, link)
  values (true, 'product_sold', 'Sale Completed',
    array_to_string(v_line_names[1:3], ', ') ||
      (case when array_length(v_line_names, 1) > 3 then ' +' || (array_length(v_line_names, 1) - 3) || ' more' else '' end) ||
      ' sold — ' || v_total || ' (by staff).',
    v_sale_id, '/sales');

  return json_build_object('success', true, 'sale_id', v_sale_id, 'invoice_number', v_invoice_number);
exception
  when others then
    -- Includes the "not enough stock" errors from apply_hamper_sale(): the
    -- whole sale (sale row, lines, stock moves) is rolled back automatically.
    return json_build_object('success', false, 'error', sqlerrm);
end;
$$;

grant execute on function public.staff_create_sale(uuid, text, text, text, jsonb, jsonb, jsonb) to anon, authenticated;

-- Existing hampers (if any): derive their stock now.
update public.hamper_items set stock = public.hamper_available(id);
