-- Dashboard "Target Progress Bars" — admin-settable revenue milestones per
-- period (daily/weekly/monthly), so progress can be computed against a
-- real number instead of a hardcoded one. One row per period, upserted
-- from the Dashboard's own inline editor.

create table if not exists public.sales_targets (
  period text primary key check (period in ('daily', 'weekly', 'monthly')),
  target_amount numeric not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.sales_targets enable row level security;

-- Same blanket-grant + RLS pattern as every other new table since 0019.
grant all on public.sales_targets to anon, authenticated;

drop policy if exists "sales_targets_authenticated_all" on public.sales_targets;
create policy "sales_targets_authenticated_all" on public.sales_targets
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sales_targets'
  ) then
    alter publication supabase_realtime add table public.sales_targets;
  end if;
end $$;

insert into public.sales_targets (period, target_amount)
values ('daily', 0), ('weekly', 0), ('monthly', 0)
on conflict (period) do nothing;
