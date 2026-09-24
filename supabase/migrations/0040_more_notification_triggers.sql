-- ============================================================================
-- 0040_more_notification_triggers.sql
--
-- Extends the same notifications system (0038/0039) with the remaining
-- actionable events, all as DB triggers on the tables that already exist —
-- no new tables, no new bell/badge UI, no parallel notification path.
--
-- Deliberately NOT wired up (documented, not silently dropped):
--   - "New enquiry assigned to a staff member" — `enquiries` has no staff
--     assignment column/UI anywhere in the app (unlike repairs, which has
--     `technician_id`). Adding one would be a new assignment FEATURE, not a
--     notification, so it's left out — "New enquiry received" (admin) is
--     still added below.
--   - Repair status changes in general are NOT pushed to the assigned
--     technician: staff update their own repair's status themselves via
--     staff_update_repair_status, so notifying them of their own edit would
--     just be noise. Only the technician ASSIGNMENT itself notifies staff;
--     the repair reaching 'completed' notifies admin (pickup-ready is the
--     actionable admin-side status change).
-- ============================================================================

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type = ANY (ARRAY[
    'task_assigned', 'report_approved', 'report_rejected', 'changes_required',
    'follow_up_reminder', 'announcement', 'birthday_wish',
    'leave_submitted', 'leave_approved', 'leave_rejected',
    'staff_registered', 'account_approved', 'finance_report_uploaded',
    'low_gift_stock', 'product_added', 'product_sold',
    'website_order_new', 'repair_request_new', 'repair_completed',
    'enquiry_new', 'review_new', 'wholesaler_invoice_new',
    'third_party_purchase_new', 'finance_application_new', 'finance_status_update',
    'repair_assigned', 'follow_up_due', 'follow_up_overdue'
  ]));

-- ----------------------------------------------------------------------------
-- Website Orders → admin
-- ----------------------------------------------------------------------------
create or replace function public.notify_on_website_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into notifications (for_admin, type, title, body, related_id, link)
  values (true, 'website_order_new', 'New Website Order',
    'Order ' || new.order_number || ' from ' || coalesce(new.customer_name, 'a customer') || ' — ' || to_char(new.total_amount, 'FM999999990') || '.',
    new.id, '/web-orders');
  return new;
end;
$$;

drop trigger if exists trg_notify_website_order on public.website_orders;
create trigger trg_notify_website_order
  after insert on public.website_orders
  for each row execute function public.notify_on_website_order();

-- ----------------------------------------------------------------------------
-- Repair Enquiries (new request) → admin
-- ----------------------------------------------------------------------------
create or replace function public.notify_on_repair_enquiry()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into notifications (for_admin, type, title, body, related_id, link)
  values (true, 'repair_request_new', 'New Repair Request',
    coalesce(new.customer_name, 'A customer') || ' requested a repair for ' ||
      coalesce(new.phone_brand, '') || ' ' || coalesce(new.phone_model, '') || '.',
    new.id, '/repair-enquiries');
  return new;
end;
$$;

drop trigger if exists trg_notify_repair_enquiry on public.repair_enquiries;
create trigger trg_notify_repair_enquiry
  after insert on public.repair_enquiries
  for each row execute function public.notify_on_repair_enquiry();

-- ----------------------------------------------------------------------------
-- Repairs: assigned to a technician → staff; reaches 'completed' → admin
-- ----------------------------------------------------------------------------
create or replace function public.notify_on_repair_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.technician_id is not null and (tg_op = 'INSERT' or old.technician_id is distinct from new.technician_id) then
    insert into notifications (staff_id, type, title, body, related_id, link)
    values (new.technician_id, 'repair_assigned', 'Repair Assigned To You',
      'You were assigned a repair: ' || coalesce(new.device_brand, '') || ' ' || coalesce(new.device_model, '') ||
        ' for ' || coalesce(new.customer_name, 'a customer') || '.',
      new.id, '/portal/repairs');
  end if;

  if tg_op = 'UPDATE' and new.status = 'completed' and old.status is distinct from 'completed' then
    insert into notifications (for_admin, type, title, body, related_id, link)
    values (true, 'repair_completed', 'Repair Completed',
      'Repair for ' || coalesce(new.customer_name, 'a customer') || ' (' || coalesce(new.device_brand, '') || ' ' ||
        coalesce(new.device_model, '') || ') is ready.',
      new.id, '/repairs');
  end if;

  return new;
end;
$$;

drop trigger if exists trg_notify_repair_change on public.repairs;
create trigger trg_notify_repair_change
  after insert or update on public.repairs
  for each row execute function public.notify_on_repair_change();

-- ----------------------------------------------------------------------------
-- Customer Enquiries (new) → admin
-- ----------------------------------------------------------------------------
create or replace function public.notify_on_enquiry()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into notifications (for_admin, type, title, body, related_id, link)
  values (true, 'enquiry_new', 'New Enquiry',
    coalesce(new.customer_name, 'A customer') || ': ' || coalesce(new.subject, new.message, 'New enquiry'),
    new.id, '/enquiries');
  return new;
end;
$$;

drop trigger if exists trg_notify_enquiry on public.enquiries;
create trigger trg_notify_enquiry
  after insert on public.enquiries
  for each row execute function public.notify_on_enquiry();

-- ----------------------------------------------------------------------------
-- Reviews (new) → admin
-- ----------------------------------------------------------------------------
create or replace function public.notify_on_review()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into notifications (for_admin, type, title, body, related_id, link)
  values (true, 'review_new', 'New Review',
    coalesce(new.customer_name, 'A customer') || ' left a ' || coalesce(new.rating::text, '?') || '★ review.',
    new.id, '/reviews');
  return new;
end;
$$;

drop trigger if exists trg_notify_review on public.reviews;
create trigger trg_notify_review
  after insert on public.reviews
  for each row execute function public.notify_on_review();

-- ----------------------------------------------------------------------------
-- Wholesaler Invoices (new) → admin
-- ----------------------------------------------------------------------------
create or replace function public.notify_on_wholesaler_invoice()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into notifications (for_admin, type, title, body, related_id, link)
  values (true, 'wholesaler_invoice_new', 'New Wholesaler Invoice',
    coalesce(new.wholesaler_name, 'A wholesaler') || ' — ' || to_char(new.total_amount, 'FM999999990') || '.',
    new.id, '/wholesaler-invoices');
  return new;
end;
$$;

drop trigger if exists trg_notify_wholesaler_invoice on public.wholesaler_invoices;
create trigger trg_notify_wholesaler_invoice
  after insert on public.wholesaler_invoices
  for each row execute function public.notify_on_wholesaler_invoice();

-- ----------------------------------------------------------------------------
-- Third-Party Purchases (new) → admin
-- ----------------------------------------------------------------------------
create or replace function public.notify_on_third_party_purchase()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into notifications (for_admin, type, title, body, related_id, link)
  values (true, 'third_party_purchase_new', 'New Third-Party Purchase',
    coalesce(new.vendor_name, 'A vendor') || ': ' || coalesce(new.item_name, 'item') || ' x' || coalesce(new.quantity, 1) || '.',
    new.id, '/third-party-purchases');
  return new;
end;
$$;

drop trigger if exists trg_notify_third_party_purchase on public.third_party_purchases;
create trigger trg_notify_third_party_purchase
  after insert on public.third_party_purchases
  for each row execute function public.notify_on_third_party_purchase();

-- ----------------------------------------------------------------------------
-- Finance/EMI: new application → admin; reaching an important status → admin
-- ----------------------------------------------------------------------------
create or replace function public.notify_on_finance_transaction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into notifications (for_admin, type, title, body, related_id, link)
    values (true, 'finance_application_new', 'New Finance/EMI Application',
      coalesce(new.customer_name, 'A customer') || ' — ' || coalesce(new.product_name, 'product') || '.',
      new.id, '/finance');
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status
    and new.status in ('approved', 'disbursed', 'settled', 'rejected') then
    insert into notifications (for_admin, type, title, body, related_id, link)
    values (true, 'finance_status_update', 'Finance Application ' || initcap(new.status),
      coalesce(new.customer_name, 'A customer') || '''s finance application is now ' || new.status || '.',
      new.id, '/finance');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_finance_transaction on public.finance_transactions;
create trigger trg_notify_finance_transaction
  after insert or update on public.finance_transactions
  for each row execute function public.notify_on_finance_transaction();

-- ----------------------------------------------------------------------------
-- Follow-ups due/overdue → staff (time-based, so a scheduled job rather than
-- an insert/update trigger). Runs once daily; skips a follow-up already
-- notified today so it doesn't re-fire every run.
-- ----------------------------------------------------------------------------
create or replace function public.check_due_followups()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  f record;
  v_customer_name text;
  v_notif_type text;
begin
  for f in
    select * from follow_ups
    where status = 'pending' and follow_up_date <= current_date
  loop
    v_notif_type := case when f.follow_up_date < current_date then 'follow_up_overdue' else 'follow_up_due' end;

    if exists (
      select 1 from notifications
      where related_id = f.id and type = v_notif_type and created_at::date = current_date
    ) then
      continue;
    end if;

    select name into v_customer_name from customers where id = f.customer_id;

    insert into notifications (staff_id, type, title, body, related_id, link)
    values (
      f.staff_id,
      v_notif_type,
      case when v_notif_type = 'follow_up_overdue' then 'Follow-up Overdue' else 'Follow-up Due Today' end,
      'Follow up with ' || coalesce(v_customer_name, 'a client') || ': ' || f.reason,
      f.id,
      '/portal/follow-ups'
    );
  end loop;
end;
$$;

select cron.unschedule(jobid) from cron.job where jobname = 'check-due-followups-daily';

select cron.schedule(
  'check-due-followups-daily',
  '30 3 * * *', -- 09:00 IST
  $$select public.check_due_followups()$$
);
