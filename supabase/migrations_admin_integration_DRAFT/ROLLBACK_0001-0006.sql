-- ============================================================================
-- ROLLBACK_0001-0006.sql  (DRAFT — for review, NOT executed)
--
-- Reverts everything created by 0001_admin_auth_and_staff.sql through
-- 0006_web_order_stock_sync.sql, and NOTHING else.
--
-- Scope guarantee:
--   - Every DROP TABLE below targets a table that 0001-0006 CREATED. None
--     of them are website tables (products, customers, enquiries, orders,
--     order_items, brands, settings, repair_enquiries, suppliers,
--     finance_partners, refurbished_products, gift_hamper_products,
--     third_party_sources, etc.) — those are never dropped, renamed, or
--     truncated by this script.
--   - The only changes to EXISTING website tables are DROP COLUMN
--     statements for the exact columns 0002/0006 added, and DROP POLICY
--     statements for the exact policies 0002/0003/0004/0005 added. No
--     existing column, existing policy, or any row is touched.
--
-- ⚠️  READ THE WARNINGS marked with ⚠️ before running any section.
-- ⚠️  Run the verification script's "AFTER" section once more after this
--     rollback completes, to confirm the website tables are exactly as
--     they were pre-migration.
-- ============================================================================


-- ############################################################################
-- SECTION 1: DROP TRIGGERS
-- (must happen before dropping the functions they call)
-- ############################################################################

-- from 0006 — on the EXISTING `orders` table (trigger only, table untouched)
drop trigger if exists trg_sync_stock_on_order_status_change on orders;

-- from 0004 — on the new `sale_items` table (moot once the table is
-- dropped in Section 3, listed here for completeness/explicitness)
drop trigger if exists trg_decrement_stock_on_sale on sale_items;
drop trigger if exists trg_restore_stock_on_sale_item_delete on sale_items;

-- from 0002 — on the EXISTING `enquiries` table (trigger only, table untouched)
-- ⚠️ Removing this trigger stops new website enquiries from being
--    auto-linked to a `customers` row. This only removes behavior 0002
--    added — the website never had this trigger before 0001-0006 was
--    applied, so this is a true revert, not a regression versus the
--    original live schema.
drop trigger if exists trg_link_enquiry_to_customer on enquiries;

-- from 0005 — on the EXISTING `repair_enquiries` table
-- (0005 did not add a trigger here — set_updated_at already existed on the
-- live table before 0001-0006; nothing to drop. Listed for completeness.)


-- ############################################################################
-- SECTION 2: DROP FUNCTIONS
-- ############################################################################

-- from 0006
drop function if exists sync_stock_on_order_status_change();

-- from 0005
drop function if exists process_wholesaler_invoice(uuid);

-- from 0004
drop function if exists adjust_refurbished_availability(uuid, boolean, text);
drop function if exists adjust_stock_manual(uuid, integer, text);
drop function if exists restore_stock_on_sale_item_delete();
drop function if exists decrement_stock_on_sale();

-- from 0002
drop function if exists link_enquiry_to_customer();

-- from 0001
-- ⚠️ Drop these LAST among functions — 0002/0003/0004/0005's policies call
--    is_admin()/is_staff()/current_staff_id(). By the time you reach this
--    point, Section 4 below will already have dropped every policy that
--    references them (on both new and existing tables), so this is safe
--    here. If you ever run this section out of order, dropping these
--    functions first will make every admin/staff RLS policy start failing
--    with "function does not exist" the next time it's evaluated.
drop function if exists current_staff_id();
drop function if exists is_staff();
drop function if exists is_admin();


-- ############################################################################
-- SECTION 3: DROP POLICIES that were added to EXISTING website tables
-- (policies on tables being dropped in Section 4 do not need to be listed
-- separately — DROP TABLE removes them automatically — but are listed
-- below too, for an explicit, auditable record of every policy 0001-0006
-- introduced.)
-- ############################################################################

-- -- Policies added to EXISTING tables (must be dropped explicitly; the
-- -- table itself is NOT dropped) --------------------------------------------

-- products (from 0002)
drop policy if exists "admin_write_products" on products;
drop policy if exists "staff_update_products_stock" on products;

-- customers (from 0002)
drop policy if exists "admin_all_customers" on customers;
drop policy if exists "staff_read_customers" on customers;
drop policy if exists "staff_insert_customers" on customers;

-- enquiries (from 0002)
drop policy if exists "admin_all_enquiries" on enquiries;
drop policy if exists "staff_read_enquiries" on enquiries;

-- brands (from 0003)
drop policy if exists "admin_all_brands" on brands;
drop policy if exists "staff_read_brands" on brands;

-- finance_partners (from 0004)
drop policy if exists "admin_all_finance_partners" on finance_partners;
drop policy if exists "staff_read_finance_partners" on finance_partners;

-- repair_enquiries (from 0005)
drop policy if exists "admin_all_repair_enquiries" on repair_enquiries;
drop policy if exists "staff_read_repair_enquiries" on repair_enquiries;

-- suppliers (from 0005)
drop policy if exists "admin_all_suppliers" on suppliers;
drop policy if exists "staff_read_suppliers" on suppliers;

-- ⚠️ IMPORTANT: none of the website's ORIGINAL policies (e.g. "Products are
--    publicly viewable", "Anyone can submit an enquiry", public SELECT on
--    brands/settings/gift_hamper_products/refurbished_products, etc.) are
--    listed above and NONE of them are dropped by this script. Only the
--    admin/staff policies 0001-0006 added are removed. The website's
--    public read/insert access is restored to exactly its pre-migration
--    state automatically once these are gone (nothing else was changed).


-- -- Policies on NEW tables (informational only — auto-removed by Section
-- -- 4's DROP TABLE; listed for a complete audit trail) ----------------------
-- profiles: self_read_profile, admin_all_profiles
-- staff: admin_all_staff, staff_read_own_row
-- categories: admin_all_categories, staff_read_categories, public_read_active_categories
-- services: admin_all_services, staff_read_services, public_read_active_services
-- sales: admin_all_sales, staff_manage_own_sales
-- sale_items: admin_all_sale_items, staff_manage_own_sale_items
-- stock_movements: admin_all_stock_movements, staff_read_stock_movements
-- repairs: admin_all_repairs, staff_manage_assigned_repairs
-- client_reports: admin_all_client_reports, staff_insert_client_reports, staff_read_own_client_reports
-- reviews: public_insert_reviews, public_read_approved_reviews, admin_all_reviews
-- third_party_purchases: admin_all_third_party_purchases
-- wholesaler_invoices: admin_all_wholesaler_invoices
-- invoice_items: admin_all_invoice_items


-- ############################################################################
-- SECTION 4: DROP TABLES
-- (only tables 0001-0006 CREATED. Dropped in dependency-safe order — a
-- table with a foreign key pointing at another new table is dropped first.)
-- ⚠️ THIS PERMANENTLY DELETES ANY DATA entered into these tables since
--    0001-0006 was applied — e.g. staff logins, in-store sales history,
--    stock movement audit log, repair work-orders, client reports,
--    customer reviews, wholesaler invoices, vendor purchase records. If
--    any real business data has been entered into the admin/staff
--    software by the time you consider running this, back that up first
--    (e.g. `select * from sales`, `select * from repairs`, etc.) — this
--    rollback does not preserve it.
-- ############################################################################

drop table if exists invoice_items;
drop table if exists wholesaler_invoices;
drop table if exists third_party_purchases;
drop table if exists reviews;
drop table if exists client_reports;
drop table if exists repairs;

drop table if exists stock_movements;
drop table if exists sale_items;
drop table if exists sales;

drop table if exists services;
drop table if exists categories;

drop table if exists staff;
drop table if exists profiles;

-- ⚠️ None of these DROP TABLE statements can affect `orders`, `order_items`,
--    `products`, `customers`, `enquiries`, `brands`, `settings`,
--    `repair_enquiries`, `suppliers`, `finance_partners`,
--    `refurbished_products`, `gift_hamper_products`, `third_party_sources`
--    — those names do not appear above. `finance_partners` and `suppliers`
--    in particular were REUSED, not created, by 0004/0005 — they are
--    correctly absent from this DROP TABLE list.


-- ############################################################################
-- SECTION 5: DROP COLUMNS added to EXISTING website tables
-- ⚠️ THIS PERMANENTLY DELETES ANY DATA entered into these specific columns
--    since 0001-0006 was applied (e.g. a SKU or barcode typed into the
--    admin Inventory page, a customer's birthday/GST number/notes, a
--    manual stock adjustment history via orders.stock_deducted_at). It
--    does NOT touch any other column or any row's existence in these
--    tables — `products`, `customers`, `enquiries`, `orders` keep every
--    row and every pre-existing column exactly as they were.
-- ############################################################################

-- products (from 0002) — drop the unique constraints/index first, then columns
alter table products drop constraint if exists products_sku_key;
alter table products drop constraint if exists products_barcode_key;
drop index if exists idx_products_stock_qty;

alter table products
  drop column if exists sku,
  drop column if exists purchase_price,
  drop column if exists min_stock_alert,
  drop column if exists barcode,
  drop column if exists buyer_code,
  drop column if exists model,
  drop column if exists serial_number,
  drop column if exists created_by,
  drop column if exists updated_by;

-- customers (from 0002)
alter table customers
  drop column if exists birthday,
  drop column if exists gst_number,
  drop column if exists notes,
  drop column if exists created_by;

-- enquiries (from 0002)
-- ⚠️ If `trg_link_enquiry_to_customer` (dropped in Section 1) had already
--    populated customer_id on some enquiry rows, that linkage is
--    permanently discarded by this column drop, though the linked
--    `customers` rows themselves are untouched (customers is never
--    dropped from, only this FK column on enquiries is removed).
alter table enquiries
  drop column if exists customer_id;

-- orders (from 0006)
-- ⚠️ CRITICAL: dropping this column does NOT undo any stock_qty changes
--    or refurbished_products.is_available flips that the trigger already
--    made while it was active. If any orders were confirmed/cancelled
--    between applying 0006 and running this rollback, `products.stock_qty`
--    and/or `refurbished_products.is_available` will remain at whatever
--    the trigger last set them to — this rollback only removes the
--    schema/mechanism, not the effects it already had. Reconcile stock
--    manually (or from the stock_movements audit log, before it's dropped
--    in Section 4) if that matters to you before proceeding.
alter table orders
  drop column if exists stock_deducted_at;


-- ############################################################################
-- Rollback complete. Run the "AFTER ROLLBACK" section of
-- VERIFY_BEFORE_AFTER.sql next to confirm the website tables match their
-- original pre-migration shape.
-- ############################################################################
