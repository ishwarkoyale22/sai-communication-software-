-- ============================================================================
-- 0001_admin_auth_and_staff.sql  (DRAFT — for review, not applied)
-- Adds Supabase-Auth-backed admin/staff identity on top of the existing
-- live schema. Does not touch products/brands/settings/customers/etc.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- profiles: links a Supabase Auth user to a role (admin | staff)
-- ----------------------------------------------------------------------------
create table if not exists profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('admin', 'staff')),
  staff_id uuid,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- staff
-- ----------------------------------------------------------------------------
create table if not exists staff (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  role text not null default 'cashier',
  phone text not null unique,
  pin text not null,
  auth_user_id uuid references auth.users (id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_staff_id_fkey') then
    alter table profiles
      add constraint profiles_staff_id_fkey foreign key (staff_id) references staff (id) on delete cascade;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- Helper functions used by every RLS policy below/in later files
-- ----------------------------------------------------------------------------
create or replace function is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin'
  );
$$;

create or replace function is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role in ('admin', 'staff')
  );
$$;

create or replace function current_staff_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select staff_id from profiles where id = auth.uid();
$$;

-- ----------------------------------------------------------------------------
-- RLS: profiles / staff (no public exposure — admin/staff only)
-- ----------------------------------------------------------------------------
alter table profiles enable row level security;

drop policy if exists "self_read_profile" on profiles;
create policy "self_read_profile" on profiles for select
  using (id = auth.uid());

drop policy if exists "admin_all_profiles" on profiles;
create policy "admin_all_profiles" on profiles for all
  using (is_admin()) with check (is_admin());

alter table staff enable row level security;

drop policy if exists "admin_all_staff" on staff;
create policy "admin_all_staff" on staff for all
  using (is_admin()) with check (is_admin());

drop policy if exists "staff_read_own_row" on staff;
create policy "staff_read_own_row" on staff for select
  using (is_staff() and id = current_staff_id());
