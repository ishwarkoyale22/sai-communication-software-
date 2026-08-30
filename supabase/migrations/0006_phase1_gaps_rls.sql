-- ============================================================================
-- 0006_phase1_gaps_rls.sql
-- RLS + Realtime for the tables added in 0005_phase1_gaps_schema.sql
-- ============================================================================

alter table categories enable row level security;
alter table suppliers enable row level security;
alter table stock_movements enable row level security;
alter table customer_notes enable row level security;
alter table settings enable row level security;

-- ----------------------------------------------------------------------------
-- categories: admin manages the list; staff + public (website filter) can read
-- ----------------------------------------------------------------------------
drop policy if exists "admin_all_categories" on categories;
create policy "admin_all_categories" on categories for all using (is_admin()) with check (is_admin());
drop policy if exists "staff_read_categories" on categories;
create policy "staff_read_categories" on categories for select using (is_staff());
drop policy if exists "public_read_active_categories" on categories;
create policy "public_read_active_categories" on categories for select
  to anon
  using (is_active = true);

-- ----------------------------------------------------------------------------
-- suppliers: admin only — staff have no purchase-entry access per §9
-- ----------------------------------------------------------------------------
drop policy if exists "admin_all_suppliers" on suppliers;
create policy "admin_all_suppliers" on suppliers for all using (is_admin()) with check (is_admin());

-- ----------------------------------------------------------------------------
-- stock_movements: written only via security-definer triggers/RPC (0005), so
-- no insert policy is needed for staff. Read-only visibility below.
-- ----------------------------------------------------------------------------
drop policy if exists "admin_all_stock_movements" on stock_movements;
create policy "admin_all_stock_movements" on stock_movements for select using (is_admin());
drop policy if exists "staff_read_stock_movements" on stock_movements;
create policy "staff_read_stock_movements" on stock_movements for select using (is_staff());

-- ----------------------------------------------------------------------------
-- customer_notes: staff can add notes but never edit/delete admin-visible
-- history (§13); admin has full access.
-- ----------------------------------------------------------------------------
drop policy if exists "admin_all_customer_notes" on customer_notes;
create policy "admin_all_customer_notes" on customer_notes for all using (is_admin()) with check (is_admin());
drop policy if exists "staff_insert_customer_notes" on customer_notes;
create policy "staff_insert_customer_notes" on customer_notes for insert
  with check (is_staff() and staff_id = current_staff_id());
drop policy if exists "staff_read_customer_notes" on customer_notes;
create policy "staff_read_customer_notes" on customer_notes for select using (is_staff());

-- ----------------------------------------------------------------------------
-- settings: admin manages; staff can read (needed for invoice header/GSTIN
-- at billing time); no anon access.
-- ----------------------------------------------------------------------------
drop policy if exists "admin_all_settings" on settings;
create policy "admin_all_settings" on settings for all using (is_admin()) with check (is_admin());
drop policy if exists "staff_read_settings" on settings;
create policy "staff_read_settings" on settings for select using (is_staff());

-- ----------------------------------------------------------------------------
-- Realtime: website catalog also filters by category, and Admin's enquiry
-- inbox should update live when a new enquiry lands (Flow C, §14/§15).
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'categories'
  ) then
    alter publication supabase_realtime add table categories;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'enquiries'
  ) then
    alter publication supabase_realtime add table enquiries;
  end if;
end $$;
