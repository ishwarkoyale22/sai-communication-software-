-- ============================================================================
-- 0038_notifications_table_grants.sql
--
-- Bug fix: `notifications` has RLS policy "admin_all_notifications" (using
-- is_admin()) but was never actually GRANTed table privileges to the
-- `authenticated` role — Postgres requires both a passing RLS policy AND a
-- base GRANT, so every direct admin insert (e.g. "Wish Happy Birthday" from
-- the Admin Portal) failed with "permission denied for table notifications"
-- even for a legitimate is_admin() session. Staff-side access was never
-- affected since that goes through SECURITY DEFINER RPCs (which bypass
-- grants as the table owner), which is why this went unnoticed.
-- ============================================================================

grant select, insert, update, delete on public.notifications to authenticated;

-- 'birthday_wish' is a new notification type (used by both the Staff
-- Portal's staff_send_birthday_wish RPC and the Admin Portal's birthday
-- reminder card) — the existing check constraint predates it.
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type = ANY (ARRAY['task_assigned', 'report_approved', 'report_rejected', 'changes_required', 'follow_up_reminder', 'announcement', 'birthday_wish']));
