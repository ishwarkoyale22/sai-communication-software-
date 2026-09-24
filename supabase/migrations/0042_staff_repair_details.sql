-- ============================================================================
-- 0042_staff_repair_details.sql
--
-- Technician Portal: diagnosis/parts_used/repair_cost/notes already exist as
-- columns on `repairs` (and already come through staff_get_repairs, which is
-- `select *`) but there was no way for a technician to WRITE them — only
-- status and "contacted" had RPCs. Adding the one missing write path.
-- ============================================================================

create or replace function public.staff_update_repair_details(
  p_token uuid,
  p_repair_id uuid,
  p_diagnosis text default null,
  p_parts_used text default null,
  p_repair_cost numeric default null,
  p_notes text default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff_id uuid := resolve_staff_session(p_token);
begin
  update repairs
  set diagnosis = coalesce(p_diagnosis, diagnosis),
      parts_used = coalesce(p_parts_used, parts_used),
      repair_cost = coalesce(p_repair_cost, repair_cost),
      notes = coalesce(p_notes, notes),
      updated_at = now()
  where id = p_repair_id and technician_id = v_staff_id;

  if not found then
    return json_build_object('success', false, 'error', 'Repair not found or not assigned to you.');
  end if;

  return json_build_object('success', true);
end;
$$;

grant execute on function public.staff_update_repair_details(uuid, uuid, text, text, numeric, text) to anon, authenticated;
