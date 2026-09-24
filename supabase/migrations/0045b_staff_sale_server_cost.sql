-- 0045b: staff_create_sale now takes the gift COST from the database instead of
-- the client, because gifts.cost_price is no longer readable by the (anon)
-- staff portal after 0045. Everything else is identical to 0044.

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
    values ((v_gift->>'gift_id')::uuid, v_sale_id, (v_gift->>'quantity')::int, (v_gift->>'unit_price')::numeric,
      coalesce((select cost_price from gifts where id = (v_gift->>'gift_id')::uuid), 0), v_staff_id);
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
