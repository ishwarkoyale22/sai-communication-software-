-- Additive follow-up to 0020: the customer-facing feedback page (built in
-- the separate website repo) needs to read a feedback row's repair context
-- (device brand/model, whether it's already been submitted) by token,
-- without being logged in. 0020's `service_feedback` SELECT policy is
-- authenticated-only (deliberately, to avoid a blanket anon-listable
-- table), so expose a narrow, token-scoped read via a SECURITY DEFINER
-- RPC instead of loosening that policy.
create or replace function public.get_service_feedback_by_token(p_token uuid)
returns table (
  repair_id uuid,
  device_brand text,
  device_model text,
  customer_name text,
  status text,
  rating integer,
  comment text,
  wants_reschedule boolean,
  requested_date date,
  submitted_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
    select
      r.id, r.device_brand, r.device_model, r.customer_name, r.status,
      f.rating, f.comment, f.wants_reschedule, f.requested_date, f.submitted_at
    from public.service_feedback f
    join public.repairs r on r.id = f.repair_id
    where f.token = p_token;
end;
$$;

revoke all on function public.get_service_feedback_by_token(uuid) from public;
grant execute on function public.get_service_feedback_by_token(uuid) to anon, authenticated;
