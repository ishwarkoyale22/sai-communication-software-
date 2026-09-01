-- ============================================================================
-- 0012_staff_clients_followups_notifications.sql
--
-- Adds the remaining Staff Portal spec items not covered by 0011:
--   - Client management scoped to the staff member who owns the client
--   - Follow-up management (its own entity, separate from staff_tasks)
--   - Notifications (task assigned, report approved/rejected/changes
--     requested, follow-up reminder, admin announcement)
--   - client_reports review workflow: draft/submitted/under_review/
--     approved/changes_required, with admin feedback and a resubmit path
--   - staff self-service profile update + PIN change
--
-- Same pattern as 0011: every staff-facing RPC takes p_token and resolves
-- it via resolve_staff_session() (defined in 0011) — nothing here trusts
-- a client-supplied staff_id. Requires 0011 applied first.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- customers: scope clients to the staff member who added/owns them, without
-- breaking admin's existing full access. "owner_staff_id" is nullable so
-- every pre-existing customer (added by admin, or before this migration)
-- keeps working — only new staff-added clients get scoped automatically.
-- ----------------------------------------------------------------------------
alter table customers add column if not exists owner_staff_id uuid references staff (id);
create index if not exists idx_customers_owner_staff on customers (owner_staff_id);

-- ----------------------------------------------------------------------------
-- follow_ups
-- ----------------------------------------------------------------------------
create table if not exists follow_ups (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references staff (id) on delete cascade,
  customer_id uuid not null references customers (id) on delete cascade,
  follow_up_date date not null,
  reason text not null,
  notes text,
  status text not null default 'pending' check (status in ('pending', 'completed', 'rescheduled', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_follow_ups_staff on follow_ups (staff_id, follow_up_date);

alter table follow_ups enable row level security;

drop policy if exists "admin_all_follow_ups" on follow_ups;
create policy "admin_all_follow_ups" on follow_ups for all using (is_admin()) with check (is_admin());

-- ----------------------------------------------------------------------------
-- notifications
-- ----------------------------------------------------------------------------
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references staff (id) on delete cascade,
  type text not null check (type in ('task_assigned', 'report_approved', 'report_rejected', 'changes_required', 'follow_up_reminder', 'announcement')),
  title text not null,
  body text,
  related_id uuid,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_notifications_staff on notifications (staff_id, is_read, created_at desc);

alter table notifications enable row level security;

drop policy if exists "admin_all_notifications" on notifications;
create policy "admin_all_notifications" on notifications for all using (is_admin()) with check (is_admin());

-- ----------------------------------------------------------------------------
-- client_reports review workflow
-- ----------------------------------------------------------------------------
alter table client_reports add column if not exists status text not null default 'submitted'
  check (status in ('draft', 'submitted', 'under_review', 'approved', 'changes_required'));
alter table client_reports add column if not exists admin_feedback text;
alter table client_reports add column if not exists updated_at timestamptz not null default now();

-- ----------------------------------------------------------------------------
-- Notification triggers — fire when ADMIN changes status on tasks, leave,
-- or reports (these tables only allow admin writes under RLS, so any
-- status-changing UPDATE reaching this trigger came from the admin side).
-- ----------------------------------------------------------------------------
create or replace function notify_staff_on_task_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into notifications (staff_id, type, title, body, related_id)
    values (new.staff_id, 'task_assigned', 'New task assigned', new.title, new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_task_assigned on staff_tasks;
create trigger trg_notify_task_assigned
  after insert on staff_tasks
  for each row execute function notify_staff_on_task_change();

create or replace function notify_staff_on_report_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if new.status = 'approved' then
      insert into notifications (staff_id, type, title, body, related_id)
      values (new.staff_id, 'report_approved', 'Report approved', new.title, new.id);
    elsif new.status = 'changes_required' then
      insert into notifications (staff_id, type, title, body, related_id)
      values (new.staff_id, 'changes_required', 'Changes requested on your report', coalesce(new.admin_feedback, new.title), new.id);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_report_status on client_reports;
create trigger trg_notify_report_status
  after update on client_reports
  for each row execute function notify_staff_on_report_change();

-- ----------------------------------------------------------------------------
-- Client RPCs (staff-scoped)
-- ----------------------------------------------------------------------------
create or replace function staff_get_clients(p_token uuid, p_search text default null)
returns setof customers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff_id uuid := resolve_staff_session(p_token);
begin
  return query
    select * from customers
    where (owner_staff_id = v_staff_id or owner_staff_id is null)
      and (p_search is null or name ilike '%' || p_search || '%' or phone ilike '%' || p_search || '%')
    order by created_at desc
    limit 200;
end;
$$;

create or replace function staff_add_client(p_token uuid, p_name text, p_phone text, p_notes text default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff_id uuid := resolve_staff_session(p_token);
  v_id uuid;
begin
  insert into customers (name, phone, notes, owner_staff_id)
  values (p_name, p_phone, p_notes, v_staff_id)
  returning id into v_id;

  insert into staff_activity_log (staff_id, action, details)
  values (v_staff_id, 'client_added', json_build_object('customer_id', v_id, 'name', p_name));

  return json_build_object('success', true, 'customer_id', v_id);
end;
$$;

create or replace function staff_update_client(p_token uuid, p_customer_id uuid, p_notes text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff_id uuid := resolve_staff_session(p_token);
begin
  update customers set notes = p_notes
  where id = p_customer_id and (owner_staff_id = v_staff_id or owner_staff_id is null);

  if not found then
    return json_build_object('success', false, 'error', 'Client not found or not accessible.');
  end if;

  insert into staff_activity_log (staff_id, action, details)
  values (v_staff_id, 'client_updated', json_build_object('customer_id', p_customer_id));

  return json_build_object('success', true);
end;
$$;

grant execute on function staff_get_clients(uuid, text) to anon, authenticated;
grant execute on function staff_add_client(uuid, text, text, text) to anon, authenticated;
grant execute on function staff_update_client(uuid, uuid, text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- Follow-up RPCs
-- ----------------------------------------------------------------------------
create or replace function staff_create_followup(p_token uuid, p_customer_id uuid, p_follow_up_date date, p_reason text, p_notes text default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff_id uuid := resolve_staff_session(p_token);
  v_id uuid;
begin
  insert into follow_ups (staff_id, customer_id, follow_up_date, reason, notes)
  values (v_staff_id, p_customer_id, p_follow_up_date, p_reason, p_notes)
  returning id into v_id;

  insert into staff_activity_log (staff_id, action, details)
  values (v_staff_id, 'follow_up_created', json_build_object('follow_up_id', v_id, 'customer_id', p_customer_id));

  return json_build_object('success', true, 'follow_up_id', v_id);
end;
$$;

create or replace function staff_get_followups(p_token uuid)
returns setof follow_ups
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff_id uuid := resolve_staff_session(p_token);
begin
  return query select * from follow_ups where staff_id = v_staff_id order by follow_up_date asc;
end;
$$;

create or replace function staff_update_followup_status(p_token uuid, p_follow_up_id uuid, p_status text, p_notes text default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff_id uuid := resolve_staff_session(p_token);
begin
  if p_status not in ('pending', 'completed', 'rescheduled', 'cancelled') then
    raise exception 'Invalid status';
  end if;

  update follow_ups
  set status = p_status, notes = coalesce(p_notes, notes), updated_at = now()
  where id = p_follow_up_id and staff_id = v_staff_id;

  if not found then
    return json_build_object('success', false, 'error', 'Follow-up not found.');
  end if;

  insert into staff_activity_log (staff_id, action, details)
  values (v_staff_id, 'follow_up_updated', json_build_object('follow_up_id', p_follow_up_id, 'status', p_status));

  return json_build_object('success', true);
end;
$$;

grant execute on function staff_create_followup(uuid, uuid, date, text, text) to anon, authenticated;
grant execute on function staff_get_followups(uuid) to anon, authenticated;
grant execute on function staff_update_followup_status(uuid, uuid, text, text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- Report resubmit — staff can edit + resubmit only their own reports that
-- are in 'changes_required', matching the spec's admin<->staff feedback loop.
-- ----------------------------------------------------------------------------
create or replace function staff_resubmit_client_report(p_token uuid, p_report_id uuid, p_title text, p_notes text, p_file_url text default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff_id uuid := resolve_staff_session(p_token);
begin
  update client_reports
  set title = p_title,
      notes = p_notes,
      file_url = coalesce(p_file_url, file_url),
      status = 'submitted',
      admin_feedback = null,
      updated_at = now()
  where id = p_report_id and staff_id = v_staff_id and status = 'changes_required';

  if not found then
    return json_build_object('success', false, 'error', 'Report not found, not yours, or not awaiting changes.');
  end if;

  insert into staff_activity_log (staff_id, action, details)
  values (v_staff_id, 'client_report_resubmitted', json_build_object('report_id', p_report_id));

  return json_build_object('success', true);
end;
$$;

create or replace function staff_get_client_reports(p_token uuid)
returns setof client_reports
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff_id uuid := resolve_staff_session(p_token);
begin
  return query select * from client_reports where staff_id = v_staff_id order by created_at desc;
end;
$$;

grant execute on function staff_resubmit_client_report(uuid, uuid, text, text, text) to anon, authenticated;
grant execute on function staff_get_client_reports(uuid) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- Notification RPCs
-- ----------------------------------------------------------------------------
create or replace function staff_get_notifications(p_token uuid)
returns setof notifications
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff_id uuid := resolve_staff_session(p_token);
begin
  return query select * from notifications where staff_id = v_staff_id order by created_at desc limit 100;
end;
$$;

create or replace function staff_mark_notification_read(p_token uuid, p_notification_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff_id uuid := resolve_staff_session(p_token);
begin
  update notifications set is_read = true where id = p_notification_id and staff_id = v_staff_id;
  return json_build_object('success', true);
end;
$$;

grant execute on function staff_get_notifications(uuid) to anon, authenticated;
grant execute on function staff_mark_notification_read(uuid, uuid) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- Profile RPCs — staff can update their own display info and PIN, nothing
-- admin-only (role, is_active, phone-as-login-id stay admin-managed).
-- ----------------------------------------------------------------------------
create or replace function staff_update_profile(p_token uuid, p_name text default null, p_email text default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff_id uuid := resolve_staff_session(p_token);
begin
  update staff
  set name = coalesce(p_name, name),
      email = coalesce(p_email, email)
  where id = v_staff_id;

  return json_build_object('success', true);
end;
$$;

create or replace function staff_change_pin(p_token uuid, p_current_pin text, p_new_pin text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff_id uuid := resolve_staff_session(p_token);
begin
  if p_new_pin !~ '^[0-9]{4}$' then
    return json_build_object('success', false, 'error', 'PIN must be exactly 4 digits.');
  end if;

  update staff set pin = p_new_pin
  where id = v_staff_id and pin = p_current_pin;

  if not found then
    return json_build_object('success', false, 'error', 'Current PIN is incorrect.');
  end if;

  insert into staff_activity_log (staff_id, action, details) values (v_staff_id, 'pin_changed', '{}');

  return json_build_object('success', true);
end;
$$;

grant execute on function staff_update_profile(uuid, text, text) to anon, authenticated;
grant execute on function staff_change_pin(uuid, text, text) to anon, authenticated;

-- staff.email may not exist yet on older schemas — add it if missing so
-- staff_update_profile above has somewhere to write.
alter table staff add column if not exists email text;
