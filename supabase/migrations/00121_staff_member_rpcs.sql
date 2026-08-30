-- ============================================================================
-- 0012_staff_member_rpcs.sql
-- Adds the create_staff_member / update_staff_member / delete_staff_member
-- RPCs that the current Admin "Staff Management" UI calls as its first
-- choice (before falling back to the create-staff Edge Function, then a
-- bare insert with no login capability). This is the tier that was missing
-- — "Could not find the function public.create_staff_member(...) in the
-- schema cache".
--
-- Unlike the Edge Function, this creates the Supabase Auth user by writing
-- directly to auth.users/auth.identities inside a SECURITY DEFINER function.
-- That's an unsupported-by-Supabase (but widely used) pattern — it avoids
-- needing `supabase functions deploy`, at the cost of depending on Supabase
-- Auth's internal schema staying compatible. The Edge Function remains the
-- officially-supported path and is still tried as this RPC's fallback.
-- ============================================================================

-- 0012_create_staff_rpc.sql (applied just before this file) already created
-- create_staff_member/update_staff_member returning json/json; this file
-- redefines them with different return types (staff/void), which
-- CREATE OR REPLACE FUNCTION cannot do — drop first.
drop function if exists create_staff_member(text, text, text, text);
drop function if exists update_staff_member(uuid, text, text, text, text, boolean);

create or replace function create_staff_member(
  p_name text,
  p_role text,
  p_phone text,
  p_pin text
)
returns staff
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid;
  v_email text;
  v_staff staff;
begin
  if not is_admin() then
    raise exception 'Only admin can create staff';
  end if;
  if p_phone is null or p_phone = '' then
    raise exception 'Phone is required';
  end if;
  if p_pin !~ '^[0-9]{4}$' then
    raise exception 'PIN must be exactly 4 digits';
  end if;

  v_user_id := gen_random_uuid();
  v_email := p_phone || '@staff.internal';

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, is_sso_user, is_anonymous
  ) values (
    '00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated',
    v_email, crypt(p_pin, gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false, false
  );

  insert into auth.identities (
    id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid(), v_user_id,
    jsonb_build_object('sub', v_user_id::text, 'email', v_email),
    'email', v_user_id::text, now(), now(), now()
  );

  insert into staff (id, name, role, phone, pin, auth_user_id, is_active)
  values (gen_random_uuid(), p_name, coalesce(nullif(p_role, ''), 'cashier'), p_phone, p_pin, v_user_id, true)
  returning * into v_staff;

  insert into profiles (id, role, staff_id) values (v_user_id, 'staff', v_staff.id);

  return v_staff;
end;
$$;

create or replace function update_staff_member(
  p_staff_id uuid,
  p_name text,
  p_role text,
  p_phone text,
  p_pin text,
  p_is_active boolean
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_auth_id uuid;
begin
  if not is_admin() then
    raise exception 'Only admin can update staff';
  end if;

  select auth_user_id into v_auth_id from staff where id = p_staff_id;

  update staff
  set name = coalesce(nullif(p_name, ''), name),
      role = coalesce(nullif(p_role, ''), role),
      phone = coalesce(nullif(p_phone, ''), phone),
      is_active = p_is_active,
      pin = case when p_pin is not null and p_pin <> '' then p_pin else pin end
  where id = p_staff_id;

  if p_pin is not null and p_pin <> '' and v_auth_id is not null then
    if p_pin !~ '^[0-9]{4}$' then
      raise exception 'PIN must be exactly 4 digits';
    end if;
    update auth.users
    set encrypted_password = crypt(p_pin, gen_salt('bf')), updated_at = now()
    where id = v_auth_id;
  end if;
end;
$$;

create or replace function delete_staff_member(p_staff_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'Only admin can remove staff';
  end if;
  -- Deactivate rather than hard-delete — preserves sales/attendance history
  -- tied to this staff_id (matches the app's own "Deactivate or Remove"
  -- fallback behavior for tier 2/3 of the same action).
  update staff set is_active = false where id = p_staff_id;
end;
$$;
