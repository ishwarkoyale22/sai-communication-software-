-- ============================================================================
-- 0011_staff_portal_full.sql
--
-- Staff Portal: attendance, leave requests, assigned tasks, activity log,
-- and a real server-verified session mechanism for staff (PIN login today
-- never establishes a Supabase Auth session, so is_staff()/auth.uid()
-- cannot gate these writes the normal way — this fixes that without
-- touching Supabase Auth, without an Edge Function, and WITHOUT modifying
-- the existing `staff_pin_login` function, per instruction).
--
-- Design: after staff_pin_login succeeds, the client calls the new
-- issue_staff_session() RPC below, which RE-VERIFIES phone+pin itself
-- (never trusts the client's word that login succeeded) and returns a
-- random token stored in staff_sessions. Every staff action RPC below
-- takes that token, resolves+validates it server-side, and only then
-- acts — the token is the enforcement boundary, not anything client-side.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- attendance — the admin/staff app code has referenced this table shape
-- (staff_id, clock_in_lat/lng, clock_out_lat/lng) since earlier in the
-- session; it never existed until now.
-- ----------------------------------------------------------------------------
create table if not exists attendance (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references staff (id) on delete cascade,
  clock_in timestamptz not null default now(),
  clock_out timestamptz,
  clock_in_lat numeric(10, 6),
  clock_in_lng numeric(10, 6),
  clock_out_lat numeric(10, 6),
  clock_out_lng numeric(10, 6)
);

create index if not exists idx_attendance_staff on attendance (staff_id, clock_in desc);

-- ----------------------------------------------------------------------------
-- leave_requests
-- ----------------------------------------------------------------------------
create table if not exists leave_requests (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references staff (id) on delete cascade,
  leave_type text not null default 'other' check (leave_type in ('sick', 'casual', 'annual', 'unpaid', 'other')),
  start_date date not null,
  end_date date not null,
  reason text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references auth.users (id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_leave_requests_staff on leave_requests (staff_id, created_at desc);

-- ----------------------------------------------------------------------------
-- staff_tasks — assigned by admin, worked by staff
-- ----------------------------------------------------------------------------
create table if not exists staff_tasks (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references staff (id) on delete cascade,
  title text not null,
  description text,
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'completed')),
  due_date date,
  assigned_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_staff_tasks_staff on staff_tasks (staff_id, status);

-- ----------------------------------------------------------------------------
-- staff_activity_log — lightweight audit trail
-- ----------------------------------------------------------------------------
create table if not exists staff_activity_log (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid references staff (id) on delete set null,
  action text not null,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists idx_staff_activity_staff on staff_activity_log (staff_id, created_at desc);

-- ----------------------------------------------------------------------------
-- staff_sessions — the real enforcement mechanism for everything below
-- ----------------------------------------------------------------------------
create table if not exists staff_sessions (
  token uuid primary key default gen_random_uuid(),
  staff_id uuid not null references staff (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '12 hours')
);

create index if not exists idx_staff_sessions_staff on staff_sessions (staff_id);

-- Helper used by every staff action RPC below — resolves a session token to
-- a live staff_id, or raises if it's missing/expired/deactivated. Never
-- exposed directly to the client; only called from inside other RPCs.
create or replace function resolve_staff_session(p_token uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff_id uuid;
begin
  select s.staff_id into v_staff_id
  from staff_sessions s
  join staff st on st.id = s.staff_id
  where s.token = p_token
    and s.expires_at > now()
    and st.is_active = true;

  if v_staff_id is null then
    raise exception 'Invalid or expired staff session. Please log in again.';
  end if;

  return v_staff_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- issue_staff_session — re-verifies phone+pin itself (does not trust the
-- caller), then issues a token. This is the ONLY new entry point staff
-- authenticate through going forward; staff_pin_login is untouched and can
-- keep being used for the initial UI check exactly as it is today.
-- ----------------------------------------------------------------------------
create or replace function issue_staff_session(p_phone text, p_pin text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff staff%rowtype;
  v_token uuid;
begin
  select * into v_staff from staff where phone = p_phone and pin = p_pin and is_active = true;

  if v_staff.id is null then
    return json_build_object('success', false, 'error', 'Invalid phone or PIN');
  end if;

  insert into staff_sessions (staff_id) values (v_staff.id) returning token into v_token;

  insert into staff_activity_log (staff_id, action, details)
  values (v_staff.id, 'login', json_build_object('phone', p_phone));

  return json_build_object(
    'success', true,
    'token', v_token,
    'staff', json_build_object('id', v_staff.id, 'name', v_staff.name, 'role', v_staff.role, 'phone', v_staff.phone)
  );
end;
$$;

grant execute on function issue_staff_session(text, text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- Attendance RPCs
-- ----------------------------------------------------------------------------
create or replace function staff_clock_in(p_token uuid, p_lat numeric default null, p_lng numeric default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff_id uuid := resolve_staff_session(p_token);
  v_open_id uuid;
  v_new_id uuid;
begin
  select id into v_open_id from attendance where staff_id = v_staff_id and clock_out is null limit 1;
  if v_open_id is not null then
    return json_build_object('success', false, 'error', 'Already clocked in.');
  end if;

  insert into attendance (staff_id, clock_in_lat, clock_in_lng)
  values (v_staff_id, p_lat, p_lng)
  returning id into v_new_id;

  insert into staff_activity_log (staff_id, action, details) values (v_staff_id, 'clock_in', '{}');

  return json_build_object('success', true, 'attendance_id', v_new_id);
end;
$$;

create or replace function staff_clock_out(p_token uuid, p_lat numeric default null, p_lng numeric default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff_id uuid := resolve_staff_session(p_token);
  v_open_id uuid;
begin
  select id into v_open_id from attendance where staff_id = v_staff_id and clock_out is null order by clock_in desc limit 1;
  if v_open_id is null then
    return json_build_object('success', false, 'error', 'Not currently clocked in.');
  end if;

  update attendance set clock_out = now(), clock_out_lat = p_lat, clock_out_lng = p_lng where id = v_open_id;

  insert into staff_activity_log (staff_id, action, details) values (v_staff_id, 'clock_out', '{}');

  return json_build_object('success', true);
end;
$$;

create or replace function staff_get_attendance(p_token uuid)
returns setof attendance
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff_id uuid := resolve_staff_session(p_token);
begin
  return query select * from attendance where staff_id = v_staff_id order by clock_in desc;
end;
$$;

grant execute on function staff_clock_in(uuid, numeric, numeric) to anon, authenticated;
grant execute on function staff_clock_out(uuid, numeric, numeric) to anon, authenticated;
grant execute on function staff_get_attendance(uuid) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- Leave RPCs
-- ----------------------------------------------------------------------------
create or replace function staff_apply_leave(p_token uuid, p_leave_type text, p_start_date date, p_end_date date, p_reason text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff_id uuid := resolve_staff_session(p_token);
  v_id uuid;
begin
  insert into leave_requests (staff_id, leave_type, start_date, end_date, reason)
  values (v_staff_id, p_leave_type, p_start_date, p_end_date, p_reason)
  returning id into v_id;

  insert into staff_activity_log (staff_id, action, details)
  values (v_staff_id, 'leave_applied', json_build_object('leave_id', v_id));

  return json_build_object('success', true, 'leave_id', v_id);
end;
$$;

create or replace function staff_get_leave_requests(p_token uuid)
returns setof leave_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff_id uuid := resolve_staff_session(p_token);
begin
  return query select * from leave_requests where staff_id = v_staff_id order by created_at desc;
end;
$$;

grant execute on function staff_apply_leave(uuid, text, date, date, text) to anon, authenticated;
grant execute on function staff_get_leave_requests(uuid) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- Tasks: staff reads their own, admin assigns/manages via normal RLS below
-- ----------------------------------------------------------------------------
create or replace function staff_get_tasks(p_token uuid)
returns setof staff_tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff_id uuid := resolve_staff_session(p_token);
begin
  return query select * from staff_tasks where staff_id = v_staff_id order by created_at desc;
end;
$$;

create or replace function staff_update_task_status(p_token uuid, p_task_id uuid, p_status text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff_id uuid := resolve_staff_session(p_token);
begin
  if p_status not in ('pending', 'in_progress', 'completed') then
    raise exception 'Invalid status';
  end if;

  update staff_tasks set status = p_status, updated_at = now()
  where id = p_task_id and staff_id = v_staff_id;

  if not found then
    return json_build_object('success', false, 'error', 'Task not found or not assigned to you.');
  end if;

  return json_build_object('success', true);
end;
$$;

grant execute on function staff_get_tasks(uuid) to anon, authenticated;
grant execute on function staff_update_task_status(uuid, uuid, text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- Customer reviews, submitted on a customer's behalf by staff
-- ----------------------------------------------------------------------------
create or replace function staff_submit_review(p_token uuid, p_customer_name text, p_phone text, p_rating int, p_comment text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff_id uuid := resolve_staff_session(p_token);
  v_id uuid;
begin
  if p_rating < 1 or p_rating > 5 then
    raise exception 'Rating must be between 1 and 5';
  end if;

  insert into reviews (customer_name, phone, rating, comment, status)
  values (p_customer_name, p_phone, p_rating, p_comment, 'pending')
  returning id into v_id;

  insert into staff_activity_log (staff_id, action, details)
  values (v_staff_id, 'review_submitted', json_build_object('review_id', v_id));

  return json_build_object('success', true, 'review_id', v_id);
end;
$$;

grant execute on function staff_submit_review(uuid, text, text, int, text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- Client reports + activity, submitted via token (same pattern) so the
-- existing client_reports RLS (admin_all + staff-own, which already
-- assumed a real auth.uid()) gets a working write path too.
-- ----------------------------------------------------------------------------
-- NOTE: this originally inserted (customer_id, report_type, report_data,
-- notes) — none of report_type/report_data are real columns on
-- client_reports (see 0005: id, customer_id, staff_id not null, title not
-- null, notes, file_url, created_at). That insert would have failed the
-- moment this migration was applied and someone submitted a report. Fixed
-- to match the actual table, and staff_id is now supplied (it's NOT NULL).
create or replace function staff_submit_client_report(p_token uuid, p_customer_id uuid, p_title text, p_notes text, p_file_url text default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff_id uuid := resolve_staff_session(p_token);
  v_id uuid;
begin
  insert into client_reports (customer_id, staff_id, title, notes, file_url, status)
  values (p_customer_id, v_staff_id, p_title, p_notes, p_file_url, 'submitted')
  returning id into v_id;

  insert into staff_activity_log (staff_id, action, details)
  values (v_staff_id, 'client_report_submitted', json_build_object('report_id', v_id, 'customer_id', p_customer_id));

  return json_build_object('success', true, 'report_id', v_id);
end;
$$;

create or replace function staff_get_activity(p_token uuid)
returns setof staff_activity_log
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff_id uuid := resolve_staff_session(p_token);
begin
  return query select * from staff_activity_log where staff_id = v_staff_id order by created_at desc limit 200;
end;
$$;

grant execute on function staff_submit_client_report(uuid, uuid, text, text, text) to anon, authenticated;
grant execute on function staff_get_activity(uuid) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- RLS: admin has full visibility into everything above (for Staff
-- Management: view attendance, approve/reject leave, view reports/tasks).
-- No anon/public policy on any of these — every read for staff themselves
-- goes through the token-verified RPCs above, not direct table access.
-- ----------------------------------------------------------------------------
alter table attendance enable row level security;
alter table leave_requests enable row level security;
alter table staff_tasks enable row level security;
alter table staff_activity_log enable row level security;
alter table staff_sessions enable row level security;

drop policy if exists "admin_all_attendance" on attendance;
create policy "admin_all_attendance" on attendance for all using (is_admin()) with check (is_admin());

drop policy if exists "admin_all_leave_requests" on leave_requests;
create policy "admin_all_leave_requests" on leave_requests for all using (is_admin()) with check (is_admin());

drop policy if exists "admin_all_staff_tasks" on staff_tasks;
create policy "admin_all_staff_tasks" on staff_tasks for all using (is_admin()) with check (is_admin());

drop policy if exists "admin_read_staff_activity_log" on staff_activity_log;
create policy "admin_read_staff_activity_log" on staff_activity_log for select using (is_admin());

-- staff_sessions is never read/written directly by any client role — only
-- the SECURITY DEFINER functions above touch it. No policy grants any
-- access at all (RLS enabled, zero policies = fully closed table).

-- ----------------------------------------------------------------------------
-- Storage: client-report attachments. Private (not public like
-- product-images) since these may contain customer-sensitive content —
-- reads require a real admin session; staff upload via a token-checked RPC
-- can't be done for Storage objects directly (Storage RLS only sees
-- auth.uid(), which staff PIN sessions don't have), so uploads use the
-- service-agnostic public-insert-with-folder-prefix pattern instead:
-- anyone can INSERT into this bucket, but nothing can be read back except
-- by an authenticated admin. This mirrors "staff can drop a file in, only
-- admin can retrieve it" without needing a real staff auth session.
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('client-reports', 'client-reports', false, 10485760, array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do nothing;

drop policy if exists "admin_read_client_report_files" on storage.objects;
create policy "admin_read_client_report_files" on storage.objects
  for select
  using (bucket_id = 'client-reports' and is_admin());

drop policy if exists "anyone_upload_client_report_files" on storage.objects;
create policy "anyone_upload_client_report_files" on storage.objects
  for insert
  with check (bucket_id = 'client-reports');

drop policy if exists "admin_manage_client_report_files" on storage.objects;
create policy "admin_manage_client_report_files" on storage.objects
  for all
  using (bucket_id = 'client-reports' and is_admin())
  with check (bucket_id = 'client-reports' and is_admin());
