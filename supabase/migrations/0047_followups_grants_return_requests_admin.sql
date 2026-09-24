-- 0047: fixes found in the full end-to-end test.
--   1. follow_ups: the 0045 lockdown removed the table privileges, so the admin
--      Backup export failed ("permission denied for table follow_ups"). The
--      admin-only RLS policy already exists; restore the table privileges it
--      needs (RLS keeps everyone else out).
--   2. return_requests: customers can file returns on the website but the admin
--      app had no way to see or handle them. Give admins full access and add a
--      notification when a customer files one.

-- 1. follow_ups ---------------------------------------------------------------
grant select, insert, update, delete on public.follow_ups to authenticated;

-- 2. return_requests ----------------------------------------------------------
grant update, delete on public.return_requests to authenticated;

drop policy if exists "Admins manage return requests" on public.return_requests;
create policy "Admins manage return requests" on public.return_requests
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

alter table public.return_requests drop constraint if exists return_requests_status_check;
alter table public.return_requests add constraint return_requests_status_check
  check (status = any (array['requested','approved','rejected','completed']));

create or replace function public.notify_on_return_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order text;
begin
  select order_number into v_order from public.website_orders where id = new.order_id;
  insert into public.notifications (for_admin, type, title, body, related_id, link)
  values (true, 'website_order_new', 'Return request',
          coalesce(v_order, 'An order') || ' — ' || left(new.reason, 120), new.id, '/return-requests');
  return new;
end;
$$;
drop trigger if exists trg_notify_return_request on public.return_requests;
create trigger trg_notify_return_request after insert on public.return_requests
  for each row execute function public.notify_on_return_request();
