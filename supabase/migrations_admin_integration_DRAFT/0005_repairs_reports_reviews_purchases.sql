-- ============================================================================
-- 0005_repairs_reports_reviews_purchases.sql  (DRAFT — for review)
-- New: repairs (work-order tracking, linked to existing repair_enquiries),
-- client_reports, reviews, third_party_purchases, wholesaler_invoices,
-- invoice_items. Reuses existing live `suppliers` table as-is.
-- Depends on: 0001, 0002.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- repairs: admin/staff work-order tracking. Separate from the existing
-- `repair_enquiries` table (which stays exactly as the website uses it for
-- intake) — linked via repair_enquiry_id so the original customer message
-- is never duplicated or altered.
-- ----------------------------------------------------------------------------
create table if not exists repairs (
  id uuid primary key default gen_random_uuid(),
  repair_number text not null unique,
  repair_enquiry_id uuid references repair_enquiries (id) on delete set null,
  customer_id uuid references customers (id),
  assigned_staff uuid references staff (id),
  device_name text not null,
  issue_description text,
  estimated_cost numeric(12, 2),
  final_cost numeric(12, 2),
  status text not null default 'received' check (
    status in ('received', 'in_progress', 'waiting_parts', 'ready', 'collected')
  ),
  received_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_repairs_status on repairs (status);

alter table repairs enable row level security;

drop policy if exists "admin_all_repairs" on repairs;
create policy "admin_all_repairs" on repairs for all
  using (is_admin()) with check (is_admin());

drop policy if exists "staff_manage_assigned_repairs" on repairs;
create policy "staff_manage_assigned_repairs" on repairs for all
  using (is_staff() and assigned_staff = current_staff_id())
  with check (is_staff() and assigned_staff = current_staff_id());

-- repair_enquiries: reuse existing live table as-is; add admin/staff read
-- access only (public insert policy from the website is untouched)
drop policy if exists "admin_all_repair_enquiries" on repair_enquiries;
create policy "admin_all_repair_enquiries" on repair_enquiries for all
  using (is_admin()) with check (is_admin());

drop policy if exists "staff_read_repair_enquiries" on repair_enquiries;
create policy "staff_read_repair_enquiries" on repair_enquiries for select
  using (is_staff());

-- ----------------------------------------------------------------------------
-- client_reports
-- ----------------------------------------------------------------------------
create table if not exists client_reports (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers (id) on delete cascade,
  staff_id uuid not null references staff (id),
  title text not null,
  notes text,
  file_url text, -- Supabase Storage path, bucket 'client-reports' (create manually)
  created_at timestamptz not null default now()
);

create index if not exists idx_client_reports_customer on client_reports (customer_id, created_at desc);

alter table client_reports enable row level security;

drop policy if exists "admin_all_client_reports" on client_reports;
create policy "admin_all_client_reports" on client_reports for all
  using (is_admin()) with check (is_admin());

drop policy if exists "staff_insert_client_reports" on client_reports;
create policy "staff_insert_client_reports" on client_reports for insert
  with check (is_staff() and staff_id = current_staff_id());

drop policy if exists "staff_read_own_client_reports" on client_reports;
create policy "staff_read_own_client_reports" on client_reports for select
  using (is_staff() and staff_id = current_staff_id());

-- ----------------------------------------------------------------------------
-- reviews: public-submitted, admin-moderated. No existing equivalent live.
-- ----------------------------------------------------------------------------
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

drop policy if exists "public_insert_reviews" on reviews;
create policy "public_insert_reviews" on reviews for insert
  to anon with check (true);

drop policy if exists "public_read_approved_reviews" on reviews;
create policy "public_read_approved_reviews" on reviews for select
  to anon using (status = 'approved');

drop policy if exists "admin_all_reviews" on reviews;
create policy "admin_all_reviews" on reviews for all
  using (is_admin()) with check (is_admin());

-- ----------------------------------------------------------------------------
-- third_party_purchases: deliberately a NEW/different table from the
-- existing live `third_party_sources` (which is a website sourcing-
-- attribution table, not vendor purchase bookkeeping) — no reuse, no clash.
-- ----------------------------------------------------------------------------
create table if not exists third_party_purchases (
  id uuid primary key default gen_random_uuid(),
  vendor_name text not null,
  item_description text,
  amount numeric(12, 2) not null default 0,
  category text,
  date date not null default current_date,
  notes text,
  created_by uuid references auth.users (id)
);

alter table third_party_purchases enable row level security;

drop policy if exists "admin_all_third_party_purchases" on third_party_purchases;
create policy "admin_all_third_party_purchases" on third_party_purchases for all
  using (is_admin()) with check (is_admin());

-- ----------------------------------------------------------------------------
-- wholesaler_invoices + invoice_items. Reuses existing live `suppliers`
-- table as-is via supplier_id.
-- ----------------------------------------------------------------------------
create table if not exists wholesaler_invoices (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid references suppliers (id),
  supplier_name text not null,
  invoice_number text,
  invoice_date date,
  total_amount numeric(12, 2),
  file_url text, -- Supabase Storage path, bucket 'wholesaler-invoices' (create manually)
  processed boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references wholesaler_invoices (id) on delete cascade,
  product_id uuid references products (id),
  product_name text not null,
  qty integer not null default 0,
  unit_cost numeric(12, 2) not null default 0
);

create index if not exists idx_invoice_items_invoice on invoice_items (invoice_id);

alter table wholesaler_invoices enable row level security;
alter table invoice_items enable row level security;

drop policy if exists "admin_all_wholesaler_invoices" on wholesaler_invoices;
create policy "admin_all_wholesaler_invoices" on wholesaler_invoices for all
  using (is_admin()) with check (is_admin());

drop policy if exists "admin_all_invoice_items" on invoice_items;
create policy "admin_all_invoice_items" on invoice_items for all
  using (is_admin()) with check (is_admin());

create or replace function process_wholesaler_invoice(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  item record;
  v_new_qty integer;
begin
  if not is_admin() then
    raise exception 'Only admin can process wholesaler invoices';
  end if;

  for item in
    select * from invoice_items where invoice_id = p_invoice_id
  loop
    if item.product_id is not null then
      update products
      set stock_qty = stock_qty + item.qty,
          purchase_price = item.unit_cost
      where id = item.product_id
      returning stock_qty into v_new_qty;

      insert into stock_movements (product_id, change_qty, resulting_qty, movement_type, reference_table, reference_id)
      values (item.product_id, item.qty, v_new_qty, 'purchase', 'invoice_items', item.id);
    end if;
  end loop;

  update wholesaler_invoices set processed = true where id = p_invoice_id;
end;
$$;

-- suppliers: reuse existing live table as-is, add admin/staff RLS only
drop policy if exists "admin_all_suppliers" on suppliers;
create policy "admin_all_suppliers" on suppliers for all
  using (is_admin()) with check (is_admin());

drop policy if exists "staff_read_suppliers" on suppliers;
create policy "staff_read_suppliers" on suppliers for select
  using (is_staff());
