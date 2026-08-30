-- ============================================================================
-- 0006_OPTIONAL_web_order_stock_sync.sql  (DRAFT — for review, OPTIONAL)
--
-- This file is kept SEPARATE and marked optional on purpose: applying it
-- changes live website behavior (online orders will start actually
-- decrementing products.stock_qty, which they currently do not).
-- Apply only after you've confirmed you want that turned on.
--
-- Depends on: 0004 (stock_movements table + movement_type values).
-- Does not modify orders/order_items columns or existing rows — only adds
-- triggers.
-- ============================================================================

create or replace function decrement_stock_on_web_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_qty integer;
begin
  if new.product_id is not null then
    update products
    set stock_qty = greatest(stock_qty - new.quantity, 0)
    where id = new.product_id
    returning stock_qty into v_new_qty;

    insert into stock_movements (product_id, change_qty, resulting_qty, movement_type, reference_table, reference_id)
    values (new.product_id, -new.quantity, v_new_qty, 'web_order', 'order_items', new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_decrement_stock_on_web_order on order_items;
create trigger trg_decrement_stock_on_web_order
  after insert on order_items
  for each row execute function decrement_stock_on_web_order();

-- NOTE: order cancellation/restock is intentionally NOT implemented here.
-- `order_status` lives on `orders`, not `order_items`, so a restock trigger
-- would need to fire on `orders` UPDATE (status -> 'cancelled') and then
-- walk that order's `order_items` to restore each product's stock_qty.
-- Left out until you confirm the exact cancel/refund flow you want — happy
-- to draft it as a follow-up once decided.
