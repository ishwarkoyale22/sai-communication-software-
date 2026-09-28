-- 0064_fix_task_notification_trigger.sql
-- trg_notify_task_assigned already exists live in production (confirmed via pg_trigger) and has been
-- firing correctly on every task assignment — this migration doesn't fix a live outage. What it fixes
-- is that the trigger was applied directly at some point and was never captured in a checked-in
-- migration file (0062 only (re)defines notify_staff_on_task_change() itself, never the trigger that
-- calls it). Without this file, replaying every migration in order against a fresh database would
-- create the function but never wire it up, silently breaking staff task notifications in that rebuild.
-- Idempotent — safe to run against a database that already has this trigger.
drop trigger if exists trg_notify_task_assigned on public.staff_tasks;
create trigger trg_notify_task_assigned
  after insert on public.staff_tasks
  for each row execute function public.notify_staff_on_task_change();
