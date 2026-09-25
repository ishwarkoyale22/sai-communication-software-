-- Refund tracking for paid website orders that are cancelled / returned.
--
-- Rules:
--  * payment_status keeps meaning "what the customer paid". It is NOT changed by a refund.
--  * refund_status: 'none' (default) -> 'pending' (refund due) -> 'refunded'.
--  * The system only ever raises 'pending' (order cancelled while paid/partial, or a return request
--    marked Completed on a paid order). 'refunded' is set ONLY when Admin records an actual refund
--    with an amount, method and date.
--  * Customers can't set or change any refund field (forced back to defaults on their inserts).
alter table public.website_orders
  add column if not exists refund_status text not null default 'none',
  add column if not exists refund_amount numeric,
  add column if not exists refunded_at timestamptz,
  add column if not exists refund_method text,
  add column if not exists refund_reference text,
  add column if not exists refund_note text;

alter table public.website_orders drop constraint if exists website_orders_refund_status_check;
alter table public.website_orders add constraint website_orders_refund_status_check
  check (refund_status in ('none', 'pending', 'refunded'));
alter table public.website_orders drop constraint if exists website_orders_refund_recorded_check;
alter table public.website_orders add constraint website_orders_refund_recorded_check
  check (refund_status <> 'refunded' or (refund_amount is not null and refund_amount > 0 and refunded_at is not null and refund_method is not null));

-- customers may be told when a refund is recorded
alter table public.customer_notifications drop constraint if exists customer_notifications_type_check;
alter table public.customer_notifications add constraint customer_notifications_type_check
  check (type in ('return_approved', 'return_rejected', 'refund_recorded'));

create or replace function public.website_order_refund_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_client boolean := auth.uid() is not null and not coalesce(public.is_admin(), false);
begin
  if tg_op = 'INSERT' then
    -- A new order never starts with a refund, whoever places it.
    new.refund_status := 'none';
    new.refund_amount := null; new.refunded_at := null; new.refund_method := null;
    new.refund_reference := null; new.refund_note := null;
    return new;
  end if;

  -- Non-admin signed-in users can never touch refund fields.
  if v_is_client and (
       new.refund_status is distinct from old.refund_status or new.refund_amount is distinct from old.refund_amount
    or new.refunded_at is distinct from old.refunded_at or new.refund_method is distinct from old.refund_method
    or new.refund_reference is distinct from old.refund_reference or new.refund_note is distinct from old.refund_note) then
    raise exception 'Only Admin can change refund details.';
  end if;

  -- Recording a refund: must be a real, sensible refund.
  if new.refund_status = 'refunded' and old.refund_status is distinct from 'refunded' then
    if new.payment_status not in ('paid', 'partial') then
      raise exception 'Nothing was paid on this order, so there is nothing to refund.';
    end if;
    if new.refund_amount is null or new.refund_amount <= 0 or new.refund_amount > new.total_amount then
      raise exception 'Refund amount must be more than 0 and not more than the order total (%).', new.total_amount;
    end if;
    if new.refunded_at is null then new.refunded_at := now(); end if;
  end if;

  -- Cancelling a paid order raises "refund due" - it never marks it refunded.
  if new.order_status = 'cancelled' and old.order_status is distinct from 'cancelled'
     and new.payment_status in ('paid', 'partial') and new.refund_status = 'none' then
    new.refund_status := 'pending';
  end if;

  -- Order un-cancelled before any refund was actually paid out: nothing due any more.
  if old.order_status = 'cancelled' and new.order_status is distinct from 'cancelled' and new.refund_status = 'pending' then
    new.refund_status := 'none';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_website_order_refund_guard on public.website_orders;
create trigger trg_website_order_refund_guard before insert or update on public.website_orders
  for each row execute function public.website_order_refund_guard();

-- A return marked Completed on a paid order means money is owed back: raise "refund due" (never "refunded").
create or replace function public.return_completed_raise_refund_due()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    update public.website_orders
       set refund_status = 'pending'
     where id = new.order_id and payment_status in ('paid', 'partial') and refund_status = 'none';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_return_completed_refund_due on public.return_requests;
create trigger trg_return_completed_refund_due after update of status on public.return_requests
  for each row execute function public.return_completed_raise_refund_due();

-- Tell the customer when Admin records the refund.
create or replace function public.notify_customer_refund_recorded()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.refund_status = 'refunded' and old.refund_status is distinct from 'refunded' and new.customer_id is not null then
    insert into public.customer_notifications (customer_id, type, title, body, related_id)
    values (new.customer_id, 'refund_recorded', 'Refund processed',
            'A refund of Rs. ' || new.refund_amount || ' for order ' || new.order_number || ' was recorded by the shop'
              || coalesce(' (' || replace(new.refund_method, '_', ' ') || ')', '') || '.',
            new.id);
  end if;
  return new;
end;
$$;
drop trigger if exists trg_notify_customer_refund on public.website_orders;
create trigger trg_notify_customer_refund after update of refund_status on public.website_orders
  for each row execute function public.notify_customer_refund_recorded();
