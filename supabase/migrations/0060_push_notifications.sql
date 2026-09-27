-- 0060_push_notifications.sql
-- Real OS-level push notifications (lock screen / notification shade), not just the in-app bell.
--
-- Pieces:
--   1) push_subscriptions — one row per device that has granted permission, holding the browser's
--      Web Push subscription (endpoint + keys). Admin devices are for_admin=true; staff devices carry
--      their staff_id — same targeting shape the notifications table already uses.
--   2) A trigger on notifications: AFTER INSERT, call the Vercel API route that actually sends the
--      push (it holds the private VAPID key; Postgres never does). Uses pg_net so the call is async
--      and never blocks or fails the insert that triggered it.
--
-- The shared secret the API route checks is NOT stored in this file — it is inserted separately,
-- directly into app_secrets, straight into the database. Never put the actual secret value in a
-- migration file (or any other file that gets committed).

create extension if not exists pg_net; -- installs into its default `net` schema

-- A tiny, tightly locked-down place to keep server-side-only values. RLS is enabled with no policies
-- at all, so it is unreachable through the API (anon/authenticated key) exactly like every other table
-- here — only a SECURITY DEFINER function owned by the same role that created this table (the migration
-- role) can read it, which is how notify_push_on_insert() below reads the push secret.
create table if not exists public.app_secrets (
  key text primary key,
  value text not null
);
alter table public.app_secrets enable row level security;

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid references public.staff (id) on delete cascade,
  for_admin boolean not null default false,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  -- Exactly one target, same rule as notifications itself.
  constraint push_subscriptions_target_check check (
    (staff_id is not null and for_admin = false) or (staff_id is null and for_admin = true)
  )
);

create index if not exists idx_push_subscriptions_staff on public.push_subscriptions (staff_id);
create index if not exists idx_push_subscriptions_admin on public.push_subscriptions (for_admin);

alter table public.push_subscriptions enable row level security;
grant all on public.push_subscriptions to anon, authenticated;

-- Same openness as `notifications` itself (see 0039/0045): the staff portal and admin portal both run
-- on the anon key with app-level checks rather than Supabase auth sessions for staff, so subscribing/
-- unsubscribing a device is open, same as everything else these portals write.
drop policy if exists "push_subscriptions_all" on public.push_subscriptions;
create policy "push_subscriptions_all" on public.push_subscriptions for all using (true) with check (true);

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'push_subscriptions') then
    alter publication supabase_realtime add table public.push_subscriptions;
  end if;
end $$;

create or replace function public.notify_push_on_insert()
returns trigger
language plpgsql
security definer
set search_path = public, net
as $$
declare
  v_secret text;
begin
  select value into v_secret from app_secrets where key = 'push_secret';
  if v_secret is null then
    return new; -- secret not configured yet on this database — skip quietly rather than error.
  end if;
  perform net.http_post(
    url := 'https://sai-communication-software-admin.vercel.app/api/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret),
    body := jsonb_build_object(
      'staff_id', new.staff_id,
      'for_admin', new.for_admin,
      'title', new.title,
      'body', new.body,
      'link', new.link
    )
  );
  return new;
exception when others then
  -- A push-delivery hiccup must never fail the notification insert itself.
  return new;
end;
$$;

drop trigger if exists trg_notify_push_on_insert on public.notifications;
create trigger trg_notify_push_on_insert
  after insert on public.notifications
  for each row execute function public.notify_push_on_insert();
