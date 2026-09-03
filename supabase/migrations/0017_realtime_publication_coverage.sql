-- ============================================================================
-- 0017_realtime_publication_coverage.sql
-- Fixes: data added anywhere in the Admin Portal (new products, sales,
-- staff, attendance, reviews, etc.) did not show up on other open pages/
-- tabs until the page was manually reloaded — "the data isn't visible
-- quickly, it takes time."
--
-- Root cause: almost every admin page subscribes to live changes with
-- `supabase.channel(...).on("postgres_changes", { table: "..." }, load)`,
-- but a Postgres logical-replication publication only streams change
-- events for the tables explicitly added to it. Only inventory,
-- repair_enquiries and website_orders had ever been added to the
-- `supabase_realtime` publication — every other table's subscription was
-- silently inert (no error, it just never fires), so those pages only
-- ever refreshed on a full remount (navigate away and back, or reload).
-- ============================================================================

alter publication supabase_realtime add table
  public.brands,
  public.client_reports,
  public.sales,
  public.emi_finance,
  public.enquiries,
  public.hamper_items,
  public.repairs,
  public.reviews,
  public.services,
  public.staff,
  public.website_order_items,
  public.wholesaler_invoices,
  public.attendance,
  public.leave_requests,
  public.staff_tasks,
  public.customers,
  public.third_party_purchases;
