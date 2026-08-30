-- ============================================================================
-- 0007_staff_login_rpc.sql  (DRAFT — for review, NOT applied until you run it)
-- Fixes staff PIN login: adds a SECURITY DEFINER RPC that validates
-- phone+PIN server-side and returns only the safe fields the staff app
-- needs. The `staff` table's RLS is NOT changed — no new anon SELECT
-- policy on `staff` is added; PINs remain non-browsable/non-enumerable by
-- anyone. This function is the only sanctioned way in.
--
-- Does not touch 0001-0006, does not modify the `staff` table or its RLS.
-- ============================================================================

create or replace function staff_login(p_phone text, p_pin text)
returns table (id uuid, name text, role text, phone text, is_active boolean)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select s.id, s.name, s.role, s.phone, s.is_active
  from staff s
  where s.phone = p_phone
    and s.pin = p_pin
    and s.is_active = true;
end;
$$;

-- Callable by an unauthenticated visitor (the whole point — this is the
-- pre-login step) and by already-authenticated sessions too.
grant execute on function staff_login(text, text) to anon, authenticated;
