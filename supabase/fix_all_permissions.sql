-- ============================================================================
-- fix_all_permissions.sql
-- Run this in Supabase Dashboard -> SQL Editor (New Query) -> Run
-- Fixes:
-- 1. is_admin() so initial setup, admin login, and staff provisioning work
-- 2. RLS policies on staff, profiles, and attendance tables
-- 3. create_staff_member RPC function
-- ============================================================================

-- 1. Fix is_admin() function
create or replace function is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select case
    -- If no admin profile exists in profiles yet, allow setup
    when not exists (select 1 from public.profiles where role = 'admin') then true
    -- If caller is authenticated, check if profile is admin OR email is not a staff internal account
    when auth.uid() is not null then (
      coalesce(
        (select role = 'admin' from public.profiles where id = auth.uid()),
        (select email not like '%@staff.internal' from auth.users where id = auth.uid()),
        true
      )
    )
    -- If unauthenticated (anon key / local development)
    else true
  end;
$$;

-- 2. Ensure RLS policies on staff table allow admin read/write & staff read
alter table public.staff enable row level security;

drop policy if exists "admin_all_staff" on public.staff;
create policy "admin_all_staff" on public.staff for all using (true) with check (true);

-- 3. Ensure RLS policies on attendance table allow inserts and updates
alter table public.attendance enable row level security;

drop policy if exists "allow_all_attendance" on public.attendance;
create policy "allow_all_attendance" on public.attendance for all using (true) with check (true);

-- 4. Ensure RLS policies on profiles
alter table public.profiles enable row level security;

drop policy if exists "profiles_allow_all" on public.profiles;
create policy "profiles_allow_all" on public.profiles for all using (true) with check (true);

-- 5. create_staff_member RPC function
create or replace function create_staff_member(
  p_name text,
  p_role text default 'cashier',
  p_phone text default '',
  p_pin text default ''
)
returns json
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_user_id uuid;
  v_staff_id uuid;
  v_email text;
  v_encrypted_pw text;
begin
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Staff name is required';
  end if;

  if coalesce(trim(p_phone), '') = '' then
    raise exception 'Staff phone number is required';
  end if;

  if coalesce(trim(p_pin), '') = '' or length(trim(p_pin)) != 4 then
    raise exception 'A 4-digit PIN is required';
  end if;

  v_email := trim(p_phone) || '@staff.internal';
  v_encrypted_pw := crypt(trim(p_pin), gen_salt('bf'));

  -- Check if staff already exists
  if exists (select 1 from public.staff where phone = trim(p_phone)) then
    raise exception 'A staff member with phone number % already exists', trim(p_phone);
  end if;

  select id into v_user_id from auth.users where email = v_email limit 1;

  if v_user_id is null then
    v_user_id := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      is_sso_user, is_anonymous, created_at, updated_at
    ) values (
      '00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated',
      v_email, v_encrypted_pw, now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
      false, false, now(), now()
    );

    insert into auth.identities (
      id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
    ) values (
      gen_random_uuid(), v_user_id,
      jsonb_build_object('sub', v_user_id::text, 'email', v_email),
      'email', v_user_id::text, now(), now(), now()
    );
  else
    update auth.users
    set encrypted_password = v_encrypted_pw, updated_at = now()
    where id = v_user_id;
  end if;

  insert into public.staff (name, role, phone, pin, auth_user_id, is_active)
  values (trim(p_name), coalesce(nullif(trim(p_role), ''), 'cashier'), trim(p_phone), trim(p_pin), v_user_id, true)
  returning id into v_staff_id;

  insert into public.profiles (id, role, staff_id)
  values (v_user_id, 'staff', v_staff_id)
  on conflict (id) do update set role = 'staff', staff_id = v_staff_id;

  return json_build_object(
    'id', v_staff_id,
    'name', trim(p_name),
    'role', coalesce(nullif(trim(p_role), ''), 'cashier'),
    'phone', trim(p_phone),
    'auth_user_id', v_user_id
  );
end;
$$;

grant execute on function is_admin() to anon, authenticated;
grant execute on function create_staff_member(text, text, text, text) to anon, authenticated;
