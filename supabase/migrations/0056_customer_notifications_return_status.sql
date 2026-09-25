-- Customer notifications: a customer is told when Admin approves or rejects their return request.
--
-- Safety model:
--  * Rows are only ever created by the trigger below (SECURITY DEFINER), addressed to
--    return_requests.customer_id - the customer who filed that request. Clients have no INSERT
--    policy, so nobody can create or forge a notification for anyone.
--  * A customer can read only their own rows, and can change only the is_read flag on them.
create table if not exists public.customer_notifications (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('return_approved', 'return_rejected')),
  title text not null,
  body text,
  related_id uuid,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists customer_notifications_customer_idx on public.customer_notifications (customer_id, created_at desc);

alter table public.customer_notifications enable row level security;

revoke all on public.customer_notifications from anon, authenticated;
grant select on public.customer_notifications to authenticated;
grant update (is_read) on public.customer_notifications to authenticated;

drop policy if exists "Customers read own notifications" on public.customer_notifications;
create policy "Customers read own notifications" on public.customer_notifications
  for select to authenticated using (auth.uid() = customer_id);

drop policy if exists "Customers mark own notifications read" on public.customer_notifications;
create policy "Customers mark own notifications read" on public.customer_notifications
  for update to authenticated using (auth.uid() = customer_id) with check (auth.uid() = customer_id);

drop policy if exists "Admins manage customer notifications" on public.customer_notifications;
create policy "Admins manage customer notifications" on public.customer_notifications
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create or replace function public.notify_customer_on_return_decision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order text;
begin
  if new.status is not distinct from old.status or new.status not in ('approved', 'rejected') then
    return new;
  end if;
  select order_number into v_order from public.website_orders where id = new.order_id;

  insert into public.customer_notifications (customer_id, type, title, body, related_id)
  values (
    new.customer_id,                      -- the owner of THIS return request, nobody else
    case new.status when 'approved' then 'return_approved' else 'return_rejected' end,
    case new.status when 'approved' then 'Return request approved' else 'Return request not approved' end,
    case new.status
      when 'approved' then 'Your return request for order ' || coalesce(v_order, '') || ' has been approved. The shop will contact you about the next steps.'
      else 'Your return request for order ' || coalesce(v_order, '') || ' could not be approved. Please contact the shop if you have questions.'
    end,
    new.id
  );
  return new;
end;
$$;

drop trigger if exists trg_notify_customer_return_decision on public.return_requests;
create trigger trg_notify_customer_return_decision after update of status on public.return_requests
  for each row execute function public.notify_customer_on_return_decision();
