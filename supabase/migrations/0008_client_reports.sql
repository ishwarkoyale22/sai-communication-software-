-- ============================================================================
-- 0008_client_reports.sql
-- Staff can create a report for a specific client and attach a file; Admin
-- can view every submitted report (client requirement #3).
-- Follows the existing wholesaler-invoices pattern: a private Storage bucket
-- + a table row per submission. Create the bucket manually the same way
-- (see README) — bucket creation itself stays a manual dashboard step to
-- match how wholesaler-invoices was set up; this migration only adds the
-- table, RLS, and the matching storage.objects policies.
-- ============================================================================

create table if not exists client_reports (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers (id) on delete cascade,
  staff_id uuid not null references staff (id),
  title text not null,
  notes text,
  file_url text, -- Supabase Storage path in the 'client-reports' bucket
  created_at timestamptz not null default now()
);

create index if not exists idx_client_reports_customer on client_reports (customer_id, created_at desc);
create index if not exists idx_client_reports_staff on client_reports (staff_id, created_at desc);

alter table client_reports enable row level security;

drop policy if exists "admin_all_client_reports" on client_reports;
create policy "admin_all_client_reports" on client_reports for all using (is_admin()) with check (is_admin());

drop policy if exists "staff_insert_client_reports" on client_reports;
create policy "staff_insert_client_reports" on client_reports for insert
  with check (is_staff() and staff_id = current_staff_id());

drop policy if exists "staff_read_own_client_reports" on client_reports;
create policy "staff_read_own_client_reports" on client_reports for select
  using (is_staff() and staff_id = current_staff_id());

-- ----------------------------------------------------------------------------
-- Storage: 'client-reports' bucket — create it manually in the dashboard
-- (Storage → New bucket → name "client-reports", private), same as the
-- existing 'wholesaler-invoices' bucket. These policies then govern it.
-- ----------------------------------------------------------------------------
drop policy if exists "admin_all_client_report_files" on storage.objects;
create policy "admin_all_client_report_files" on storage.objects for all
  to authenticated
  using (bucket_id = 'client-reports' and is_admin())
  with check (bucket_id = 'client-reports' and is_admin());

drop policy if exists "staff_insert_client_report_files" on storage.objects;
create policy "staff_insert_client_report_files" on storage.objects for insert
  to authenticated
  with check (bucket_id = 'client-reports' and is_staff());

drop policy if exists "staff_read_client_report_files" on storage.objects;
create policy "staff_read_client_report_files" on storage.objects for select
  to authenticated
  using (bucket_id = 'client-reports' and is_staff());
