-- ============================================================================
-- 0037_gst_offers_products_staff_signup_birthday.sql
--
-- Four independent, additive changes:
--
-- 1) sales.gst_rate — lets New Sale pick the GST% per sale instead of the
--    hardcoded 18% previously baked into packages/shared/retailTaxInvoice.ts.
--    Existing rows default to 18, so every past invoice reprints identically.
--
-- 2) offer_products — a join table so one Offer can carry ANY number of
--    existing inventory products (0..N), mirroring hamper_products (0019)
--    exactly. No new product system — same `inventory` rows.
--
-- 3) staff.date_of_birth + a public self-registration RPC. New accounts land
--    with is_active = false (same flag StaffManagement.tsx already uses to
--    activate/deactivate), so admin approval is just flipping that switch —
--    reusing the exact existing approval mechanism, not a new one.
--
-- 4) Birthday RPCs — staff_get_birthdays_today / staff_send_birthday_wish.
--    The Staff Portal never queries `staff` directly (anon has no SELECT
--    policy there — see admin_all_staff), so this needs the same
--    security-definer + resolve_staff_session(p_token) pattern as every
--    other staff RPC (client_reports, followups, etc.), returning id+name
--    only — no phone/salary/pin exposed.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Dynamic GST per sale
-- ----------------------------------------------------------------------------
alter table public.sales add column if not exists gst_rate numeric not null default 18;

-- ----------------------------------------------------------------------------
-- 2) Offers — multiple products
-- ----------------------------------------------------------------------------
create table if not exists public.offer_products (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.offers (id) on delete cascade,
  inventory_id uuid not null references public.inventory (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (offer_id, inventory_id)
);

alter table public.offer_products enable row level security;
grant all on public.offer_products to anon, authenticated;

drop policy if exists "offer_products_select_all" on public.offer_products;
create policy "offer_products_select_all" on public.offer_products for select using (true);
drop policy if exists "offer_products_write_authenticated" on public.offer_products;
create policy "offer_products_write_authenticated" on public.offer_products for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'offer_products'
  ) then
    alter publication supabase_realtime add table public.offer_products;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 3) Staff self-registration + Date of Birth
-- ----------------------------------------------------------------------------
alter table public.staff add column if not exists date_of_birth date;

create or replace function public.staff_register(
  p_name text,
  p_phone text,
  p_email text,
  p_pin text,
  p_date_of_birth date default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_name is null or length(trim(p_name)) = 0 then
    return json_build_object('success', false, 'error', 'Full name is required.');
  end if;
  if p_phone is null or length(trim(p_phone)) < 10 then
    return json_build_object('success', false, 'error', 'A valid mobile number is required.');
  end if;
  if p_pin is null or p_pin !~ '^[0-9]{4}$' then
    return json_build_object('success', false, 'error', 'Password must be a 4-digit PIN, matching how you will log in.');
  end if;
  if exists (select 1 from staff where phone = trim(p_phone)) then
    return json_build_object('success', false, 'error', 'An account with this mobile number already exists.');
  end if;

  -- is_active = false: same flag/approval mechanism StaffManagement.tsx
  -- already uses on the Admin Portal — admin approves by activating it,
  -- no separate approval system introduced.
  insert into staff (name, phone, email, pin, date_of_birth, role, is_active)
  values (trim(p_name), trim(p_phone), nullif(trim(p_email), ''), p_pin, p_date_of_birth, 'staff', false)
  returning id into v_id;

  return json_build_object('success', true, 'staff_id', v_id);
end;
$$;

grant execute on function public.staff_register(text, text, text, text, date) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4) Birthdays
-- ----------------------------------------------------------------------------
create or replace function public.staff_get_birthdays_today(p_token uuid)
returns table (id uuid, name text, is_self boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff_id uuid := resolve_staff_session(p_token);
begin
  return query
    select s.id, s.name, (s.id = v_staff_id) as is_self
    from staff s
    where s.is_active = true
      and s.date_of_birth is not null
      and extract(month from s.date_of_birth) = extract(month from now())
      and extract(day from s.date_of_birth) = extract(day from now());
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
begin
  select name into v_from_name from staff where id = v_staff_id;

  insert into notifications (staff_id, type, title, body, related_id)
  values (p_to_staff_id, 'birthday_wish', 'Happy Birthday! 🎂', coalesce(v_from_name, 'A colleague') || ' wished you a happy birthday!', v_staff_id);

  return json_build_object('success', true);
end;
$$;

grant execute on function public.staff_get_birthdays_today(uuid) to anon, authenticated;
grant execute on function public.staff_send_birthday_wish(uuid, uuid) to anon, authenticated;
