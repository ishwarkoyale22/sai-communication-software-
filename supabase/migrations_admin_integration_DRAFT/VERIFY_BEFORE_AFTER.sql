-- ============================================================================
-- VERIFY_BEFORE_AFTER.sql  (DRAFT — for review, NOT executed)
--
-- Read-only. No INSERT/UPDATE/DELETE/DDL anywhere in this file — safe to
-- run at any time, as many times as you like, against the live database.
--
-- Usage:
--   1. Run the whole file BEFORE applying 0001-0006. Save the output
--      (copy it somewhere, or screenshot the SQL Editor results).
--   2. Apply 0001-0006.
--   3. Run the whole file again AFTER. Compare against the saved output.
--   4. If you ever run ROLLBACK_0001-0006.sql, run this file a third time
--      and compare against the ORIGINAL "before" output — section A and B
--      should match the original exactly again; sections C/D/E naturally
--      won't (the new tables/columns/policies are gone, as expected).
-- ============================================================================


-- ############################################################################
-- SECTION A: Row counts of EXISTING website tables — must be IDENTICAL
-- before and after 0001-0006 (these migrations never insert, update, or
-- delete a single row in any of these tables; they only add columns/
-- policies/triggers around them, and 0003 seeding into `categories` reads
-- from `products.category` without writing back to `products`).
-- ############################################################################

select 'products' as table_name, count(*) as row_count from products
union all select 'customers', count(*) from customers
union all select 'enquiries', count(*) from enquiries
union all select 'orders', count(*) from orders
union all select 'order_items', count(*) from order_items
union all select 'payments', count(*) from payments
union all select 'brands', count(*) from brands
union all select 'settings', count(*) from settings
union all select 'repair_enquiries', count(*) from repair_enquiries
union all select 'suppliers', count(*) from suppliers
union all select 'finance_partners', count(*) from finance_partners
union all select 'refurbished_products', count(*) from refurbished_products
union all select 'gift_hamper_products', count(*) from gift_hamper_products
union all select 'third_party_sources', count(*) from third_party_sources
union all select 'branches', count(*) from branches
union all select 'gallery_items', count(*) from gallery_items
union all select 'promotional_popups', count(*) from promotional_popups
order by table_name;


-- ############################################################################
-- SECTION B: Spot-check that actual VALUES in existing rows are byte-for-
-- byte unchanged (not just row counts). Uses an md5 hash of every column
-- on the products table concatenated per row, sorted by id, hashed
-- overall — if this single hash matches before/after, no existing product
-- row's data changed in any way (only new nullable columns, which are all
-- NULL and thus don't appear in the pre-migration column set being
-- hashed here — this query is safe to run both before AND after 0002
-- because it only ever selects the ORIGINAL column set, which never
-- changes shape).
-- ############################################################################

select md5(string_agg(
  coalesce(id::text,'') || '|' || coalesce(name,'') || '|' || coalesce(brand,'') || '|' ||
  coalesce(category,'') || '|' || coalesce(price::text,'') || '|' || coalesce(original_price::text,'') || '|' ||
  coalesce(stock_status,'') || '|' || coalesce(stock_qty::text,'') || '|' || coalesce(description,'') || '|' ||
  coalesce(specs::text,'') || '|' || coalesce(images::text,'') || '|' || coalesce(is_featured::text,'') || '|' ||
  coalesce(created_at::text,'') || '|' || coalesce(finance_available::text,'') || '|' || coalesce(warranty,'') || '|' ||
  coalesce(colors::text,'') || '|' || coalesce(updated_at::text,''),
  ',' order by id
)) as products_original_columns_hash
from products;

select md5(string_agg(coalesce(key,'') || '|' || coalesce(value::text,''), ',' order by key)) as settings_hash
from settings;

select md5(string_agg(coalesce(id::text,'') || '|' || coalesce(name,'') || '|' || coalesce(logo_url,'') || '|' ||
  coalesce(display_order::text,'') || '|' || coalesce(is_active::text,''), ',' order by id)) as brands_hash
from brands;


-- ############################################################################
-- SECTION C: Column inventory of the 4 tables 0002/0006 add columns to.
-- BEFORE: confirm the baseline column list. AFTER: confirm every original
-- column is still present (nothing removed) and only the expected new
-- columns were appended.
-- ############################################################################

select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in ('products', 'customers', 'enquiries', 'orders')
order by table_name, ordinal_position;


-- ############################################################################
-- SECTION D: Existence check for tables 0001-0006 CREATE. Run AFTER only
-- (these won't exist in the "before" run — that's expected and correct).
-- All 12 should return one row each after applying 0001-0006.
-- ############################################################################

select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'profiles', 'staff', 'categories', 'services', 'sales', 'sale_items',
    'stock_movements', 'repairs', 'client_reports', 'reviews',
    'third_party_purchases', 'wholesaler_invoices', 'invoice_items'
  )
order by table_name;


-- ############################################################################
-- SECTION E: RLS policy inventory across every table 0001-0006 touches
-- (created or added policies to). Run BEFORE to capture the baseline
-- (only the original website policies will show for the existing-table
-- rows; the new-table rows simply won't exist yet). Run AFTER to confirm
-- the expected admin/staff policies are present AND the original
-- website policies (e.g. "Products are publicly viewable", "Anyone can
-- submit an enquiry") are still listed, untouched.
-- ############################################################################

select schemaname, tablename, policyname, cmd, roles
from pg_policies
where schemaname = 'public'
  and tablename in (
    'products', 'customers', 'enquiries', 'orders', 'order_items',
    'brands', 'settings', 'repair_enquiries', 'suppliers', 'finance_partners',
    'profiles', 'staff', 'categories', 'services', 'sales', 'sale_items',
    'stock_movements', 'repairs', 'client_reports', 'reviews',
    'third_party_purchases', 'wholesaler_invoices', 'invoice_items'
  )
order by tablename, policyname;


-- ############################################################################
-- SECTION F: Trigger inventory on tables 0002/0004/0006 attach triggers to.
-- BEFORE: `enquiries` and `orders` should show only whatever trigger(s)
-- already existed live (e.g. repair_enquiries' set_updated_at is on a
-- different table and won't appear here). AFTER: confirm the expected new
-- triggers exist, and that no OTHER trigger on these tables was removed.
-- ############################################################################

select event_object_table as table_name, trigger_name, action_timing, event_manipulation
from information_schema.triggers
where trigger_schema = 'public'
  and event_object_table in ('enquiries', 'orders', 'sale_items')
order by table_name, trigger_name;


-- ############################################################################
-- SECTION G: Function inventory — confirms exactly which functions
-- 0001-0006 introduced exist (AFTER), and none existed with these exact
-- names before (BEFORE — should return zero rows, since none of these
-- names collide with anything the live website schema already defined,
-- e.g. `set_updated_at` used by repair_enquiries is intentionally NOT in
-- this list).
-- ############################################################################

select routine_name
from information_schema.routines
where routine_schema = 'public'
  and routine_name in (
    'is_admin', 'is_staff', 'current_staff_id', 'link_enquiry_to_customer',
    'decrement_stock_on_sale', 'restore_stock_on_sale_item_delete',
    'adjust_stock_manual', 'adjust_refurbished_availability',
    'process_wholesaler_invoice', 'sync_stock_on_order_status_change'
  )
order by routine_name;
