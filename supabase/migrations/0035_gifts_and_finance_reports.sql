-- ============================================================================
-- 0035_gifts_and_finance_reports.sql
--
-- Two additive features, no changes to existing tables/behaviour:
--
-- 1) Gifts — a standalone sellable item type, separate from `inventory`
--    (phones/accessories) and separate from `hamper_items` (bundles of
--    existing inventory products). Gifts have their own price/cost/stock
--    and get sold directly from Sales & Invoices → New Sale, alongside
--    (not instead of) regular inventory items.
--
-- 2) Finance Reports — staff upload a file from the Staff Portal, Admin
--    reviews it from the Admin Portal. Follows the exact same shape as
--    the existing wholesaler-invoices / client-reports bucket pattern.
--    Deliberately NOT reusing `client_reports` (that table is customer-
--    review-workflow specific — title/notes/status/admin_feedback tied to
--    a customer_id) since finance reports have no customer and no review
--    workflow, just upload + view.
--
-- Follows the same "grant all to anon, authenticated + permissive RLS"
-- convention already used for finance_partners (0022) and hamper_products
-- (0019) — the Staff Portal has no real Supabase Auth session (phone+PIN
-- custom login), it calls the DB as `anon`, so a stricter `authenticated`-
-- only policy would silently break every staff write.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Gifts
-- ----------------------------------------------------------------------------
create table if not exists public.gifts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  price numeric not null default 0,       -- sale price
  cost_price numeric not null default 0,  -- what the shop paid, used for profit
  stock integer not null default 0,
  sold_qty integer not null default 0,    -- running total, kept in sync by gift_sales inserts
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.gift_sales (
  id uuid primary key default gen_random_uuid(),
  gift_id uuid not null references public.gifts (id) on delete cascade,
  sale_id uuid references public.sales (id) on delete set null,
  quantity integer not null check (quantity > 0),
  unit_price numeric not null default 0,
  unit_cost numeric not null default 0,
  staff_id uuid references public.staff (id),
  created_at timestamptz not null default now()
);

create index if not exists idx_gift_sales_gift on public.gift_sales (gift_id, created_at desc);
create index if not exists idx_gift_sales_sale on public.gift_sales (sale_id);

alter table public.gifts enable row level security;
alter table public.gift_sales enable row level security;

grant all on public.gifts to anon, authenticated;
grant all on public.gift_sales to anon, authenticated;

drop policy if exists "gifts_select_all" on public.gifts;
create policy "gifts_select_all" on public.gifts for select using (true);
drop policy if exists "gifts_write_authenticated" on public.gifts;
create policy "gifts_write_authenticated" on public.gifts for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "gift_sales_select_all" on public.gift_sales;
create policy "gift_sales_select_all" on public.gift_sales for select using (true);
-- Insert stays open to anon too — recording a gift sale happens from the
-- same Sales & Invoices flow as everything else in this app, which the
-- rest of the codebase (e.g. sales/sale_items) already leaves this open.
drop policy if exists "gift_sales_insert_any" on public.gift_sales;
create policy "gift_sales_insert_any" on public.gift_sales for insert with check (true);
drop policy if exists "gift_sales_manage_authenticated" on public.gift_sales;
create policy "gift_sales_manage_authenticated" on public.gift_sales for update
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
drop policy if exists "gift_sales_delete_authenticated" on public.gift_sales;
create policy "gift_sales_delete_authenticated" on public.gift_sales for delete
  using (auth.role() = 'authenticated');

-- Keep gifts.stock / sold_qty in sync automatically so the app never has to
-- remember to do both writes itself — insert a gift_sales row and the stock
-- moves; delete one (a voided sale) and it reverses.
create or replace function public.apply_gift_sale()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.gifts
  set stock = greatest(stock - new.quantity, 0),
      sold_qty = sold_qty + new.quantity
  where id = new.gift_id;
  return new;
end;
$$;

drop trigger if exists trg_apply_gift_sale on public.gift_sales;
create trigger trg_apply_gift_sale
  after insert on public.gift_sales
  for each row execute function public.apply_gift_sale();

create or replace function public.reverse_gift_sale()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.gifts
  set stock = stock + old.quantity,
      sold_qty = greatest(sold_qty - old.quantity, 0)
  where id = old.gift_id;
  return old;
end;
$$;

drop trigger if exists trg_reverse_gift_sale on public.gift_sales;
create trigger trg_reverse_gift_sale
  after delete on public.gift_sales
  for each row execute function public.reverse_gift_sale();

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'gifts'
  ) then
    alter publication supabase_realtime add table public.gifts;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'gift_sales'
  ) then
    alter publication supabase_realtime add table public.gift_sales;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- Finance Reports
-- ----------------------------------------------------------------------------
create table if not exists public.finance_reports (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid references public.staff (id) on delete set null,
  title text not null,
  notes text,
  file_url text, -- Supabase Storage path in the 'finance-reports' bucket
  created_at timestamptz not null default now()
);

create index if not exists idx_finance_reports_staff on public.finance_reports (staff_id, created_at desc);

alter table public.finance_reports enable row level security;
grant all on public.finance_reports to anon, authenticated;

drop policy if exists "finance_reports_select_all" on public.finance_reports;
create policy "finance_reports_select_all" on public.finance_reports for select using (true);
drop policy if exists "finance_reports_insert_any" on public.finance_reports;
create policy "finance_reports_insert_any" on public.finance_reports for insert with check (true);
drop policy if exists "finance_reports_manage_authenticated" on public.finance_reports;
create policy "finance_reports_manage_authenticated" on public.finance_reports for update
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
drop policy if exists "finance_reports_delete_authenticated" on public.finance_reports;
create policy "finance_reports_delete_authenticated" on public.finance_reports for delete
  using (auth.role() = 'authenticated');

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'finance_reports'
  ) then
    alter publication supabase_realtime add table public.finance_reports;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- Storage: 'finance-reports' bucket — create it manually in the Supabase
-- dashboard (Storage → New bucket → name "finance-reports", PUBLIC — same as
-- the 'product-images' bucket, so the Admin Portal's "View/Download" link
-- can use a plain public URL instead of generating signed URLs). These
-- policies still govern who can insert/update/delete objects in it.
-- ----------------------------------------------------------------------------
drop policy if exists "finance_report_files_read" on storage.objects;
create policy "finance_report_files_read" on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'finance-reports');

drop policy if exists "finance_report_files_insert" on storage.objects;
create policy "finance_report_files_insert" on storage.objects for insert
  to anon, authenticated
  with check (bucket_id = 'finance-reports');

drop policy if exists "finance_report_files_manage" on storage.objects;
create policy "finance_report_files_manage" on storage.objects for update
  to authenticated
  using (bucket_id = 'finance-reports' and auth.role() = 'authenticated');

drop policy if exists "finance_report_files_delete" on storage.objects;
create policy "finance_report_files_delete" on storage.objects for delete
  to authenticated
  using (bucket_id = 'finance-reports' and auth.role() = 'authenticated');

-- ----------------------------------------------------------------------------
-- Wholesaler Invoices: add a phone column so a scanned wholesaler QR/invoice
-- can carry the supplier's phone number too (existing table only had a name).
-- ----------------------------------------------------------------------------
alter table public.wholesaler_invoices add column if not exists wholesaler_phone text;
