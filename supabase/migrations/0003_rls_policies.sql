-- ============================================================================
-- 0003_rls_policies.sql
-- Row Level Security: admin = full access, staff = scoped, anon (public) = tiny
-- ============================================================================

alter table profiles enable row level security;
alter table staff enable row level security;
alter table customers enable row level security;
alter table finance_partners enable row level security;
alter table products enable row level security;
alter table sales enable row level security;
alter table sale_items enable row level security;
alter table repairs enable row level security;
alter table attendance enable row level security;
alter table wholesaler_invoices enable row level security;
alter table invoice_items enable row level security;
alter table third_party_purchases enable row level security;
alter table enquiries enable row level security;

-- ----------------------------------------------------------------------------
-- profiles: a user can read their own profile; admin can read all
-- ----------------------------------------------------------------------------
drop policy if exists "profiles_self_read" on profiles;
create policy "profiles_self_read" on profiles for select
  using (id = auth.uid() or is_admin());

-- ----------------------------------------------------------------------------
-- Generic "admin full access" policy, one per table
-- ----------------------------------------------------------------------------
drop policy if exists "admin_all_staff" on staff;
create policy "admin_all_staff" on staff for all using (is_admin()) with check (is_admin());
drop policy if exists "admin_all_customers" on customers;
create policy "admin_all_customers" on customers for all using (is_admin()) with check (is_admin());
drop policy if exists "admin_all_finance_partners" on finance_partners;
create policy "admin_all_finance_partners" on finance_partners for all using (is_admin()) with check (is_admin());
drop policy if exists "admin_all_products" on products;
create policy "admin_all_products" on products for all using (is_admin()) with check (is_admin());
drop policy if exists "admin_all_sales" on sales;
create policy "admin_all_sales" on sales for all using (is_admin()) with check (is_admin());
drop policy if exists "admin_all_sale_items" on sale_items;
create policy "admin_all_sale_items" on sale_items for all using (is_admin()) with check (is_admin());
drop policy if exists "admin_all_repairs" on repairs;
create policy "admin_all_repairs" on repairs for all using (is_admin()) with check (is_admin());
drop policy if exists "admin_all_attendance" on attendance;
create policy "admin_all_attendance" on attendance for all using (is_admin()) with check (is_admin());
drop policy if exists "admin_all_wholesaler_invoices" on wholesaler_invoices;
create policy "admin_all_wholesaler_invoices" on wholesaler_invoices for all using (is_admin()) with check (is_admin());
drop policy if exists "admin_all_invoice_items" on invoice_items;
create policy "admin_all_invoice_items" on invoice_items for all using (is_admin()) with check (is_admin());
drop policy if exists "admin_all_third_party_purchases" on third_party_purchases;
create policy "admin_all_third_party_purchases" on third_party_purchases for all using (is_admin()) with check (is_admin());
drop policy if exists "admin_all_enquiries" on enquiries;
create policy "admin_all_enquiries" on enquiries for all using (is_admin()) with check (is_admin());

-- ----------------------------------------------------------------------------
-- Staff policies (scoped)
-- ----------------------------------------------------------------------------

-- staff can read their own staff row + see co-worker names (for assign dropdowns)
drop policy if exists "staff_read_staff" on staff;
create policy "staff_read_staff" on staff for select using (is_staff());

-- staff: read all products, and update stock/price during billing/inventory count
drop policy if exists "staff_read_products" on products;
create policy "staff_read_products" on products for select using (is_staff());
drop policy if exists "staff_update_products" on products;
create policy "staff_update_products" on products for update using (is_staff()) with check (is_staff());

-- staff: read + create customers (lookup by phone / create new during billing)
drop policy if exists "staff_read_customers" on customers;
create policy "staff_read_customers" on customers for select using (is_staff());
drop policy if exists "staff_insert_customers" on customers;
create policy "staff_insert_customers" on customers for insert with check (is_staff());
drop policy if exists "staff_update_customers" on customers;
create policy "staff_update_customers" on customers for update using (is_staff()) with check (is_staff());

drop policy if exists "staff_read_finance_partners" on finance_partners;
create policy "staff_read_finance_partners" on finance_partners for select using (is_staff());

-- staff: create sales, but only see their own
drop policy if exists "staff_insert_sales" on sales;
create policy "staff_insert_sales" on sales for insert
  with check (is_staff() and staff_id = current_staff_id());
drop policy if exists "staff_read_own_sales" on sales;
create policy "staff_read_own_sales" on sales for select
  using (is_staff() and staff_id = current_staff_id());

drop policy if exists "staff_insert_sale_items" on sale_items;
create policy "staff_insert_sale_items" on sale_items for insert
  with check (
    is_staff() and exists (
      select 1 from sales s
      where s.id = sale_id and s.staff_id = current_staff_id()
    )
  );
drop policy if exists "staff_read_own_sale_items" on sale_items;
create policy "staff_read_own_sale_items" on sale_items for select
  using (
    is_staff() and exists (
      select 1 from sales s
      where s.id = sale_id and s.staff_id = current_staff_id()
    )
  );

-- staff: repairs assigned to them - read + status update
drop policy if exists "staff_read_assigned_repairs" on repairs;
create policy "staff_read_assigned_repairs" on repairs for select
  using (is_staff() and assigned_staff = current_staff_id());
drop policy if exists "staff_update_assigned_repairs" on repairs;
create policy "staff_update_assigned_repairs" on repairs for update
  using (is_staff() and assigned_staff = current_staff_id())
  with check (is_staff() and assigned_staff = current_staff_id());

-- staff: attendance - insert own clock-in/out, read own history
drop policy if exists "staff_insert_own_attendance" on attendance;
create policy "staff_insert_own_attendance" on attendance for insert
  with check (is_staff() and staff_id = current_staff_id());
drop policy if exists "staff_update_own_attendance" on attendance;
create policy "staff_update_own_attendance" on attendance for update
  using (is_staff() and staff_id = current_staff_id())
  with check (is_staff() and staff_id = current_staff_id());
drop policy if exists "staff_read_own_attendance" on attendance;
create policy "staff_read_own_attendance" on attendance for select
  using (is_staff() and staff_id = current_staff_id());

-- ----------------------------------------------------------------------------
-- Public (anon) policies
-- ----------------------------------------------------------------------------

-- anyone can view in-stock, active products (catalog)
drop policy if exists "public_read_in_stock_products" on products;
create policy "public_read_in_stock_products" on products for select
  to anon
  using (stock_qty > 0 and is_active = true);

-- anyone can submit an enquiry
drop policy if exists "public_insert_enquiries" on enquiries;
create policy "public_insert_enquiries" on enquiries for insert
  to anon
  with check (true);
