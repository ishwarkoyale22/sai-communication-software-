-- staff_add_client used to surface the raw "duplicate key value violates unique
-- constraint customers_phone_key" error when a phone number already existed, and
-- accepted junk phone numbers. Return readable messages instead.
create or replace function public.staff_add_client(p_token uuid, p_name text, p_phone text, p_notes text default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff_id uuid := resolve_staff_session(p_token);
  v_id uuid;
  v_phone text := regexp_replace(coalesce(p_phone, ''), '\s', '', 'g');
  v_owner uuid;
begin
  if p_name is null or length(trim(p_name)) = 0 then
    return json_build_object('success', false, 'error', 'Client name is required.');
  end if;
  if v_phone !~ '^[6-9][0-9]{9}$' then
    return json_build_object('success', false, 'error', 'Enter a valid 10-digit mobile number.');
  end if;

  select id, owner_staff_id into v_id, v_owner from customers where phone = v_phone;
  if v_id is not null then
    return json_build_object('success', false, 'error',
      case when v_owner is null or v_owner = v_staff_id
           then 'This customer is already in your list.'
           else 'This phone number is already registered to another staff member''s client. Ask the admin.' end);
  end if;

  insert into customers (name, phone, notes, owner_staff_id)
  values (trim(p_name), v_phone, p_notes, v_staff_id)
  returning id into v_id;

  insert into staff_activity_log (staff_id, action, details)
  values (v_staff_id, 'client_added', json_build_object('customer_id', v_id, 'name', trim(p_name)));

  return json_build_object('success', true, 'customer_id', v_id);
end;
$$;

grant execute on function public.staff_add_client(uuid, text, text, text) to anon, authenticated;
