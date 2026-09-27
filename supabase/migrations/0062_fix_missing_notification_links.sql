-- 0062_fix_missing_notification_links.sql
-- task_assigned and report_approved/changes_required notifications never set `link`, so tapping them
-- in the staff portal's Alerts list silently did nothing (openNotification() only navigates when the
-- notification has a link — see apps/admin/src/staff/pages/Notifications.tsx).
create or replace function public.notify_staff_on_task_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if tg_op = 'INSERT' then
    insert into notifications (staff_id, type, title, body, related_id, link)
    values (new.staff_id, 'task_assigned', 'New task assigned', new.title, new.id, '/portal/tasks');
  end if;
  return new;
end;
$$;

create or replace function public.notify_staff_on_report_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if new.status = 'approved' then
      insert into notifications (staff_id, type, title, body, related_id, link)
      values (new.staff_id, 'report_approved', 'Report approved', new.title, new.id, '/portal/reports');
    elsif new.status = 'changes_required' then
      insert into notifications (staff_id, type, title, body, related_id, link)
      values (new.staff_id, 'changes_required', 'Changes requested on your report', coalesce(new.admin_feedback, new.title), new.id, '/portal/reports');
    end if;
  end if;
  return new;
end;
$$;
