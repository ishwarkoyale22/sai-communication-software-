-- ============================================================================
-- 0013_ensure_admin_profile.sql
-- Automatically ensures that authenticated admin users have an active admin
-- profile in public.profiles. Fixes the issue where valid email/password
-- logins get rejected with "Not authorized as admin".
-- ============================================================================

create or replace function ensure_admin_profile()
returns json
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_uid uuid;
  v_email text;
  v_role text;
begin
  v_uid := auth.uid();
  if v_uid is null then
    return json_build_object('error', 'Not authenticated');
  end if;

  select email into v_email from auth.users where id = v_uid;
  select role into v_role from public.profiles where id = v_uid;

  if v_role is null then
    -- If this is a store admin/owner account (not a staff internal phone account)
    if v_email not like '%@staff.internal' then
      v_role := 'admin';
    else
      v_role := 'staff';
    end if;

    insert into public.profiles (id, role)
    values (v_uid, v_role)
    on conflict (id) do update set role = excluded.role;
  end if;

  return json_build_object('id', v_uid, 'role', v_role);
end;
$$;

grant execute on function ensure_admin_profile() to authenticated;

-- Ensure RLS allows user to insert/update their own profile
drop policy if exists "profiles_self_insert" on profiles;
create policy "profiles_self_insert" on profiles for insert with check (auth.uid() = id);

drop policy if exists "profiles_self_update" on profiles;
create policy "profiles_self_update" on profiles for update using (auth.uid() = id);
