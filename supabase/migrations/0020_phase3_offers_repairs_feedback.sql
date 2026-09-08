-- Phase 3 — additive only. Verified against the LIVE schema first:
-- `offers` already exists but only as a bare shell (id, title, description,
-- is_active, created_at) — filling in the rest additively rather than
-- recreating it. `service_feedback` and the repairs.contacted_at column do
-- not exist yet.

-- §9 Offer Management — fill in the rest of the existing `offers` shell.
alter table public.offers
  add column if not exists offer_type text check (offer_type in ('percentage', 'bogo', 'rupee_off', 'coupon')),
  add column if not exists discount_value numeric,
  add column if not exists coupon_code text,
  add column if not exists image_url text,
  add column if not exists display_mode text check (display_mode in ('image', 'popup', 'hero_banner')) default 'hero_banner',
  add column if not exists starts_at timestamptz,
  add column if not exists ends_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

comment on column public.offers.offer_type is 'percentage | bogo | rupee_off | coupon — per requirements §9.1';
comment on column public.offers.display_mode is 'image | popup | hero_banner — per requirements §9.2; an offer can be shown in more than one place so this is just its primary placement';

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'offers'
  ) then
    alter publication supabase_realtime add table public.offers;
  end if;
end $$;

drop policy if exists "offers_select_all" on public.offers;
create policy "offers_select_all" on public.offers for select using (true);
drop policy if exists "offers_write_authenticated" on public.offers;
create policy "offers_write_authenticated" on public.offers for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- §4 Website Order Bill Generation — "Separate bill generation for gift /
-- giveaway orders" needs order_type to actually support those values. The
-- only value ever written so far is 'product' (confirmed live), so widen
-- whatever check constraint exists rather than guessing its name blindly.
do $$
declare
  v_constraint text;
begin
  select con.conname into v_constraint
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  where rel.relname = 'website_orders' and con.contype = 'c'
    and pg_get_constraintdef(con.oid) ilike '%order_type%';
  if v_constraint is not null then
    execute format('alter table public.website_orders drop constraint %I', v_constraint);
  end if;
  alter table public.website_orders
    add constraint website_orders_order_type_check
    check (order_type in ('product', 'gift', 'giveaway'));
end $$;

-- §10 Service Management — "Called Up" contact marker, independent of the
-- existing repair-progress `status` column (received/in_progress/
-- waiting_parts/ready/completed), so admin can see "has anyone actually
-- called this customer back" regardless of what stage the repair is at.
alter table public.repairs
  add column if not exists contacted_at timestamptz;

-- §11 Post-Service Feedback — a token-addressed feedback row per completed
-- repair; no login required to submit it (a customer opens a link carrying
-- the token). Reschedule requests carry the customer's preferred next date.
create table if not exists public.service_feedback (
  id uuid primary key default gen_random_uuid(),
  repair_id uuid not null references public.repairs(id) on delete cascade,
  token uuid not null default gen_random_uuid(),
  rating integer check (rating between 1 and 5),
  comment text,
  wants_reschedule boolean not null default false,
  requested_date date,
  submitted_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists service_feedback_token_idx on public.service_feedback(token);
create index if not exists service_feedback_repair_id_idx on public.service_feedback(repair_id);

alter table public.service_feedback enable row level security;

-- New table — see hamper_products in 0019 for why this blanket grant is
-- required here (RLS policies below do the real per-row/per-role gating).
grant all on public.service_feedback to anon, authenticated;

-- Anonymous customers submit via the token they were given (no login), so
-- INSERT/UPDATE must be reachable by anon — but only by exact token match,
-- and only against the row Marking submitted_at happens on this initial
-- feedback submission. Reads are staff/admin-only (never listable by anon)
-- to avoid leaking every open token+repair's feedback publicly.
drop policy if exists "service_feedback_select_authenticated" on public.service_feedback;
create policy "service_feedback_select_authenticated" on public.service_feedback for select
  using (auth.role() = 'authenticated');
drop policy if exists "service_feedback_insert_authenticated" on public.service_feedback;
create policy "service_feedback_insert_authenticated" on public.service_feedback for insert
  with check (auth.role() = 'authenticated');
-- Public update is scoped to a single row match by an RPC instead of a
-- blanket anon UPDATE policy, so a customer can never edit someone else's
-- feedback or overwrite fields outside what the RPC exposes.
create or replace function public.submit_service_feedback(
  p_token uuid,
  p_rating integer,
  p_comment text default null,
  p_wants_reschedule boolean default false,
  p_requested_date date default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.service_feedback
  set rating = p_rating,
      comment = p_comment,
      wants_reschedule = p_wants_reschedule,
      requested_date = p_requested_date,
      submitted_at = now()
  where token = p_token and submitted_at is null;
  return found;
end;
$$;

revoke all on function public.submit_service_feedback(uuid, integer, text, boolean, date) from public;
grant execute on function public.submit_service_feedback(uuid, integer, text, boolean, date) to anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'service_feedback'
  ) then
    alter publication supabase_realtime add table public.service_feedback;
  end if;
end $$;

-- Auto-create the feedback row (and its token) the moment a repair is
-- marked completed, so admin can hand the customer a link immediately
-- instead of a separate manual "generate feedback link" step.
create or replace function public.create_service_feedback_on_completion()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'completed' and (old.status is distinct from 'completed') then
    insert into public.service_feedback (repair_id) values (new.id)
    on conflict do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists repairs_create_feedback_trigger on public.repairs;
create trigger repairs_create_feedback_trigger
  after update on public.repairs
  for each row execute function public.create_service_feedback_on_completion();

-- §10 staff-side "My Repairs": mirrors the existing staff_get_tasks /
-- staff_update_task_status pattern (see
-- migrations_admin_integration_DRAFT/0011_staff_portal_full.sql for the
-- reference shape) — reuses the already-live resolve_staff_session(uuid)
-- helper rather than redefining session handling.
create or replace function public.staff_get_repairs(p_token uuid)
returns setof public.repairs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff_id uuid := resolve_staff_session(p_token);
begin
  if v_staff_id is null then
    raise exception 'Invalid or expired session';
  end if;
  return query
    select * from public.repairs
    where technician_id = v_staff_id
    order by received_at desc;
end;
$$;

create or replace function public.staff_update_repair_status(p_token uuid, p_repair_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff_id uuid := resolve_staff_session(p_token);
begin
  if v_staff_id is null then
    raise exception 'Invalid or expired session';
  end if;
  update public.repairs
  set status = p_status,
      completed_at = case when p_status = 'completed' then now() else completed_at end
  where id = p_repair_id and technician_id = v_staff_id;
  if not found then
    raise exception 'Repair not found or not assigned to you';
  end if;
end;
$$;

create or replace function public.staff_mark_repair_contacted(p_token uuid, p_repair_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff_id uuid := resolve_staff_session(p_token);
begin
  if v_staff_id is null then
    raise exception 'Invalid or expired session';
  end if;
  update public.repairs
  set contacted_at = now()
  where id = p_repair_id and technician_id = v_staff_id;
  if not found then
    raise exception 'Repair not found or not assigned to you';
  end if;
end;
$$;

revoke all on function public.staff_get_repairs(uuid) from public;
revoke all on function public.staff_update_repair_status(uuid, uuid, text) from public;
revoke all on function public.staff_mark_repair_contacted(uuid, uuid) from public;
grant execute on function public.staff_get_repairs(uuid) to anon, authenticated;
grant execute on function public.staff_update_repair_status(uuid, uuid, text) to anon, authenticated;
grant execute on function public.staff_mark_repair_contacted(uuid, uuid) to anon, authenticated;
