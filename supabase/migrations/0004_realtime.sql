-- ============================================================================
-- 0004_realtime.sql
-- Enable Supabase Realtime on tables the UIs subscribe to
-- ============================================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'products'
  ) then
    alter publication supabase_realtime add table products;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sales'
  ) then
    alter publication supabase_realtime add table sales;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'repairs'
  ) then
    alter publication supabase_realtime add table repairs;
  end if;
end $$;
