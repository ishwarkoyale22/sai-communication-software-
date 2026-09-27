-- 0063_staff_notification_open_status.sql
-- Extends notification_is_open() (0061) with the remaining staff-facing types that have a real pending
-- state (repair_assigned, follow_up_due/overdue), and makes staff_get_notifications() return is_open so
-- the staff portal's Alerts badge/list can use the same "stays open until actually resolved" behavior
-- the admin side already has, instead of clearing the moment a notification is merely tapped.
create or replace function public.notification_is_open(p_type text, p_related_id uuid, p_is_read boolean)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select case
    when p_type = 'website_order_new' then
      coalesce((select order_status not in ('delivered', 'cancelled') from website_orders where id = p_related_id), false)
    when p_type = 'leave_submitted' then
      coalesce((select status = 'pending' from leave_requests where id = p_related_id), false)
    when p_type = 'repair_request_new' then
      coalesce((select status not in ('completed', 'cancelled') from repair_enquiries where id = p_related_id), false)
    when p_type = 'finance_application_new' then
      coalesce((select status not in ('settled', 'rejected', 'cancelled', 'failed') from finance_transactions where id = p_related_id), false)
    when p_type = 'task_assigned' then
      coalesce((select status <> 'completed' from staff_tasks where id = p_related_id), false)
    when p_type = 'repair_assigned' then
      coalesce((select status not in ('completed', 'delivered', 'cancelled') from repairs where id = p_related_id), false)
    when p_type in ('follow_up_due', 'follow_up_overdue') then
      coalesce((select status = 'pending' from follow_ups where id = p_related_id), false)
    else not p_is_read
  end;
$$;

drop function if exists public.staff_get_notifications(uuid);

create function public.staff_get_notifications(p_token uuid)
returns table (
  id uuid,
  staff_id uuid,
  type text,
  title text,
  body text,
  related_id uuid,
  is_read boolean,
  created_at timestamptz,
  for_admin boolean,
  link text,
  is_open boolean
)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_staff_id uuid := resolve_staff_session(p_token);
begin
  return query
    select n.id, n.staff_id, n.type, n.title, n.body, n.related_id, n.is_read, n.created_at, n.for_admin, n.link,
      public.notification_is_open(n.type, n.related_id, n.is_read) as is_open
    from notifications n
    where n.staff_id = v_staff_id
    order by n.created_at desc
    limit 100;
end;
$$;

grant execute on function public.staff_get_notifications(uuid) to anon, authenticated;
