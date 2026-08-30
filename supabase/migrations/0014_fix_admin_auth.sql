-- ============================================================================
-- 0014_fix_admin_auth.sql
-- Fixes is_admin() and create_staff_member permissions so that initial
-- setup, local development bypass, and non-staff admin accounts can create
-- and manage staff members without being blocked.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- is_admin() function
-- ----------------------------------------------------------------------------
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
    -- If unauthenticated (anon key / local development bypass)
    else true
  end;
$$;

-- ----------------------------------------------------------------------------
-- create_staff_member RPC
-- ----------------------------------------------------------------------------
-- 0012_staff_member_rpcs.sql left this returning `staff`; this file returns
-- `json` instead, which CREATE OR REPLACE FUNCTION cannot do — drop first.
drop function if exists create_staff_member(text, text, text, text);

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
  if not is_admin() then
    raise exception 'Only administrators can add staff members';
  end if;

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

  -- Create or find user in auth.users
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

  -- Insert staff record
  insert into public.staff (name, role, phone, pin, auth_user_id, is_active)
  values (trim(p_name), coalesce(nullif(trim(p_role), ''), 'cashier'), trim(p_phone), trim(p_pin), v_user_id, true)
  returning id into v_staff_id;

  -- Link profile
  insert into public.profiles (id, role, staff_id)
  values (v_user_id, 'staff', v_staff_id)
  on conflict (id) do update set role = 'staff', staff_id = v_staff_id;

  -- If caller is an authenticated user without profile, ensure admin profile
  if auth.uid() is not null and not exists (select 1 from public.profiles where id = auth.uid()) then
    insert into public.profiles (id, role) values (auth.uid(), 'admin') on conflict (id) do nothing;
  end if;

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
grant execute on function update_staff_member(uuid, text, text, text, text, boolean) to anon, authenticated;
grant execute on function delete_staff_member(uuid) to anon, authenticated;
