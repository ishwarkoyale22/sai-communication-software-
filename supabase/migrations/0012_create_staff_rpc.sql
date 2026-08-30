-- ============================================================================
-- 0012_create_staff_rpc.sql
-- Native PostgreSQL RPC functions for staff provisioning and management.
-- Allows Admin to atomically create, update, and manage staff members + auth
-- accounts without requiring external Edge Function deployment.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- create_staff_member: Creates auth user, staff record, and profile
-- ----------------------------------------------------------------------------
-- The remote DB may already have these functions (from a later migration
-- applied out of order, e.g. 0012_staff_member_rpcs.sql) with a different
-- return type. CREATE OR REPLACE FUNCTION cannot change a return type, so
-- drop first, in either direction.
drop function if exists create_staff_member(text, text, text, text);
drop function if exists update_staff_member(uuid, text, text, text, text, boolean);

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
  v_user_id := gen_random_uuid();
  v_encrypted_pw := crypt(trim(p_pin), gen_salt('bf'));

  -- Check if staff with this phone already exists in public.staff
  if exists (select 1 from public.staff where phone = trim(p_phone)) then
    raise exception 'A staff member with phone number % already exists', trim(p_phone);
  end if;

  -- Create or reuse auth user if existing
  select id into v_user_id from auth.users where email = v_email limit 1;

  if v_user_id is null then
    v_user_id := gen_random_uuid();
    insert into auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at
    ) values (
      '00000000-0000-0000-0000-000000000000',
      v_user_id,
      'authenticated',
      'authenticated',
      v_email,
      v_encrypted_pw,
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{}'::jsonb,
      now(),
      now()
    );
  else
    -- Update password in case of recreation
    update auth.users
    set encrypted_password = v_encrypted_pw,
        updated_at = now()
    where id = v_user_id;
  end if;

  -- Insert staff record
  insert into public.staff (name, role, phone, pin, auth_user_id, is_active)
  values (trim(p_name), coalesce(nullif(trim(p_role), ''), 'cashier'), trim(p_phone), trim(p_pin), v_user_id, true)
  returning id into v_staff_id;

  -- Link profile
  insert into public.profiles (id, role, staff_id)
  values (v_user_id, 'staff', v_staff_id)
  on conflict (id) do update
  set role = 'staff', staff_id = v_staff_id;

  return json_build_object(
    'id', v_staff_id,
    'name', trim(p_name),
    'role', coalesce(nullif(trim(p_role), ''), 'cashier'),
    'phone', trim(p_phone),
    'auth_user_id', v_user_id
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- update_staff_member: Update details, PIN, or active status
-- ----------------------------------------------------------------------------
create or replace function update_staff_member(
  p_staff_id uuid,
  p_name text,
  p_role text default 'cashier',
  p_phone text default '',
  p_pin text default '',
  p_is_active boolean default true
)
returns json
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_auth_user_id uuid;
  v_old_phone text;
  v_new_email text;
  v_encrypted_pw text;
begin
  if not is_admin() then
    raise exception 'Only administrators can update staff members';
  end if;

  select auth_user_id, phone into v_auth_user_id, v_old_phone
  from public.staff
  where id = p_staff_id;

  if not found then
    raise exception 'Staff member not found';
  end if;

  -- Update public.staff
  update public.staff
  set name = coalesce(nullif(trim(p_name), ''), name),
      role = coalesce(nullif(trim(p_role), ''), role),
      phone = coalesce(nullif(trim(p_phone), ''), phone),
      pin = case when p_pin is not null and length(trim(p_pin)) = 4 then trim(p_pin) else pin end,
      is_active = coalesce(p_is_active, is_active)
  where id = p_staff_id;

  -- Update auth.users if phone changed or PIN changed
  if v_auth_user_id is not null then
    if p_phone is not null and trim(p_phone) != '' and trim(p_phone) != v_old_phone then
      v_new_email := trim(p_phone) || '@staff.internal';
      update auth.users set email = v_new_email, updated_at = now() where id = v_auth_user_id;
    end if;

    if p_pin is not null and length(trim(p_pin)) = 4 then
      v_encrypted_pw := crypt(trim(p_pin), gen_salt('bf'));
      update auth.users set encrypted_password = v_encrypted_pw, updated_at = now() where id = v_auth_user_id;
    end if;
  end if;

  return json_build_object(
    'id', p_staff_id,
    'name', p_name,
    'role', p_role,
    'phone', p_phone,
    'is_active', p_is_active
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- delete_staff_member: Deactivates or removes a staff member
-- ----------------------------------------------------------------------------
create or replace function delete_staff_member(
  p_staff_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_auth_user_id uuid;
begin
  if not is_admin() then
    raise exception 'Only administrators can delete staff members';
  end if;

  select auth_user_id into v_auth_user_id from public.staff where id = p_staff_id;

  -- Soft delete by marking inactive, or remove if no sales/attendance records
  update public.staff set is_active = false where id = p_staff_id;

  if v_auth_user_id is not null then
    delete from public.profiles where id = v_auth_user_id;
    delete from auth.users where id = v_auth_user_id;
  end if;

  -- Try hard delete if no foreign key constraints violate
  begin
    delete from public.staff where id = p_staff_id;
  exception when others then
    -- Kept as is_active = false if foreign key constraints exist
    null;
  end;
end;
$$;

-- Grant permissions to authenticated users (admin role check is inside the functions)
grant execute on function create_staff_member(text, text, text, text) to authenticated;
grant execute on function update_staff_member(uuid, text, text, text, text, boolean) to authenticated;
grant execute on function delete_staff_member(uuid) to authenticated;
