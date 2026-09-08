-- Finance Partners (checkout's EMI step already queries this table in the
-- website repo — src/lib/queries.ts financePartnersQuery / src/lib/types.ts
-- FinancePartner — this migration creates the table that code has been
-- expecting all along). Column names match that type exactly.

create table if not exists public.finance_partners (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  logo_url text,
  min_amount numeric,
  max_amount numeric,
  available_tenures integer[] not null default '{3,6,9,12,18,24}',
  processing_fee_pct numeric not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.finance_partners enable row level security;

-- New table — see hamper_products in 0019 for why this blanket grant is
-- required here (RLS policies below do the real per-row/per-role gating).
grant all on public.finance_partners to anon, authenticated;

-- Public (website checkout, anon) reads only active partners; admin
-- (authenticated) manages everything.
drop policy if exists "finance_partners_select_all" on public.finance_partners;
create policy "finance_partners_select_all" on public.finance_partners
  for select using (true);
drop policy if exists "finance_partners_write_authenticated" on public.finance_partners;
create policy "finance_partners_write_authenticated" on public.finance_partners
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'finance_partners'
  ) then
    alter publication supabase_realtime add table public.finance_partners;
  end if;
end $$;

-- Seed the 6 requested partners. All the partner-specific numbers below
-- (min/max amount, tenures, processing fee, description, logo) are just
-- starting defaults — deliberately editable from the new admin page
-- afterwards, not hardcoded anywhere in app code.
insert into public.finance_partners (name, description, min_amount, max_amount, available_tenures, processing_fee_pct, is_active)
select v.name, v.description, v.min_amount, v.max_amount, v.available_tenures, v.processing_fee_pct, true
from (values
  ('Bajaj Finance', 'No-cost EMI on select devices.', 3000, 200000, array[3,6,9,12,18,24], 0),
  ('IDFC FIRST Bank', 'Bank-backed EMI with competitive rates.', 5000, 300000, array[3,6,9,12,18,24], 1),
  ('TVS Credit', 'Quick approval EMI for mobiles & accessories.', 3000, 150000, array[3,6,9,12], 1.5),
  ('Home Credit', 'Instant EMI, minimal documentation.', 3000, 100000, array[3,6,9,12], 2),
  ('DMI Finance', 'Digital-first EMI approval.', 3000, 150000, array[3,6,9,12,18], 1.5),
  ('Poonawalla Fincorp', 'Flexible tenure EMI plans.', 3000, 200000, array[3,6,9,12,18,24], 1)
) as v(name, description, min_amount, max_amount, available_tenures, processing_fee_pct)
where not exists (select 1 from public.finance_partners fp where fp.name = v.name);
