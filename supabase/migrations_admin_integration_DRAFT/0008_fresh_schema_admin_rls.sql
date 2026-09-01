-- ============================================================================
-- 0008_fresh_schema_admin_rls.sql  (for the NEW fresh schema — inventory,
-- hamper_items, website_orders, etc.)
--
-- The new schema only has public SELECT/INSERT policies (auto-generated).
-- No admin write access exists anywhere yet. This adds admin_all_* policies
-- (is_admin() gated, same pattern used successfully all session) so the
-- admin app can actually create/update/delete records. Additive only —
-- does not touch existing public policies, does not drop/rename anything.
-- ============================================================================

alter table inventory enable row level security;
alter table hamper_items enable row level security;
alter table gallery enable row level security;
alter table offers enable row level security;
alter table customers enable row level security;
alter table staff enable row level security;
alter table reviews enable row level security;
alter table client_reports enable row level security;
alter table sales enable row level security;
alter table sales_items enable row level security;
alter table repair_enquiries enable row level security;
alter table repairs enable row level security;
alter table wholesaler_invoices enable row level security;
alter table third_party_purchases enable row level security;
alter table services enable row level security;
alter table emi_finance enable row level security;
alter table website_orders enable row level security;
alter table website_order_items enable row level security;
alter table brands enable row level security;
alter table enquiries enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'inventory','hamper_items','gallery','offers','customers','staff',
    'reviews','client_reports','sales','sales_items','repair_enquiries',
    'repairs','wholesaler_invoices','third_party_purchases','services',
    'emi_finance','website_orders','website_order_items','brands','enquiries'
  ]
  loop
    execute format('drop policy if exists "admin_all_%1$s" on %1$I', t);
    execute format('create policy "admin_all_%1$s" on %1$I for all using (is_admin()) with check (is_admin())', t);
  end loop;
end $$;

-- Staff also needs read access to the operational tables they use day to
-- day (billing, repairs, inventory) — narrower than admin's full access.
create policy "staff_read_inventory" on inventory for select using (is_staff());
create policy "staff_read_customers" on customers for select using (is_staff());
create policy "staff_insert_sales" on sales for all using (is_staff()) with check (is_staff());
create policy "staff_insert_sales_items" on sales_items for all using (is_staff()) with check (is_staff());
create policy "staff_manage_repairs" on repairs for all using (is_staff()) with check (is_staff());
create policy "staff_read_repair_enquiries" on repair_enquiries for select using (is_staff());
create policy "staff_read_website_orders" on website_orders for select using (is_staff());
create policy "staff_read_website_order_items" on website_order_items for select using (is_staff());

-- Realtime: new order / new repair request alerts + stock sync, per request.
alter publication supabase_realtime add table website_orders;
alter publication supabase_realtime add table repair_enquiries;
alter publication supabase_realtime add table inventory;
