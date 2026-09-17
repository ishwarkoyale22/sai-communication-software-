-- Recycle Bin: a generic soft-delete snapshot table. Instead of adding a
-- deleted_at column to every entity table (which would force auditing every
-- existing SELECT across the app to filter it out), a delete on a protected
-- entity table snapshots the full row here first, then hard-deletes it as
-- before. Restoring re-inserts the snapshot into its source table. This
-- keeps every existing read query correct with zero changes, since deleted
-- rows are genuinely gone from their source table until restored.

create table if not exists public.recycle_bin (
  id uuid primary key default gen_random_uuid(),
  table_name text not null,
  record_id text not null,
  label text,
  data jsonb not null,
  deleted_by uuid references auth.users(id),
  deleted_at timestamptz not null default now()
);

create index if not exists recycle_bin_table_name_idx on public.recycle_bin(table_name);

alter table public.recycle_bin enable row level security;

drop policy if exists "admin_all_recycle_bin" on public.recycle_bin;
create policy "admin_all_recycle_bin" on public.recycle_bin
  for all using (is_admin()) with check (is_admin());

grant all on public.recycle_bin to authenticated, anon;
