-- ============================================================================
-- 0045_security_lockdown.sql
--
-- Closes the holes found in the security review (verified with rolled-back
-- probes against the live database):
--
--  A. anon could INSERT into gift_sales / hamper_sales, whose triggers deduct
--     REAL stock; anon could also EXECUTE decrement_inventory_stock().
--  B. anon could read customers, repair_enquiries, website_orders(+items),
--     gift_sales, and UPDATE any column of any customer.
--  C. Policies written as auth.role() = 'authenticated' were open to every
--     self-signed-up website customer (sign-up is enabled): settings,
--     sales_targets, suppliers, gifts, finance_*, offers, branches ...
--  D. Cost columns (inventory.cost_price, gifts.cost_price,
--     hamper_items.packaging_cost, finance_partners.contact_notes) were
--     readable by anon.
--
-- Everything the public website and the staff portal legitimately need is
-- moved to narrow SECURITY DEFINER functions at the bottom of this file.
-- No table data is changed.
--
-- DEPLOY NOTE: the staff portal (RepairIntake, FinanceReports, ClientReports,
-- NewSale) and the customer website (checkout, order/repair tracking,
-- product queries) were updated in the same change to use these functions —
-- deploy those apps together with this migration.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A/B. Sales ledgers: admin only. Inserts happen through the admin app
--      (authenticated admin) or SECURITY DEFINER staff functions.
-- ----------------------------------------------------------------------------
drop policy if exists "gift_sales_select_all" on public.gift_sales;
drop policy if exists "gift_sales_insert_any" on public.gift_sales;
drop policy if exists "gift_sales_manage_authenticated" on public.gift_sales;
drop policy if exists "gift_sales_delete_authenticated" on public.gift_sales;
drop policy if exists "gift_sales_admin_all" on public.gift_sales;
create policy "gift_sales_admin_all" on public.gift_sales for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "hamper_sales_select_all" on public.hamper_sales;
drop policy if exists "hamper_sales_insert_any" on public.hamper_sales;
drop policy if exists "hamper_sales_delete_authenticated" on public.hamper_sales;
drop policy if exists "hamper_sales_admin_all" on public.hamper_sales;
create policy "hamper_sales_admin_all" on public.hamper_sales for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "hamper_sale_components_select_all" on public.hamper_sale_components;
drop policy if exists "hamper_sale_components_admin_all" on public.hamper_sale_components;
create policy "hamper_sale_components_admin_all" on public.hamper_sale_components for all using (public.is_admin()) with check (public.is_admin());

-- ----------------------------------------------------------------------------
-- B. Customer / order data
-- ----------------------------------------------------------------------------
drop policy if exists "anon can insert customers" on public.customers;
drop policy if exists "anon can select customers by phone" on public.customers;
drop policy if exists "anon can update customer birthday" on public.customers;

-- Visitors track by phone through web_track_* functions below (no open SELECT).
drop policy if exists "Repair enquiries viewable for tracking" on public.repair_enquiries;

-- Orders: a signed-in customer sees only their own (by account id, or by the
-- phone on their profile — the same rule the account page already applies).
drop policy if exists "Orders viewable for order tracking" on public.website_orders;
drop policy if exists "Customers read own orders" on public.website_orders;
create policy "Customers read own orders" on public.website_orders for select to authenticated
  using (
    customer_id = auth.uid()
    or customer_phone = (select cp.phone from public.customer_profiles cp where cp.id = auth.uid())
  );

drop policy if exists "Order items viewable for order tracking" on public.website_order_items;
drop policy if exists "Customers read own order items" on public.website_order_items;
create policy "Customers read own order items" on public.website_order_items for select to authenticated
  using (exists (select 1 from public.website_orders o where o.id = order_id));

-- ----------------------------------------------------------------------------
-- C. "authenticated" is not "staff": every website customer is authenticated.
-- ----------------------------------------------------------------------------
drop policy if exists "branches_authenticated_all" on public.branches;
drop policy if exists "branches_admin_all" on public.branches;
create policy "branches_admin_all" on public.branches for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "emi_finance_read_only" on public.emi_finance;

drop policy if exists "finance_partners_write_authenticated" on public.finance_partners;
drop policy if exists "finance_partners_admin_all" on public.finance_partners;
create policy "finance_partners_admin_all" on public.finance_partners for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "finance_reports_select_all" on public.finance_reports;
drop policy if exists "finance_reports_insert_any" on public.finance_reports;
drop policy if exists "finance_reports_manage_authenticated" on public.finance_reports;
drop policy if exists "finance_reports_delete_authenticated" on public.finance_reports;
drop policy if exists "finance_reports_admin_all" on public.finance_reports;
create policy "finance_reports_admin_all" on public.finance_reports for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin_all_finance_status_history" on public.finance_status_history;
create policy "admin_all_finance_status_history" on public.finance_status_history for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin_all_finance_transactions" on public.finance_transactions;
create policy "admin_all_finance_transactions" on public.finance_transactions for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "gifts_write_authenticated" on public.gifts;
drop policy if exists "gifts_admin_all" on public.gifts;
create policy "gifts_admin_all" on public.gifts for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "hamper_products_write_authenticated" on public.hamper_products;
drop policy if exists "hamper_products_admin_all" on public.hamper_products;
create policy "hamper_products_admin_all" on public.hamper_products for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "offer_products_write_authenticated" on public.offer_products;
drop policy if exists "offer_products_admin_all" on public.offer_products;
create policy "offer_products_admin_all" on public.offer_products for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "offers_write_authenticated" on public.offers;
drop policy if exists "offers_select_all" on public.offers;  -- exposed inactive/expired offers; "Active offers publicly viewable" stays

drop policy if exists "sales_targets_authenticated_all" on public.sales_targets;
drop policy if exists "sales_targets_admin_all" on public.sales_targets;
create policy "sales_targets_admin_all" on public.sales_targets for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "service_feedback_insert_authenticated" on public.service_feedback;
drop policy if exists "service_feedback_select_authenticated" on public.service_feedback;
drop policy if exists "service_feedback_admin_all" on public.service_feedback;
create policy "service_feedback_admin_all" on public.service_feedback for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "settings_write_authenticated" on public.settings;
drop policy if exists "settings_admin_all" on public.settings;
create policy "settings_admin_all" on public.settings for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "suppliers_authenticated_all" on public.suppliers;
drop policy if exists "suppliers_admin_all" on public.suppliers;
create policy "suppliers_admin_all" on public.suppliers for all using (public.is_admin()) with check (public.is_admin());

-- profiles: a user may read only their own row (the admin login reads it by id).
drop policy if exists "profiles_read" on public.profiles;
drop policy if exists "profiles_read_own" on public.profiles;
create policy "profiles_read_own" on public.profiles for select using (id = auth.uid());

-- finance-reports storage: only admin may replace/delete uploaded reports.
drop policy if exists "finance_report_files_manage" on storage.objects;
create policy "finance_report_files_manage" on storage.objects for update
  using (bucket_id = 'finance-reports' and public.is_admin())
  with check (bucket_id = 'finance-reports' and public.is_admin());
drop policy if exists "finance_report_files_delete" on storage.objects;
create policy "finance_report_files_delete" on storage.objects for delete
  using (bucket_id = 'finance-reports' and public.is_admin());

-- ----------------------------------------------------------------------------
-- D. Hide cost columns from the public (anon) role. authenticated keeps full
--    access (the admin app runs as authenticated + is_admin()).
--    NOTE: `select *` as anon now fails — callers must list columns.
-- ----------------------------------------------------------------------------
revoke select on public.inventory from anon;
grant select (id, name, brand_id, model, category, product_type, price, original_price, stock, images, specs,
              condition, grade, battery_health, warranty_months, is_featured, is_active, created_at, updated_at, is_serialized)
  on public.inventory to anon;

revoke select on public.gifts from anon;
grant select (id, name, price, stock, sold_qty, is_active, created_at) on public.gifts to anon;

revoke select on public.hamper_items from anon;
grant select (id, name, category, price, image, stock, is_active, created_at, offer_id) on public.hamper_items to anon;

revoke select on public.finance_partners from anon;
grant select (id, name, description, logo_url, min_amount, max_amount, available_tenures, processing_fee_pct,
              is_active, created_at, short_code, integration_type, updated_at)
  on public.finance_partners to anon;

-- ----------------------------------------------------------------------------
-- A. Functions that must not be callable by the public
-- ----------------------------------------------------------------------------
create or replace function public.decrement_inventory_stock(p_inventory_id uuid, p_qty integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Not allowed.';
  end if;
  update public.inventory set stock = greatest(0, coalesce(stock, 0) - p_qty) where id = p_inventory_id;
end;
$$;
revoke execute on function public.decrement_inventory_stock(uuid, integer) from public, anon;
grant execute on function public.decrement_inventory_stock(uuid, integer) to authenticated;

revoke execute on function public.check_due_followups() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Narrow functions replacing the direct table access that was removed
-- ----------------------------------------------------------------------------

-- Website checkout: remember a birthday for a phone number. Creates the
-- customer if new; for an existing customer it only FILLS a missing birthday,
-- so a stranger can no longer overwrite someone else's data.
create or replace function public.web_save_customer_birthday(
  p_name text, p_phone text, p_email text, p_address text, p_birthday date
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_phone is null or length(trim(p_phone)) < 6 or p_birthday is null then
    return;
  end if;
  select id into v_id from customers where phone = trim(p_phone) limit 1;
  if v_id is null then
    insert into customers (name, phone, email, address, birthday)
    values (coalesce(nullif(trim(p_name), ''), 'Website customer'), trim(p_phone), nullif(trim(p_email), ''), nullif(trim(p_address), ''), p_birthday);
  else
    update customers set birthday = p_birthday where id = v_id and birthday is null;
  end if;
end;
$$;

-- "Track my order" by phone number (same fields the page already showed).
create or replace function public.web_track_orders(p_phone text)
returns table (id uuid, order_number text, customer_name text, total_amount numeric, payment_status text, order_status text, created_at timestamp)
language sql
security definer
set search_path = public
as $$
  select o.id, o.order_number, o.customer_name, o.total_amount, o.payment_status, o.order_status, o.created_at
  from website_orders o
  where o.customer_phone = trim(p_phone) and length(trim(p_phone)) >= 6
  order by o.created_at desc
  limit 50;
$$;

create or replace function public.web_track_repair_enquiries(p_phone text)
returns table (id uuid, phone_brand text, phone_model text, problem_type text, status text, created_at timestamp)
language sql
security definer
set search_path = public
as $$
  select e.id, e.phone_brand, e.phone_model, e.problem_type, e.status, e.created_at
  from repair_enquiries e
  where e.phone = trim(p_phone) and length(trim(p_phone)) >= 6
  order by e.created_at desc
  limit 50;
$$;

grant execute on function public.web_save_customer_birthday(text, text, text, text, date) to anon, authenticated;
grant execute on function public.web_track_orders(text) to anon, authenticated;
grant execute on function public.web_track_repair_enquiries(text) to anon, authenticated;

-- Staff portal (anon + session token): finance reports
create or replace function public.staff_get_finance_reports(p_token uuid)
returns setof finance_reports
language plpgsql
security definer
set search_path = public
as $$
declare v_staff_id uuid := resolve_staff_session(p_token);
begin
  return query select * from finance_reports where staff_id = v_staff_id order by created_at desc limit 100;
end;
$$;

create or replace function public.staff_submit_finance_report(p_token uuid, p_title text, p_notes text, p_file_url text default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare v_staff_id uuid := resolve_staff_session(p_token); v_id uuid;
begin
  if p_title is null or length(trim(p_title)) = 0 then
    return json_build_object('success', false, 'error', 'Report name is required.');
  end if;
  insert into finance_reports (staff_id, title, notes, file_url)
  values (v_staff_id, trim(p_title), nullif(trim(p_notes), ''), nullif(p_file_url, ''))
  returning id into v_id;
  insert into staff_activity_log (staff_id, action, details) values (v_staff_id, 'finance_report_submitted', json_build_object('report_id', v_id));
  return json_build_object('success', true, 'id', v_id);
end;
$$;

-- Staff portal: repair intake (list + create). Creating fires the existing
-- repair-enquiry notification trigger.
create or replace function public.staff_get_repair_enquiries(p_token uuid)
returns setof repair_enquiries
language plpgsql
security definer
set search_path = public
as $$
declare v_staff_id uuid := resolve_staff_session(p_token);
begin
  return query select * from repair_enquiries order by created_at desc limit 100;
end;
$$;

create or replace function public.staff_create_repair_enquiry(
  p_token uuid, p_customer_name text, p_phone text, p_phone_brand text, p_phone_model text, p_problem_type text, p_description text
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare v_staff_id uuid := resolve_staff_session(p_token); v_id uuid;
begin
  if p_customer_name is null or length(trim(p_customer_name)) = 0 or p_phone is null or length(trim(p_phone)) = 0 then
    return json_build_object('success', false, 'error', 'Customer name and phone are required.');
  end if;
  insert into repair_enquiries (customer_name, phone, phone_brand, phone_model, problem_type, description, status)
  values (trim(p_customer_name), trim(p_phone), nullif(trim(p_phone_brand), ''), nullif(trim(p_phone_model), ''),
          nullif(trim(p_problem_type), ''), nullif(trim(p_description), ''), 'pending')
  returning id into v_id;
  insert into staff_activity_log (staff_id, action, details) values (v_staff_id, 'repair_intake', json_build_object('enquiry_id', v_id));
  return json_build_object('success', true, 'id', v_id);
end;
$$;

grant execute on function public.staff_get_finance_reports(uuid) to anon, authenticated;
grant execute on function public.staff_submit_finance_report(uuid, text, text, text) to anon, authenticated;
grant execute on function public.staff_get_repair_enquiries(uuid) to anon, authenticated;
grant execute on function public.staff_create_repair_enquiry(uuid, text, text, text, text, text, text) to anon, authenticated;
