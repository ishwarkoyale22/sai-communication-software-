-- ============================================================================
-- 0041_role_based_staff_portals.sql
--
-- Backend for splitting the Staff Portal into Technician / Sales / Receptionist
-- role-based portals. Per the audit: most requested features already exist
-- (Attendance, Leave, Tasks, Notifications, My Repairs, Clients, Follow-ups,
-- Reviews) and just get re-routed into the right portal in the frontend —
-- nothing new needed in the DB for those.
--
-- What's actually new here is the small set of genuinely-missing pieces:
--   - staff.role gets a real value set (technician/sales/receptionist),
--     settable at self-registration and by admin.
--   - staff_get_enquiries / staff_get_my_sales / staff_get_sales_targets /
--     staff_get_website_orders — read-only RPCs, all just security-definer
--     wrappers reusing existing tables that already have data (some had no
--     staff-readable RLS path at all, like sales_targets/website_orders/
--     enquiries; the RPC bypasses that the same way every other staff RPC
--     already does).
--   - staff_create_sale — a staff-facing "New Sale" was never possible
--     before (sales/sales_items have zero anon RLS access) — covers
--     non-serialized inventory items + gifts, matching the bulk of a real
--     sale; serialized/IMEI phone sales remain Admin-only by design (that
--     flow has IMEI-uniqueness/lifecycle logic that belongs in one place).
--
-- Also fixes a real bug found while inspecting sales: apps/admin/Sales.tsx
-- already writes `finance_partner_id` on every sale insert, but the column
-- was never added to the table — every "Bajaj Finance"-style sale has been
-- silently impossible since that feature shipped. Fixed here.
-- ============================================================================

alter table public.sales add column if not exists finance_partner_id uuid references public.finance_partners (id);

-- ----------------------------------------------------------------------------
-- Staff roles
-- ----------------------------------------------------------------------------
drop function if exists public.staff_register(text, text, text, text, date);

create or replace function public.staff_register(
  p_name text,
  p_phone text,
  p_email text,
  p_pin text,
  p_date_of_birth date default null,
  p_role text default 'sales'
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_name is null or length(trim(p_name)) = 0 then
    return json_build_object('success', false, 'error', 'Full name is required.');
  end if;
  if p_phone is null or length(trim(p_phone)) < 10 then
    return json_build_object('success', false, 'error', 'A valid mobile number is required.');
  end if;
  if p_pin is null or p_pin !~ '^[0-9]{4}$' then
    return json_build_object('success', false, 'error', 'Password must be a 4-digit PIN, matching how you will log in.');
  end if;
  if p_role not in ('technician', 'sales', 'receptionist') then
    return json_build_object('success', false, 'error', 'Please select a valid role.');
  end if;
  if exists (select 1 from staff where phone = trim(p_phone)) then
    return json_build_object('success', false, 'error', 'An account with this mobile number already exists.');
  end if;

  insert into staff (name, phone, email, pin, date_of_birth, role, is_active)
  values (trim(p_name), trim(p_phone), nullif(trim(p_email), ''), p_pin, p_date_of_birth, p_role, false)
  returning id into v_id;

  return json_build_object('success', true, 'staff_id', v_id);
end;
$$;

grant execute on function public.staff_register(text, text, text, text, date, text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- Customer Enquiries — read access for Sales + Receptionist (the `enquiries`
-- table already accepts anon INSERT from the public website contact form,
-- but had no staff-readable SELECT path at all).
-- ----------------------------------------------------------------------------
create or replace function public.staff_get_enquiries(p_token uuid)
returns setof enquiries
language plpgsql
security definer
set search_path = public
as $$
begin
  if resolve_staff_session(p_token) is null then
    raise exception 'Invalid or expired session';
  end if;
  return query select * from enquiries order by created_at desc limit 200;
end;
$$;

grant execute on function public.staff_get_enquiries(uuid) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- Sales Person: own sales history/performance, store-wide targets, website orders
-- ----------------------------------------------------------------------------
create or replace function public.staff_get_my_sales(p_token uuid)
returns setof sales
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff_id uuid := resolve_staff_session(p_token);
begin
  return query select * from sales where staff_id = v_staff_id order by created_at desc;
end;
$$;

create or replace function public.staff_get_sales_targets(p_token uuid)
returns setof sales_targets
language plpgsql
security definer
set search_path = public
as $$
begin
  if resolve_staff_session(p_token) is null then
    raise exception 'Invalid or expired session';
  end if;
  return query select * from sales_targets;
end;
$$;

create or replace function public.staff_get_website_orders(p_token uuid)
returns setof website_orders
language plpgsql
security definer
set search_path = public
as $$
begin
  if resolve_staff_session(p_token) is null then
    raise exception 'Invalid or expired session';
  end if;
  return query select * from website_orders order by created_at desc limit 100;
end;
$$;

grant execute on function public.staff_get_my_sales(uuid) to anon, authenticated;
grant execute on function public.staff_get_sales_targets(uuid) to anon, authenticated;
grant execute on function public.staff_get_website_orders(uuid) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- Sales Person: New Sale (non-serialized inventory items + gifts). Mirrors
-- apps/admin/src/pages/Sales.tsx's createSale() logic, minus the IMEI/serial
-- unit handling (admin-only) and the finance-partner picker (staff can still
-- record cash/card/upi/bank_transfer).
--
-- p_items:      [{"inventory_id": uuid, "item_name": text, "quantity": int, "unit_price": numeric}, ...]
-- p_gift_items: [{"gift_id": uuid, "quantity": int, "unit_price": numeric, "unit_cost": numeric}, ...]
-- ----------------------------------------------------------------------------
create or replace function public.staff_create_sale(
  p_token uuid,
  p_customer_name text,
  p_customer_phone text,
  p_payment_method text,
  p_items jsonb,
  p_gift_items jsonb default '[]'::jsonb
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
  v_line_names text[] := '{}';
begin
  if p_customer_name is null or length(trim(p_customer_name)) = 0 then
    return json_build_object('success', false, 'error', 'Customer name is required.');
  end if;
  if (select count(*) from jsonb_array_elements(p_items)) + (select count(*) from jsonb_array_elements(p_gift_items)) = 0 then
    return json_build_object('success', false, 'error', 'Add at least one item or gift.');
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

  v_invoice_number := 'INV-' || to_char(now(), 'YYYYMMDD') || '-' || floor(1000 + random() * 9000)::int;

  insert into sales (invoice_number, customer_id, customer_name, customer_phone, sale_type, total_amount, discount, final_amount, payment_method, payment_status, staff_id)
  values (v_invoice_number, v_customer_id, trim(p_customer_name), nullif(trim(p_customer_phone), ''), 'in_store', v_total, 0, v_total, coalesce(p_payment_method, 'cash'), 'paid', v_staff_id)
  returning id into v_sale_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    insert into sales_items (sale_id, inventory_id, item_name, quantity, unit_price, total_price)
    values (v_sale_id, (v_item->>'inventory_id')::uuid, v_item->>'item_name', (v_item->>'quantity')::int, (v_item->>'unit_price')::numeric,
      (v_item->>'quantity')::numeric * (v_item->>'unit_price')::numeric);

    update inventory set stock = greatest(0, stock - (v_item->>'quantity')::int) where id = (v_item->>'inventory_id')::uuid;
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
end;
$$;

grant execute on function public.staff_create_sale(uuid, text, text, text, jsonb, jsonb) to anon, authenticated;
