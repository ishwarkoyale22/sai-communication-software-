-- Branches, Suppliers, Settings — confirmed via the user that this is a
-- single-shop business today (no evidence of multiple locations, and the
-- website's own dead admin's Branches/Transfers/Suppliers/Sources tabs
-- were never backed by real tables even before this). Scoped deliberately
-- light: a simple branch directory (no stock-transfer machinery, which
-- would be pure speculative complexity for a business that doesn't have
-- a second location yet), a supplier directory, and a key-value settings
-- store matching exactly what the website's settingsQuery already expects
-- (key/value columns — confirmed in src/lib/queries.ts) so the homepage's
-- owner story / social links / address / maps embed become editable
-- without a code deploy, instead of permanently running on hardcoded
-- fallback text.

create table if not exists public.branches (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  phone text,
  is_main boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact_person text,
  phone text,
  email text,
  address text,
  gst_number text,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.settings (
  key text primary key,
  value text,
  updated_at timestamptz not null default now()
);

alter table public.branches enable row level security;
alter table public.suppliers enable row level security;
alter table public.settings enable row level security;

-- Same blanket-grant + RLS-does-the-real-gating pattern as every other new
-- table added since 0019 (this project has no default privileges for
-- anon/authenticated on a freshly created table — see hamper_products'
-- comment in 0019 for the full explanation).
grant all on public.branches to anon, authenticated;
grant all on public.suppliers to anon, authenticated;
grant all on public.settings to anon, authenticated;

-- Branches/Suppliers are internal-only (no public storefront reason to
-- read either) — authenticated (admin) only, both ways.
drop policy if exists "branches_authenticated_all" on public.branches;
create policy "branches_authenticated_all" on public.branches
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "suppliers_authenticated_all" on public.suppliers;
create policy "suppliers_authenticated_all" on public.suppliers
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- Settings ARE read by the public website's homepage (owner story, social
-- links, address, maps embed) — public read, admin-only write.
drop policy if exists "settings_select_all" on public.settings;
create policy "settings_select_all" on public.settings for select using (true);
drop policy if exists "settings_write_authenticated" on public.settings;
create policy "settings_write_authenticated" on public.settings for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'branches') then
    alter publication supabase_realtime add table public.branches;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'suppliers') then
    alter publication supabase_realtime add table public.suppliers;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'settings') then
    alter publication supabase_realtime add table public.settings;
  end if;
end $$;

-- Seed exactly one branch (your current shop) so the concept isn't empty
-- on first load — editable/renameable from the new admin page.
insert into public.branches (name, is_main, is_active)
select 'Main Branch', true, true
where not exists (select 1 from public.branches);

-- Deliberately NOT seeding `settings` — the website already has working
-- hardcoded fallback text for every key it reads (DEFAULT_SETTINGS in
-- src/lib/queries.ts), so leaving this empty changes nothing visually
-- until the shop owner actually edits something from the new admin page.
