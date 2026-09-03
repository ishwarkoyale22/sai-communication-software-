-- ============================================================================
-- 0016_grant_staff_portal_tables.sql
-- Fixes: Admin Portal's "Staff Portal Oversight" page (attendance / leave /
-- tasks tabs) always showed empty, even when staff had clocked in and the
-- data existed, and the browser console showed 403 (permission denied) on
-- every direct read of these tables from the admin app.
--
-- Root cause: attendance, leave_requests, staff_tasks and
-- staff_activity_log had RLS enabled with a correct "admin can do
-- everything" policy (`using (is_admin())`), but were never GRANTed to the
-- `authenticated` Postgres role in the first place. Postgres checks
-- table-level GRANTs before RLS policies are ever evaluated, so every
-- request from the admin's authenticated session was rejected outright
-- with 42501 "permission denied for table ..." — RLS never even got a
-- chance to run. Staff PIN actions (clock in/out, leave requests, etc.)
-- were unaffected because those go through SECURITY DEFINER RPCs, which
-- run as the function owner and bypass grants entirely — masking the bug
-- for staff while leaving admin's direct table reads/writes broken.
-- ============================================================================

grant select, insert, update, delete on public.attendance to authenticated;
grant select, insert, update, delete on public.leave_requests to authenticated;
grant select, insert, update, delete on public.staff_tasks to authenticated;
grant select on public.staff_activity_log to authenticated;
