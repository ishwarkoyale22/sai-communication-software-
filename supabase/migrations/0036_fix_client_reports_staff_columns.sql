-- ============================================================================
-- 0036_fix_client_reports_staff_columns.sql
--
-- Bug fix: the Staff Portal's "Client Reports" upload (staff_submit_client_report,
-- in migrations_admin_integration_DRAFT/0012) inserts into
-- client_reports (customer_id, staff_id, title, notes, file_url, status) —
-- but the live client_reports table was only ever created with the older
-- (customer_id, report_type, report_data, notes, ...) shape plus the
-- review-workflow columns (status, admin_feedback, updated_at). staff_id,
-- title and file_url were never actually added, so every staff submission
-- failed with: column "staff_id" of relation "client_reports" does not exist.
--
-- This adds exactly the three missing columns. Nothing existing is touched —
-- report_type/report_data stay as-is for the Admin Portal's older manual
-- "Add Report" flow.
-- ============================================================================

alter table public.client_reports add column if not exists staff_id uuid references public.staff (id);
alter table public.client_reports add column if not exists title text;
alter table public.client_reports add column if not exists file_url text;

create index if not exists idx_client_reports_staff on public.client_reports (staff_id, created_at desc);
