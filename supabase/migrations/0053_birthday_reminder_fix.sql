-- Birthday reminder fixes:
--  * "today" is now the shop's (India) date, not UTC — birthdays used to flip
--    at 5:30 AM IST and be missing/stale in the morning.
--  * A wish is sent at most once per sender→recipient per day (the button used
--    to re-enable on every visit to Home and each click created a new alert).
--  * You can't wish yourself, and only someone whose birthday is today.
--  * staff_get_birthdays_today now also says whether the caller already wished
--    each person, so "Wished ✓" survives navigation and re-login.
drop function if exists public.staff_get_birthdays_today(uuid);

create or replace function public.staff_get_birthdays_today(p_token uuid)
returns table (id uuid, name text, is_self boolean, already_wished boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff_id uuid := resolve_staff_session(p_token);
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  return query
    select s.id, s.name, (s.id = v_staff_id) as is_self,
           exists (
             select 1 from notifications n
             where n.staff_id = s.id and n.type = 'birthday_wish'
               and n.related_id = v_staff_id
               and (n.created_at at time zone 'Asia/Kolkata')::date = v_today
           ) as already_wished
    from staff s
    where s.is_active = true
      and s.date_of_birth is not null
      and extract(month from s.date_of_birth) = extract(month from v_today)
      and extract(day from s.date_of_birth) = extract(day from v_today);
end;
$$;

create or replace function public.staff_send_birthday_wish(p_token uuid, p_to_staff_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff_id uuid := resolve_staff_session(p_token);
  v_from_name text;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if p_to_staff_id = v_staff_id then
    return json_build_object('success', false, 'error', 'You cannot wish yourself');
  end if;
  if not exists (
    select 1 from staff s
    where s.id = p_to_staff_id and s.is_active and s.date_of_birth is not null
      and extract(month from s.date_of_birth) = extract(month from v_today)
      and extract(day from s.date_of_birth) = extract(day from v_today)
  ) then
    return json_build_object('success', false, 'error', 'It is not their birthday today');
  end if;
  if exists (
    select 1 from notifications n
    where n.staff_id = p_to_staff_id and n.type = 'birthday_wish' and n.related_id = v_staff_id
      and (n.created_at at time zone 'Asia/Kolkata')::date = v_today
  ) then
    return json_build_object('success', true, 'duplicate', true);
  end if;

  select name into v_from_name from staff where id = v_staff_id;
  insert into notifications (staff_id, type, title, body, related_id)
  values (p_to_staff_id, 'birthday_wish', 'Happy Birthday! 🎂',
          coalesce(v_from_name, 'A colleague') || ' wished you a happy birthday!', v_staff_id);
  return json_build_object('success', true);
end;
$$;

grant execute on function public.staff_get_birthdays_today(uuid) to anon, authenticated;
grant execute on function public.staff_send_birthday_wish(uuid, uuid) to anon, authenticated;
