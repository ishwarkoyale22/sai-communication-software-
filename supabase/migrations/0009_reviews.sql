-- ============================================================================
-- 0009_reviews.sql
-- Public online customer reviews (client requirement #4). Distinct from the
-- existing `customer_notes` table, which is internal staff notes about a
-- customer — this is a customer-submitted, admin-moderated public review.
-- ============================================================================

create table if not exists reviews (
  id uuid primary key default gen_random_uuid(),
  customer_name text not null,
  phone text,
  rating integer not null check (rating between 1 and 5),
  comment text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);

create index if not exists idx_reviews_status on reviews (status);

alter table reviews enable row level security;

-- anyone can submit a review
drop policy if exists "public_insert_reviews" on reviews;
create policy "public_insert_reviews" on reviews for insert
  to anon
  with check (true);

-- anyone (including the website) can read approved reviews, e.g. a
-- "Customer Stories" section — pending/rejected stay admin-only
drop policy if exists "public_read_approved_reviews" on reviews;
create policy "public_read_approved_reviews" on reviews for select
  to anon
  using (status = 'approved');

-- admin manages everything (approve/reject/delete)
drop policy if exists "admin_all_reviews" on reviews;
create policy "admin_all_reviews" on reviews for all using (is_admin()) with check (is_admin());

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'reviews'
  ) then
    alter publication supabase_realtime add table reviews;
  end if;
end $$;
