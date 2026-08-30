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
