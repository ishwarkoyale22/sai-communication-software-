-- 0046: stock guards + fixes found in the second full test.
--   1. No overselling (DB-enforced)
--   2. EMI sales create a draft finance record
--   3. Website orders: hamper/mixed orders + "processing" status accepted;
--      delivering an order records the sale and moves stock (reversed if un-delivered)
--   4. IMEI "Returned" reverses the sale line
--   5. Staff: Add client, Submit review, Reschedule follow-up, leave-date validation
--   6. finance-reports storage bucket (private)

-- ----------------------------------------------------------------------------
-- 1. Overselling
-- ----------------------------------------------------------------------------
create or replace function public.decrement_inventory_stock(p_inventory_id uuid, p_qty integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_stock integer;
begin
  if not public.is_admin() then
    raise exception 'Not allowed.';
  end if;
  update public.inventory set stock = coalesce(stock, 0) - p_qty
  where id = p_inventory_id and coalesce(stock, 0) >= p_qty;
  if not found then
    select name, stock into v_name, v_stock from public.inventory where id = p_inventory_id;
    raise exception 'Not enough stock for "%": needs % but only % in stock.', coalesce(v_name, 'item'), p_qty, coalesce(v_stock, 0);
  end if;
end;
$$;
revoke execute on function public.decrement_inventory_stock(uuid, integer) from public, anon;
grant execute on function public.decrement_inventory_stock(uuid, integer) to authenticated;

-- Every sale line is checked against live stock before it is recorded (all
-- sale paths: admin New Sale, staff New Sale, website fulfilment).
create or replace function public.sales_items_check_stock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_stock integer;
begin
  if new.inventory_id is null then
    return new;
  end if;
  -- Only guard live sales; a backup restore re-inserts old sale lines against
  -- today's (lower) stock and must not be blocked.
  if exists (select 1 from public.sales where id = new.sale_id and created_at < now() - interval '10 minutes') then
    return new;
  end if;
  select name, coalesce(stock, 0) into v_name, v_stock from public.inventory where id = new.inventory_id for update;
  if v_stock < coalesce(new.quantity, 1) then
    raise exception 'Not enough stock for "%": needs % but only % in stock.', coalesce(v_name, new.item_name), new.quantity, v_stock;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_sales_items_check_stock on public.sales_items;
create trigger trg_sales_items_check_stock before insert on public.sales_items
  for each row execute function public.sales_items_check_stock();

alter table public.inventory drop constraint if exists inventory_stock_nonneg;
alter table public.inventory add constraint inventory_stock_nonneg check (stock >= 0) not valid;

-- ----------------------------------------------------------------------------
-- 2. EMI sale => draft finance record
-- ----------------------------------------------------------------------------
create or replace function public.sales_items_create_finance_draft()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  s record;
  v_id uuid;
begin
  select * into s from public.sales where id = new.sale_id;
  if not found or s.payment_method <> 'emi' then
    return new;
  end if;
  -- Only for live sales: a backup restore re-inserts old sale lines and restores
  -- finance_transactions itself, so drafting here would duplicate them.
  if s.created_at < now() - interval '10 minutes' then
    return new;
  end if;
  if exists (select 1 from public.finance_transactions where sale_id = s.id) then
    return new;
  end if;
  insert into public.finance_transactions
    (customer_id, sale_id, finance_partner_id, invoice_number, customer_name, customer_phone,
     product_name, sale_amount, finance_amount, status, notes)
  values
    (s.customer_id, s.id, s.finance_partner_id, s.invoice_number, s.customer_name, s.customer_phone,
     new.item_name, s.final_amount, s.final_amount, 'draft',
     'Auto-created from an EMI sale — add down payment, tenure and application details.')
  returning id into v_id;
  insert into public.finance_status_history (finance_transaction_id, from_status, to_status, note)
  values (v_id, null, 'draft', 'Finance record created automatically from EMI sale.');
  return new;
end;
$$;
drop trigger if exists trg_sales_items_finance_draft on public.sales_items;
create trigger trg_sales_items_finance_draft after insert on public.sales_items
  for each row execute function public.sales_items_create_finance_draft();

-- ----------------------------------------------------------------------------
-- 3. Website orders
-- ----------------------------------------------------------------------------
alter table public.website_orders drop constraint if exists website_orders_order_type_check;
alter table public.website_orders add constraint website_orders_order_type_check
  check (order_type = any (array['product','gift','giveaway','hamper','mixed']));

alter table public.website_orders drop constraint if exists website_orders_order_status_check;
alter table public.website_orders add constraint website_orders_order_status_check
  check (order_status = any (array['pending','confirmed','processing','ready','delivered','cancelled']));

alter table public.website_order_items drop constraint if exists website_order_items_item_type_check;
alter table public.website_order_items add constraint website_order_items_item_type_check
  check (item_type = any (array['product','hamper_item','refurbished','hamper_product']));

alter table public.website_orders add column if not exists sale_id uuid references public.sales(id) on delete set null;

create or replace function public.website_order_fulfil()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale uuid;
  v_cust uuid;
  v_pay text;
  v_disc numeric := coalesce(new.discount_amount, 0);
  it record;
  v_h record;
  v_inv record;
  v_si uuid;
  u record;
  li record;
begin
  -- Delivered: record the sale and move stock
  if new.order_status = 'delivered' and old.order_status is distinct from 'delivered' and new.sale_id is null then
    select id into v_cust from customers where phone = new.customer_phone limit 1;
    if v_cust is null then
      insert into customers (name, phone, email) values (new.customer_name, new.customer_phone, new.customer_email) returning id into v_cust;
    end if;
    v_pay := case when new.payment_method in ('cash','upi','card','emi','credit') then new.payment_method else 'cash' end;

    insert into sales (invoice_number, customer_id, customer_name, customer_phone, sale_type, total_amount, discount, final_amount,
                       payment_method, payment_status, notes)
    values ('WEB-' || new.order_number, v_cust, new.customer_name, new.customer_phone, 'website', new.total_amount + v_disc, v_disc,
            new.total_amount, v_pay, case when new.payment_status = 'paid' then 'paid' else 'pending' end,
            'Website order ' || new.order_number)
    returning id into v_sale;

    for it in select * from website_order_items where order_id = new.id loop
      if it.hamper_item_id is not null then
        select * into v_h from hamper_items where id = it.hamper_item_id;
        if not found then
          raise exception 'Hamper "%" no longer exists.', it.item_name;
        end if;
        insert into hamper_sales (hamper_id, hamper_name, sale_id, quantity, unit_price, unit_cost)
        values (v_h.id, v_h.name, v_sale, it.quantity, it.unit_price, hamper_unit_cost(v_h.id));
        insert into sales_items (sale_id, inventory_id, item_name, quantity, unit_price, total_price)
        values (v_sale, null, it.item_name, it.quantity, it.unit_price, it.total_price);
      elsif it.inventory_id is not null then
        select * into v_inv from inventory where id = it.inventory_id for update;
        if not found then
          raise exception '"%" no longer exists in inventory.', it.item_name;
        end if;
        if coalesce(v_inv.is_serialized, false) then
          -- one sale line per physical unit
          if (select count(*) from inventory_units where inventory_id = it.inventory_id and status = 'in_stock') < it.quantity then
            raise exception 'Not enough units in stock for "%".', it.item_name;
          end if;
          for u in select * from inventory_units where inventory_id = it.inventory_id and status = 'in_stock'
                   order by created_at limit it.quantity for update loop
            insert into sales_items (sale_id, inventory_id, item_name, quantity, unit_price, total_price, serial_no)
            values (v_sale, it.inventory_id, it.item_name, 1, it.unit_price, it.unit_price, coalesce(u.imei_1, u.serial_no))
            returning id into v_si;
            update inventory_units set status = 'sold', sale_item_id = v_si, customer_id = v_cust, sold_at = now() where id = u.id;
            insert into imei_history (stock_unit_id, imei_1, imei_2, event_type, reference_type, reference_id, from_status, to_status, customer_id)
            values (u.id, u.imei_1, u.imei_2, 'sale', 'sale', 'WEB-' || new.order_number, 'in_stock', 'sold', v_cust);
          end loop;
        else
          insert into sales_items (sale_id, inventory_id, item_name, quantity, unit_price, total_price)
          values (v_sale, it.inventory_id, it.item_name, it.quantity, it.unit_price, it.total_price);
          update inventory set stock = coalesce(stock, 0) - it.quantity where id = it.inventory_id;
        end if;
      else
        raise exception 'Order line "%" is not linked to a product.', it.item_name;
      end if;
    end loop;

    update website_orders set sale_id = v_sale where id = new.id;

  -- Moved away from delivered (e.g. cancelled after delivery): undo the sale
  elsif old.order_status = 'delivered' and new.order_status is distinct from 'delivered' and new.sale_id is not null then
    for li in
      select si.id, si.inventory_id, si.quantity, i.is_serialized
      from sales_items si left join inventory i on i.id = si.inventory_id
      where si.sale_id = new.sale_id and si.inventory_id is not null
    loop
      if coalesce(li.is_serialized, false) then
        update inventory_units set status = 'in_stock', sale_item_id = null, customer_id = null, sold_at = null where sale_item_id = li.id;
      else
        update inventory set stock = coalesce(stock, 0) + li.quantity where id = li.inventory_id;
      end if;
    end loop;
    delete from sales where id = new.sale_id;  -- cascades lines; hamper reversal trigger restores hamper components
    update website_orders set sale_id = null where id = new.id;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_website_order_fulfil on public.website_orders;
create trigger trg_website_order_fulfil after update of order_status on public.website_orders
  for each row when (new.order_status is distinct from old.order_status)
  execute function public.website_order_fulfil();

-- ----------------------------------------------------------------------------
-- 4. IMEI return reverses the sale line
-- ----------------------------------------------------------------------------
create or replace function public.imei_return_reverse_sale()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  li record;
begin
  select * into li from sales_items where id = old.sale_item_id;
  if not found then
    return new;
  end if;
  update inventory_units set sale_item_id = null where id = new.id;
  delete from sales_items where id = li.id;
  update sales
  set total_amount = greatest(0, total_amount - li.total_price),
      final_amount = greatest(0, final_amount - li.total_price),
      notes = trim(coalesce(notes, '') || ' [Returned: ' || li.item_name || ' ' || coalesce(li.serial_no, '') || ' on ' || to_char(now(), 'YYYY-MM-DD') || ']')
  where id = li.sale_id;
  begin
    update finance_transactions set status = 'cancelled', notes = trim(coalesce(notes, '') || ' Device returned.')
    where stock_unit_id = new.id and status = 'draft';
  exception when others then null;
  end;
  return new;
end;
$$;
drop trigger if exists trg_imei_return_reverse_sale on public.inventory_units;
create trigger trg_imei_return_reverse_sale after update of status on public.inventory_units
  for each row when (old.status = 'sold' and new.status = 'returned' and old.sale_item_id is not null)
  execute function public.imei_return_reverse_sale();

-- ----------------------------------------------------------------------------
-- 5. Staff fixes
-- ----------------------------------------------------------------------------
alter table public.customers add column if not exists notes text;
-- (reviews is publicly readable, so the reviewer's phone number is deliberately NOT stored there)

create or replace function public.staff_submit_review(p_token uuid, p_customer_name text, p_phone text, p_rating integer, p_comment text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff_id uuid := resolve_staff_session(p_token);
  v_id uuid;
begin
  if p_rating < 1 or p_rating > 5 then
    raise exception 'Rating must be between 1 and 5';
  end if;

  insert into reviews (customer_name, rating, review_text, source)
  values (p_customer_name, p_rating, p_comment, 'in_store')
  returning id into v_id;

  insert into staff_activity_log (staff_id, action, details)
  values (v_staff_id, 'review_submitted', json_build_object('review_id', v_id));

  return json_build_object('success', true, 'review_id', v_id);
end;
$$;
grant execute on function public.staff_submit_review(uuid, text, text, integer, text) to anon, authenticated;

create or replace function public.staff_reschedule_followup(p_token uuid, p_follow_up_id uuid, p_new_date date, p_notes text default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff_id uuid := resolve_staff_session(p_token);
begin
  if p_new_date is null or p_new_date < current_date then
    return json_build_object('success', false, 'error', 'Pick today or a future date.');
  end if;
  update follow_ups
  set follow_up_date = p_new_date, status = 'pending', notes = coalesce(p_notes, notes), updated_at = now()
  where id = p_follow_up_id and staff_id = v_staff_id;
  if not found then
    return json_build_object('success', false, 'error', 'Follow-up not found.');
  end if;
  insert into staff_activity_log (staff_id, action, details)
  values (v_staff_id, 'follow_up_updated', json_build_object('follow_up_id', p_follow_up_id, 'status', 'rescheduled', 'new_date', p_new_date));
  return json_build_object('success', true);
end;
$$;
grant execute on function public.staff_reschedule_followup(uuid, uuid, date, text) to anon, authenticated;

create or replace function public.leave_requests_validate()
returns trigger
language plpgsql
as $$
begin
  if new.end_date < new.start_date then
    raise exception 'Leave end date cannot be before the start date.';
  end if;
  if new.start_date < current_date - 30 then
    raise exception 'Leave cannot start more than 30 days in the past.';
  end if;
  if exists (
    select 1 from public.leave_requests l
    where l.staff_id = new.staff_id and l.status in ('pending', 'approved')
      and l.id is distinct from new.id
      and l.start_date <= new.end_date and l.end_date >= new.start_date
  ) then
    raise exception 'You already have a leave request covering these dates.';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_leave_requests_validate on public.leave_requests;
create trigger trg_leave_requests_validate before insert on public.leave_requests
  for each row execute function public.leave_requests_validate();

-- ----------------------------------------------------------------------------
-- 6. finance-reports storage bucket (private; admins read via signed URL,
--    staff upload only)
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
select 'finance-reports', 'finance-reports', false
where not exists (select 1 from storage.buckets where id = 'finance-reports');

drop policy if exists "finance_reports_staff_upload" on storage.objects;
create policy "finance_reports_staff_upload" on storage.objects for insert
  to anon, authenticated with check (bucket_id = 'finance-reports');

drop policy if exists "finance_reports_admin_all" on storage.objects;
create policy "finance_reports_admin_all" on storage.objects for all
  to authenticated
  using (bucket_id = 'finance-reports' and is_admin())
  with check (bucket_id = 'finance-reports' and is_admin());
