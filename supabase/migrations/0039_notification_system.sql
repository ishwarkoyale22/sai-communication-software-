-- ============================================================================
-- 0039_notification_system.sql
--
-- Extends the existing `notifications` table (already used for task_assigned,
-- client_reports review status, birthday_wish) into a proper two-sided
-- notification system, instead of building a parallel one:
--
--   - staff_id becomes nullable + a new `for_admin` flag distinguishes an
--     admin-facing notification from a staff-facing one on the SAME table.
--   - a new `link` column is the in-app path a click should open.
--
-- Trigger-based notifications are added only where the acting person's name
-- is already resolvable from a DB-visible relation (staff table) and the
-- table is written from more than one place (RPCs) — that's leave requests,
-- staff self-registration/approval, finance reports, and low gift stock.
-- "New product added" and "Sale completed" are NOT triggers: neither
-- inventory nor sales rows carry who performed the action or (for sales)
-- what was actually sold, so those two are added as small app-level calls
-- right where the existing insert already succeeds (Inventory.tsx, Sales.tsx).
-- ============================================================================

alter table public.notifications alter column staff_id drop not null;
alter table public.notifications add column if not exists for_admin boolean not null default false;
alter table public.notifications add column if not exists link text;

-- Was never added to the realtime publication — the admin bell and the
-- staff badge both rely on postgres_changes to update live.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type = ANY (ARRAY[
    'task_assigned', 'report_approved', 'report_rejected', 'changes_required',
    'follow_up_reminder', 'announcement', 'birthday_wish',
    'leave_submitted', 'leave_approved', 'leave_rejected',
    'staff_registered', 'account_approved', 'finance_report_uploaded',
    'low_gift_stock', 'product_added', 'product_sold'
  ]));

-- Admin needs to read/manage every admin-facing row directly (not through a
-- token RPC, since the Admin Portal uses a real Supabase Auth session) —
-- the existing "admin_all_notifications" policy already covers this via
-- is_admin(), now that 0038 also grants the base table privileges.

-- ----------------------------------------------------------------------------
-- Leave requests: submitted → notify admin; approved/rejected → notify staff
-- ----------------------------------------------------------------------------
create or replace function public.notify_on_leave_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff_name text;
begin
  if tg_op = 'INSERT' then
    select name into v_staff_name from staff where id = new.staff_id;
    insert into notifications (for_admin, type, title, body, related_id, link)
    values (true, 'leave_submitted', 'Leave Request Submitted',
      coalesce(v_staff_name, 'A staff member') || ' submitted a leave request.',
      new.id, '/staff-portal?tab=Leave');
  elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status in ('approved', 'rejected') then
    insert into notifications (staff_id, type, title, body, related_id, link)
    values (new.staff_id, 'leave_' || new.status,
      'Leave Request ' || initcap(new.status),
      'Your ' || new.leave_type || ' leave request (' || new.start_date || ' to ' || new.end_date || ') was ' || new.status || '.',
      new.id, '/portal/leave');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_leave_request on public.leave_requests;
create trigger trg_notify_leave_request
  after insert or update on public.leave_requests
  for each row execute function public.notify_on_leave_request();

-- ----------------------------------------------------------------------------
-- Staff self-registration → notify admin; approval → notify staff
-- ----------------------------------------------------------------------------
create or replace function public.notify_on_staff_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' and new.is_active = false then
    insert into notifications (for_admin, type, title, body, related_id, link)
    values (true, 'staff_registered', 'New Staff Account Request',
      coalesce(new.name, 'Someone') || ' requested a staff account.', new.id, '/staff');
  elsif tg_op = 'UPDATE' and old.is_active = false and new.is_active = true then
    insert into notifications (staff_id, type, title, body, related_id, link)
    values (new.id, 'account_approved', 'Account Approved',
      'Your staff account has been approved — you can now log in.', new.id, '/portal');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_staff_change on public.staff;
create trigger trg_notify_staff_change
  after insert or update on public.staff
  for each row execute function public.notify_on_staff_change();

-- ----------------------------------------------------------------------------
-- Finance report uploaded → notify admin
-- ----------------------------------------------------------------------------
create or replace function public.notify_on_finance_report()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff_name text;
begin
  select name into v_staff_name from staff where id = new.staff_id;
  insert into notifications (for_admin, type, title, body, related_id, link)
  values (true, 'finance_report_uploaded', 'New Finance Report',
    coalesce(v_staff_name, 'A staff member') || ' uploaded a new Finance Report: ' || new.title || '.',
    new.id, '/finance-reports');
  return new;
end;
$$;

drop trigger if exists trg_notify_finance_report on public.finance_reports;
create trigger trg_notify_finance_report
  after insert on public.finance_reports
  for each row execute function public.notify_on_finance_report();

-- ----------------------------------------------------------------------------
-- Gift stock crosses into "low" (<=5) → notify admin once per crossing, not
-- on every sale still under the threshold.
-- ----------------------------------------------------------------------------
create or replace function public.notify_on_low_gift_stock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.stock <= 5 and (old.stock is null or old.stock > 5) then
    insert into notifications (for_admin, type, title, body, related_id, link)
    values (true, 'low_gift_stock', 'Low Gift Stock',
      new.name || ' is low on stock (' || new.stock || ' left).', new.id, '/gifts');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_low_gift_stock on public.gifts;
create trigger trg_notify_low_gift_stock
  after update on public.gifts
  for each row execute function public.notify_on_low_gift_stock();
