-- ============================================================================
-- 0011_security_fixes.sql
-- Fixes an authorization gap: process_wholesaler_invoice runs as
-- `security definer` (bypasses RLS) but never checked the caller was admin,
-- so any anon/staff API caller could invoke it directly to inflate stock or
-- rewrite purchase_price on arbitrary products. adjust_stock_manual already
-- did this correctly (0005) — this brings process_wholesaler_invoice in line
-- with it. No schema/data change, just a stricter function body.
-- ============================================================================

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

  update wholesaler_invoices
  set processed = true
  where id = p_invoice_id;
end;
$$;
