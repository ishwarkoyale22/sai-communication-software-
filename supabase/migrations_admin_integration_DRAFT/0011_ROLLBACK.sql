-- ============================================================================
-- 0011_ROLLBACK.sql — cleans up any objects left behind by a partial/failed
-- run of 0011_staff_portal_full.sql, so it can be re-applied from scratch.
--
-- Genuinely safe to run in any state, including "nothing from 0011 exists
-- at all": every DROP POLICY/TRIGGER below is guarded by a to_regclass()
-- check on its target table first, because `DROP POLICY IF EXISTS "x" ON t`
-- still throws `relation "t" does not exist` when t is missing — the
-- IF EXISTS there only covers the policy name, not the table. DROP
-- FUNCTION/TABLE IF EXISTS do not have that problem (no table lookup
-- required), so those are left as plain statements.
-- ============================================================================

do $$
begin
  if to_regclass('public.attendance') is not null then
    execute 'drop policy if exists "admin_all_attendance" on attendance';
  end if;

  if to_regclass('public.leave_requests') is not null then
    execute 'drop policy if exists "admin_all_leave_requests" on leave_requests';
  end if;

  if to_regclass('public.staff_tasks') is not null then
    execute 'drop policy if exists "admin_all_staff_tasks" on staff_tasks';
  end if;

  if to_regclass('public.staff_activity_log') is not null then
    execute 'drop policy if exists "admin_read_staff_activity_log" on staff_activity_log';
  end if;

  -- storage.objects always exists (it's a core Supabase Storage table), so
  -- these are safe without a guard — but kept consistent for clarity.
  if to_regclass('storage.objects') is not null then
    execute 'drop policy if exists "admin_read_client_report_files" on storage.objects';
    execute 'drop policy if exists "anyone_upload_client_report_files" on storage.objects';
    execute 'drop policy if exists "admin_manage_client_report_files" on storage.objects';
  end if;
end $$;

-- DROP FUNCTION IF EXISTS never needs the table to exist (only the
-- argument types, which are built-in: uuid/text/date/numeric/int/jsonb),
-- so these are safe as plain statements regardless of what tables exist.
drop function if exists staff_get_activity(uuid);
drop function if exists staff_submit_client_report(uuid, uuid, text, jsonb, text);
drop function if exists staff_submit_client_report(uuid, uuid, text, text, text);
drop function if exists staff_submit_review(uuid, text, text, int, text);
drop function if exists staff_update_task_status(uuid, uuid, text);
drop function if exists staff_get_tasks(uuid);
drop function if exists staff_get_leave_requests(uuid);
drop function if exists staff_apply_leave(uuid, text, date, date, text);
drop function if exists staff_get_attendance(uuid);
drop function if exists staff_clock_out(uuid, numeric, numeric);
drop function if exists staff_clock_in(uuid, numeric, numeric);
drop function if exists issue_staff_session(text, text);
drop function if exists resolve_staff_session(uuid);

-- DROP TABLE IF EXISTS is always safe (no dependent-object lookup beyond
-- the table itself); CASCADE clears any leftover FK/index/trigger tied to
-- it, e.g. a half-applied trigger from a later migration attempt.
drop table if exists staff_sessions cascade;
drop table if exists staff_activity_log cascade;
drop table if exists staff_tasks cascade;
drop table if exists leave_requests cascade;
drop table if exists attendance cascade;

-- Note: this does NOT touch the 'client-reports' storage bucket itself
-- (storage.buckets row) since dropping it would delete any files already
-- uploaded to it. If you need it gone too, run separately once you've
-- confirmed nothing was uploaded there yet:
--   delete from storage.buckets where id = 'client-reports';
