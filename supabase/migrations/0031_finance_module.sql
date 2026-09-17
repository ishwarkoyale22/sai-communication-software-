-- Finance/EMI Management Module.
--
-- Upgrades the basic EMI page into a real finance module, wired directly
-- into Sales/Customers/IMEI instead of being a disconnected free-text log.
-- Reuses existing tables (finance_partners from 0022, customers, sales,
-- inventory_units/imei_history from 0029-0030) rather than inventing
-- parallel ones. `emi_finance` (used by the old admin Emi.tsx page — no
-- CREATE TABLE migration exists for it anywhere in this repo, it only
-- exists live) is recreated here defensively with `if not exists` so this
-- migration is safe to run regardless of environment, then its rows are
-- backfilled into the new `finance_transactions` table. `emi_finance` is
-- left in place afterwards (untouched, read-only from the app's
-- perspective going forward) rather than dropped, so no history is lost.
--
-- Settlement fields live directly on `finance_transactions` rather than a
-- separate `finance_settlements` table — it's a 1:1 relationship per
-- transaction (one partner settles one financed sale once), so a child
-- table would only add a join with no real normalization benefit.

-- ---------------------------------------------------------------------
-- 1. finance_partners — reconcile to the owner's exact 8-partner list and
--    add the admin-configurable columns the spec asks for.
-- ---------------------------------------------------------------------

alter table public.finance_partners
  add column if not exists short_code text,
  add column if not exists integration_type text not null default 'manual',
  add column if not exists contact_notes text,
  add column if not exists updated_at timestamptz not null default now();

alter table public.finance_partners drop constraint if exists finance_partners_integration_type_check;
alter table public.finance_partners add constraint finance_partners_integration_type_check
  check (integration_type in ('manual', 'portal_based', 'pos_based', 'api_integrated'));

drop trigger if exists finance_partners_set_updated_at on public.finance_partners;
create trigger finance_partners_set_updated_at
before update on public.finance_partners
for each row execute function public.set_updated_at();

-- Rename the existing rows to the owner-provided list (same ids/FKs, so
-- nothing referencing them by id — e.g. the website checkout, `sales`,
-- `web_orders` — breaks) and set their short codes. Do NOT invent, remove
-- or replace partners: this only corrects names to the source-of-truth
-- list and fills in the two the seed in 0022 was missing.
update public.finance_partners set short_code = 'BAJAJ' where name = 'Bajaj Finance';
update public.finance_partners set name = 'IDFC Finance', short_code = 'IDFC' where name = 'IDFC FIRST Bank';
update public.finance_partners set name = 'TVS Finance', short_code = 'TVS' where name = 'TVS Credit';
update public.finance_partners set short_code = 'HOMECREDIT' where name = 'Home Credit';
update public.finance_partners set short_code = 'DMI' where name = 'DMI Finance';
update public.finance_partners set name = 'Poonawalla Finance', short_code = 'POONAWALLA' where name = 'Poonawalla Fincorp';

insert into public.finance_partners (name, short_code, description, min_amount, max_amount, available_tenures, processing_fee_pct, integration_type, is_active)
select v.name, v.short_code, v.description, v.min_amount, v.max_amount, v.available_tenures, v.processing_fee_pct, 'manual', true
from (values
  ('Samsung Finance', 'SAMSUNG', 'No-cost EMI on Samsung devices.', 5000, 200000, array[3,6,9,12], 0),
  ('Xiaomi Finance', 'XIAOMI', 'EMI options on Xiaomi devices.', 3000, 100000, array[3,6,9,12], 0)
) as v(name, short_code, description, min_amount, max_amount, available_tenures, processing_fee_pct)
where not exists (select 1 from public.finance_partners fp where fp.name = v.name);

-- Any partner name that still doesn't match one of the 8 (shouldn't happen
-- given the updates above, but defensive in case of prior manual edits)
-- keeps its row rather than being silently dropped — this module must
-- never delete finance-partner history.

-- Two manually-added rows on the live database ("TEST Finance Co",
-- "TEST QuickPay") aren't part of the owner's 8-partner source-of-truth
-- list. Per owner decision: deactivate rather than delete, so they're
-- preserved for historical/audit purposes but stop appearing as choices
-- in checkout or the Finance module (both only offer is_active = true
-- partners).
update public.finance_partners set is_active = false where name in ('TEST Finance Co', 'TEST QuickPay');

-- ---------------------------------------------------------------------
-- 2. emi_finance — recreate defensively so this migration works whether
--    or not the live table already exists, then it's backfilled below.
-- ---------------------------------------------------------------------

create table if not exists public.emi_finance (
  id uuid primary key default gen_random_uuid(),
  customer_name text not null,
  phone text not null,
  product_name text not null,
  total_amount numeric not null default 0,
  down_payment numeric not null default 0,
  loan_amount numeric not null default 0,
  emi_months integer not null default 0,
  emi_amount numeric not null default 0,
  finance_company text,
  status text not null default 'active',
  start_date timestamptz not null default now(),
  notes text
);

alter table public.emi_finance enable row level security;
drop policy if exists emi_finance_all_authenticated on public.emi_finance;
drop policy if exists emi_finance_read_only on public.emi_finance;
-- Legacy table, superseded by finance_transactions — per owner decision,
-- DB-enforced read-only going forward, same immutability pattern as
-- imei_history below. Existing rows are fully preserved (no
-- DROP/TRUNCATE/DELETE anywhere in this migration); only a SELECT policy
-- is defined, so with RLS enabled no INSERT/UPDATE/DELETE can succeed for
-- any role regardless of table-level grants — belt-and-suspenders with the
-- explicit revoke below.
create policy emi_finance_read_only on public.emi_finance
  for select using (auth.role() = 'authenticated');
revoke insert, update, delete on public.emi_finance from anon, authenticated;
grant select on public.emi_finance to anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. finance_transactions — the real finance record, linked to the sale,
--    customer and physical stock unit rather than free text.
-- ---------------------------------------------------------------------

create table if not exists public.finance_transactions (
  id uuid primary key default gen_random_uuid(),

  -- Links (Phase 10: Product -> Stock Unit -> IMEI -> Sale -> Invoice ->
  -- Customer -> Finance Transaction -> Finance Partner)
  customer_id uuid references public.customers(id) on delete set null,
  sale_id uuid references public.sales(id) on delete set null,
  stock_unit_id uuid references public.inventory_units(id) on delete set null,
  -- Nullable, not NOT NULL: "Finance partner required" (Phase 18) is
  -- enforced at the app layer for NEW finance sales (Finance.tsx blocks
  -- submit without one), same as customer_id/sale_id/stock_unit_id above.
  -- A hard NOT NULL here broke the emi_finance backfill on legacy rows
  -- whose free-text finance_company doesn't match any of the 8 real
  -- partners — and the spec says never invent a partner to paper over
  -- that, so those legacy rows must be allowed a null link instead.
  finance_partner_id uuid references public.finance_partners(id),

  -- Denormalized snapshot at the time of sale — kept even if the sale/
  -- customer row is later edited or the unit is replaced, so a finance
  -- record always shows what was true when the loan was written.
  invoice_number text,
  customer_name text not null,
  customer_phone text,
  product_name text not null,
  brand text,
  model text,
  imei_1 text,
  imei_2 text,
  serial_no text,

  -- Finance (Phase 4/6): finance amount is never assumed to equal
  -- settlement amount — both are tracked independently.
  sale_amount numeric not null default 0 check (sale_amount >= 0),
  down_payment numeric not null default 0 check (down_payment >= 0),
  customer_paid_amount numeric not null default 0 check (customer_paid_amount >= 0),
  finance_amount numeric not null default 0 check (finance_amount >= 0),
  tenure_months integer not null default 0 check (tenure_months >= 0),
  emi_amount numeric not null default 0 check (emi_amount >= 0),
  finance_date date not null default current_date,
  application_number text,
  agreement_number text,

  status text not null default 'draft' check (status in (
    'draft', 'application_started', 'submitted', 'pending', 'approved',
    'disbursement_pending', 'disbursed', 'settlement_pending', 'settled',
    'rejected', 'cancelled', 'failed'
  )),
  notes text,

  -- Settlement/reconciliation
  expected_settlement_amount numeric check (expected_settlement_amount is null or expected_settlement_amount >= 0),
  actual_settlement_amount numeric check (actual_settlement_amount is null or actual_settlement_amount >= 0),
  processing_fee numeric not null default 0 check (processing_fee >= 0),
  commission numeric not null default 0 check (commission >= 0),
  other_deduction numeric not null default 0 check (other_deduction >= 0),
  adjustment numeric not null default 0,
  settlement_date date,
  settlement_reference text,
  reconciliation_status text not null default 'pending' check (reconciliation_status in ('pending', 'matched', 'mismatch')),

  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Phase 18: settlement info required before a record can be marked settled.
  constraint finance_transactions_settled_requires_settlement check (
    status <> 'settled' or (actual_settlement_amount is not null and settlement_date is not null and settlement_reference is not null)
  )
);

comment on table public.finance_transactions is 'Real finance/EMI records, linked to sale/customer/stock unit and finance_partners. Replaces the free-text emi_finance table going forward.';
comment on column public.finance_transactions.finance_amount is 'What the customer financed. NOT assumed equal to actual_settlement_amount — the partner may settle less after fees/deductions.';

create index if not exists finance_transactions_customer_id_idx on public.finance_transactions (customer_id);
create index if not exists finance_transactions_sale_id_idx on public.finance_transactions (sale_id);
create index if not exists finance_transactions_stock_unit_id_idx on public.finance_transactions (stock_unit_id);
create index if not exists finance_transactions_finance_partner_id_idx on public.finance_transactions (finance_partner_id);
create index if not exists finance_transactions_status_idx on public.finance_transactions (status);
create index if not exists finance_transactions_application_number_idx on public.finance_transactions (application_number);
create index if not exists finance_transactions_agreement_number_idx on public.finance_transactions (agreement_number);
create index if not exists finance_transactions_imei_1_idx on public.finance_transactions (imei_1);
create index if not exists finance_transactions_imei_2_idx on public.finance_transactions (imei_2);

drop trigger if exists finance_transactions_set_updated_at on public.finance_transactions;
create trigger finance_transactions_set_updated_at
before update on public.finance_transactions
for each row execute function public.set_updated_at();

-- Phase 18: block invalid status transitions server-side, not just in the
-- UI. Terminal states (settled/rejected/cancelled/failed) never move again.
create or replace function public.validate_finance_status_transition()
returns trigger
language plpgsql
as $$
declare
  allowed text[];
begin
  if new.status = old.status then
    return new;
  end if;

  allowed := case old.status
    when 'draft' then array['application_started', 'cancelled']
    when 'application_started' then array['submitted', 'cancelled']
    when 'submitted' then array['pending', 'cancelled']
    when 'pending' then array['approved', 'rejected', 'cancelled']
    when 'approved' then array['disbursement_pending', 'cancelled']
    when 'disbursement_pending' then array['disbursed', 'failed', 'cancelled']
    when 'disbursed' then array['settlement_pending']
    when 'settlement_pending' then array['settled', 'failed']
    else array[]::text[]
  end;

  if not (new.status = any(allowed)) then
    raise exception 'Invalid finance status transition: % -> %', old.status, new.status;
  end if;

  return new;
end;
$$;

drop trigger if exists finance_transactions_validate_status on public.finance_transactions;
create trigger finance_transactions_validate_status
before update of status on public.finance_transactions
for each row execute function public.validate_finance_status_transition();

alter table public.finance_transactions enable row level security;
drop policy if exists admin_all_finance_transactions on public.finance_transactions;
create policy admin_all_finance_transactions on public.finance_transactions
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'finance_transactions'
  ) then
    alter publication supabase_realtime add table public.finance_transactions;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 4. finance_status_history — immutable audit trail, same pattern as
--    imei_history (0030): app-inserted on every status change, never
--    updated or deleted even by an admin.
-- ---------------------------------------------------------------------

create table if not exists public.finance_status_history (
  id uuid primary key default gen_random_uuid(),
  finance_transaction_id uuid not null references public.finance_transactions(id) on delete cascade,
  from_status text,
  to_status text not null,
  note text,
  changed_by uuid,
  created_at timestamptz not null default now()
);

comment on table public.finance_status_history is 'Immutable chronological log of every finance_transactions.status change — never updated or deleted, only appended to.';

create index if not exists finance_status_history_transaction_id_idx on public.finance_status_history (finance_transaction_id);

alter table public.finance_status_history enable row level security;
drop policy if exists admin_all_finance_status_history on public.finance_status_history;
create policy admin_all_finance_status_history on public.finance_status_history
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

revoke update, delete on public.finance_status_history from anon, authenticated;
grant select, insert on public.finance_status_history to anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'finance_status_history'
  ) then
    alter publication supabase_realtime add table public.finance_status_history;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 5. Backfill emi_finance -> finance_transactions (Phase 12: never delete
--    financial history — old rows are copied forward, not moved/dropped).
--    finance_company is free text on the old table, so it's matched to a
--    real finance_partners row by name where possible; unmatched rows
--    still migrate, just without a partner link, rather than being lost.
-- ---------------------------------------------------------------------

insert into public.finance_transactions (
  customer_name, customer_phone, product_name, sale_amount, down_payment,
  finance_amount, tenure_months, emi_amount, finance_partner_id, status,
  finance_date, notes,
  -- A 'settled' row must satisfy finance_transactions_settled_requires_
  -- settlement AT INSERT TIME (a CHECK constraint applies per-row on
  -- insert, not after) — these three must be filled in the same SELECT
  -- as the status itself, not by a later UPDATE, or the insert of any
  -- already-completed legacy EMI fails exactly like finance_partner_id
  -- did.
  actual_settlement_amount, settlement_date, settlement_reference
)
select
  e.customer_name,
  e.phone,
  e.product_name,
  e.total_amount,
  e.down_payment,
  e.loan_amount,
  e.emi_months,
  e.emi_amount,
  fp.id,
  case e.status
    when 'active' then 'disbursed'
    when 'completed' then 'settled'
    when 'defaulted' then 'failed'
    else 'disbursed'
  end,
  e.start_date::date,
  coalesce(e.notes, '') || case when e.notes is not null then E'\n' else '' end || '[migrated from legacy emi_finance record ' || e.id || ']',
  case when e.status = 'completed' then e.loan_amount end,
  case when e.status = 'completed' then e.start_date::date end,
  case when e.status = 'completed' then 'LEGACY-MIGRATION' end
from public.emi_finance e
-- finance_partners rows were renamed above (IDFC FIRST Bank -> IDFC
-- Finance, TVS Credit -> TVS Finance, Poonawalla Fincorp -> Poonawalla
-- Finance), but emi_finance.finance_company is old free text that may
-- still say the OLD name — match against both old and new names so a
-- legacy row doesn't silently lose its partner link because of the rename
-- that just happened earlier in this same migration.
left join public.finance_partners fp on fp.name = e.finance_company
  or (e.finance_company = 'IDFC FIRST Bank' and fp.name = 'IDFC Finance')
  or (e.finance_company = 'TVS Credit' and fp.name = 'TVS Finance')
  or (e.finance_company = 'Poonawalla Fincorp' and fp.name = 'Poonawalla Finance')
where not exists (
  select 1 from public.finance_transactions ft where ft.notes like '%[migrated from legacy emi_finance record ' || e.id || ']%'
);
