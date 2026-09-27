-- 0061_notification_open_status.sql
-- Notification badges currently key off `is_read` — cleared the instant a section is opened, whether
-- or not the thing it's about (a website order, a leave request, a repair) was actually dealt with.
-- The badge should instead track "is there still open work here", separate from "has anyone looked".
--
-- notification_is_open(type, related_id, is_read): for notification types whose underlying record has
-- a real pending/done status, look that record up via related_id and report whether it's still
-- unresolved — completely independent of is_read, so merely visiting the page no longer clears it.
-- Types with no such concept (an announcement, a completed repair, an approved leave notice, etc.) fall
-- back to is_read, exactly as before.
create or replace function public.notification_is_open(p_type text, p_related_id uuid, p_is_read boolean)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select case p_type
    when 'website_order_new' then
      coalesce((select order_status not in ('delivered', 'cancelled') from website_orders where id = p_related_id), false)
    when 'leave_submitted' then
      coalesce((select status = 'pending' from leave_requests where id = p_related_id), false)
    when 'repair_request_new' then
      coalesce((select status not in ('completed', 'cancelled') from repair_enquiries where id = p_related_id), false)
    when 'finance_application_new' then
      coalesce((select status not in ('settled', 'rejected', 'cancelled', 'failed') from finance_transactions where id = p_related_id), false)
    when 'task_assigned' then
      coalesce((select status <> 'completed' from staff_tasks where id = p_related_id), false)
    else not p_is_read
  end;
$$;

-- One round trip for the sidebar/bell to get every admin notification plus its open status, rather than
-- each caller re-implementing the type/table mapping above.
create or replace function public.admin_notifications_with_open_status()
returns table (
  id uuid,
  type text,
  title text,
  body text,
  link text,
  is_read boolean,
  is_open boolean,
  created_at timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    n.id, n.type, n.title, n.body, n.link, n.is_read,
    public.notification_is_open(n.type, n.related_id, n.is_read) as is_open,
    n.created_at
  from notifications n
  where n.for_admin = true
  order by n.created_at desc
  limit 50;
$$;

grant execute on function public.notification_is_open(text, uuid, boolean) to anon, authenticated;
grant execute on function public.admin_notifications_with_open_status() to anon, authenticated;
