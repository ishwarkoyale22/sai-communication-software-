-- ============================================================================
-- 0065_imei_db_safety.sql
-- Phase 0 audit (run against production, read-only, 2026-10-03) found:
--   - 0 duplicate IMEIs, 0 cross-column collisions, 0 bad-format IMEIs,
--     0 Luhn failures, 0 duplicate serial_no → safe to add hard constraints.
--   - 1 duplicate product (name+model) from a manual test import — NOT
--     touched here per explicit instruction; no inventory-level uniqueness
--     constraint is added in this migration for that reason.
--
-- This migration, in order:
--   1. Adds real UNIQUE indexes on imei_1 / imei_2 (closes the same-column
--      race: two rows both claiming the same imei_1, or both claiming the
--      same imei_2).
--   2. Rewrites the EXISTING validate_imei_uniqueness() trigger to take a
--      per-IMEI-value advisory lock before it checks/inserts, which closes
--      the remaining cross-column race (one row's imei_1 vs another row's
--      imei_2 — see "How the cross-column race is prevented" below). This
--      is the one change requested after review of the first draft.
--   3. Adds a DB-level 15-digit + Luhn CHECK constraint so a bad IMEI can
--      never be written even if every app-layer check is bypassed.
--   4. Adds one atomic RPC, add_inventory_units_with_history(), that inserts
--      inventory_units + imei_history rows together — if either insert fails,
--      both roll back, and partial writes become impossible.
--
-- It does NOT touch sales/returns triggers, does NOT add an inventory
-- name+model constraint, does NOT change the database's transaction
-- isolation level (default read-committed is kept, project-wide and for
-- this trigger/function), and does NOT modify any existing row.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Same-column race: a plain UNIQUE index enforces this at the index level,
--    which Postgres makes atomic even under concurrent INSERTs. Partial
--    (WHERE ... IS NOT NULL) because NULL values must stay unconstrained —
--    non-serialized/accessory units all have NULL imei_1 and imei_2.
create unique index if not exists inventory_units_imei_1_unique
  on public.inventory_units (imei_1)
  where imei_1 is not null;

create unique index if not exists inventory_units_imei_2_unique
  on public.inventory_units (imei_2)
  where imei_2 is not null;

-- ----------------------------------------------------------------------------
-- 2. Cross-column race fix.
--
--    HOW THE CROSS-COLUMN RACE IS PREVENTED:
--    A unique index on imei_1 alone cannot see a value sitting in another
--    row's imei_2 (and vice versa), so two transactions — one inserting
--    IMEI "X" into imei_1 of a new row, another inserting the same "X" into
--    imei_2 of a different new row, at the same instant — could previously
--    both pass the trigger's existence check before either had committed,
--    because the check (SELECT) and the write (INSERT) are two separate
--    statements with no lock between them.
--
--    The fix: before doing that existence check, the trigger now takes a
--    PostgreSQL advisory lock keyed on the literal IMEI *value* itself
--    (pg_advisory_xact_lock), not on a column or row. Advisory locks are
--    plain integers in a lock table maintained by Postgres, independent of
--    any row/table — "X" locks the same key whether it is about to become
--    imei_1 or imei_2. A second transaction trying to acquire a lock on the
--    same value blocks (waits) until the first transaction commits or rolls
--    back, at which point the lock is released automatically (xact-scoped:
--    `pg_advisory_xact_lock`, not the session-scoped variant, so there is no
--    manual-unlock bug possible — Postgres always releases it at the end of
--    the transaction, success or failure). Only then does the second
--    transaction acquire the lock, run its existence check, and — because
--    the first transaction's row is now visible — correctly find the
--    conflict and raise.
--
--    This serializes any two transactions that touch the same IMEI value in
--    ANY combination of imei_1/imei_2, with no window between check and
--    write, and without changing the database's isolation level: advisory
--    locks are an explicit, opt-in locking primitive layered on top of
--    ordinary read-committed transactions — nothing project-wide changes,
--    only this one trigger's own behavior.
--
--    Deadlock avoidance: when a single row sets both imei_1 and imei_2 (a
--    dual-SIM phone), the two locks are acquired in ascending value order
--    (not column order) — so two concurrent rows that happen to reference
--    the same two IMEIs in swapped imei_1/imei_2 positions always request
--    their locks in the same order as each other, which cannot deadlock.
--    (If it ever somehow did, Postgres's own deadlock detector aborts one
--    side with a standard, catchable error — it cannot hang.)
--
--    Lock keys use the 2-argument integer form of the advisory-lock
--    functions (a fixed namespace id + hashtext of the IMEI) specifically so
--    this lock keyspace can never collide with any other advisory lock this
--    project — or a future one — might take for an unrelated purpose.
create or replace function public.validate_imei_uniqueness()
returns trigger
language plpgsql
as $$
declare
  v_lock_namespace constant int := 851717001; -- fixed id reserved for IMEI uniqueness locks only
  v_first text;
  v_second text;
begin
  if new.imei_1 is not null and new.imei_1 = new.imei_2 then
    raise exception 'IMEI 1 and IMEI 2 cannot be the same.';
  end if;

  -- Acquire locks in a fixed (ascending) order so concurrent rows that
  -- reference the same two IMEI values can never deadlock against each other.
  if new.imei_1 is not null and new.imei_2 is not null then
    if new.imei_1 < new.imei_2 then
      v_first := new.imei_1; v_second := new.imei_2;
    else
      v_first := new.imei_2; v_second := new.imei_1;
    end if;
    perform pg_advisory_xact_lock(v_lock_namespace, hashtext(v_first));
    perform pg_advisory_xact_lock(v_lock_namespace, hashtext(v_second));
  elsif new.imei_1 is not null then
    perform pg_advisory_xact_lock(v_lock_namespace, hashtext(new.imei_1));
  elsif new.imei_2 is not null then
    perform pg_advisory_xact_lock(v_lock_namespace, hashtext(new.imei_2));
  end if;

  -- From here on, no other transaction can be mid-flight on either of this
  -- row's IMEI values — the checks below now see a fully up-to-date picture.
  if new.imei_1 is not null and exists (
    select 1 from public.inventory_units
    where id <> new.id and (imei_1 = new.imei_1 or imei_2 = new.imei_1)
  ) then
    raise exception 'IMEI % already exists.', new.imei_1;
  end if;

  if new.imei_2 is not null and exists (
    select 1 from public.inventory_units
    where id <> new.id and (imei_1 = new.imei_2 or imei_2 = new.imei_2)
  ) then
    raise exception 'IMEI % already exists.', new.imei_2;
  end if;

  return new;
end;
$$;

comment on function public.validate_imei_uniqueness is
  'Rejects a duplicate IMEI across imei_1/imei_2 in any combination. Takes a per-value pg_advisory_xact_lock (fixed namespace 851717001, ascending-value lock order) before checking, so two concurrent transactions touching the same IMEI value — in any column — always serialize instead of racing past each other. Lock is transaction-scoped and auto-released on commit or rollback.';

-- hashtext() has a small but non-zero chance of two different 15-digit IMEI
-- strings hashing to the same 32-bit lock key. That is harmless here: a
-- collision only ever causes two UNRELATED IMEIs to serialize against each
-- other (briefly block one another) — it can never cause a false "duplicate"
-- rejection, because the actual uniqueness decision is still made by the
-- exact-match `exists (...)` queries above, not by the hash.

-- The trigger definition itself (inventory_units_validate_imei, BEFORE
-- INSERT OR UPDATE OF imei_1, imei_2) is unchanged — only the function body
-- it calls was rewritten above, so no DROP/CREATE TRIGGER is needed.

-- ----------------------------------------------------------------------------
-- 3. DB-level format + Luhn check. Mirrors packages/shared/src/imei.ts
--    exactly (same digit-doubling rule) so the frontend and database can
--    never disagree about what counts as a valid IMEI. This is the backstop
--    the frontend is NOT allowed to be the final authority for.
--
--    IMMUTABLE + no table access, so it's safe to use inside a CHECK
--    constraint (Postgres requires CHECK functions to be deterministic).
create or replace function public.is_valid_imei(imei text)
returns boolean
language sql
immutable
as $$
  select imei ~ '^[0-9]{15}$'
    and (
      select sum(
        case when (14 - i) % 2 = 1 then
          case when (substr(imei, i + 1, 1)::int * 2) > 9
            then (substr(imei, i + 1, 1)::int * 2) - 9
            else (substr(imei, i + 1, 1)::int * 2)
          end
        else substr(imei, i + 1, 1)::int
        end
      )
      from generate_series(0, 14) i
    ) % 10 = 0
$$;

comment on function public.is_valid_imei is
  'Exactly 15 digits + standard IMEI Luhn checksum. Mirrors packages/shared/src/imei.ts — the two must be kept in sync by hand if either changes.';

alter table public.inventory_units
  drop constraint if exists inventory_units_imei_1_valid;
alter table public.inventory_units
  add constraint inventory_units_imei_1_valid
  check (imei_1 is null or public.is_valid_imei(imei_1));

alter table public.inventory_units
  drop constraint if exists inventory_units_imei_2_valid;
alter table public.inventory_units
  add constraint inventory_units_imei_2_valid
  check (imei_2 is null or public.is_valid_imei(imei_2));

-- ----------------------------------------------------------------------------
-- 4. Atomic save: inventory_units + imei_history in one transaction. Today
--    Inventory.tsx's commitDraftRows() does these as two separate
--    `supabase.from(...).insert(...)` calls from the browser — if the first
--    succeeds and the second fails (network drop, RLS hiccup, etc.), stock
--    units exist with no purchase history event, which is the "partial
--    write" state this eliminates.
--
--    p_units is a JSON array of objects, one per unit:
--      { "imei_1": text|null, "imei_2": text|null, "serial_no": text|null,
--        "purchase_price": numeric|null, "purchase_invoice_ref": text|null,
--        "supplier_id": uuid|null }
--    Every field but imei_1/imei_2/serial_no is optional and defaults to
--    null, preserving purchase_price / purchase_invoice_ref / supplier_id
--    exactly where the caller supplies them (e.g. from invoice import) and
--    leaving them null otherwise, matching current behavior.
--
--    Because this function performs ordinary INSERTs (not raw, lock-free
--    writes), every row it inserts into inventory_units still passes
--    through the validate_imei_uniqueness() trigger above — so this
--    function inherits the same cross-column race protection automatically;
--    it does not need to take any locks itself.
--
--    Returns the created inventory_units rows (as json) so the frontend can
--    update its UI without a second round-trip.
drop function if exists public.add_inventory_units_with_history(uuid, json);

create or replace function public.add_inventory_units_with_history(
  p_inventory_id uuid,
  p_units json
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_unit json;
  v_new_id uuid;
  v_result json[] := '{}';
begin
  if not is_admin() then
    raise exception 'Only administrators can add inventory units';
  end if;

  if p_inventory_id is null then
    raise exception 'inventory_id is required';
  end if;

  if json_array_length(p_units) is null or json_array_length(p_units) = 0 then
    raise exception 'At least one unit is required';
  end if;

  for v_unit in select * from json_array_elements(p_units)
  loop
    v_new_id := gen_random_uuid();

    insert into public.inventory_units (
      id, inventory_id, imei_1, imei_2, serial_no, status,
      purchase_price, purchase_invoice_ref, supplier_id,
      created_by, updated_by
    ) values (
      v_new_id,
      p_inventory_id,
      nullif(v_unit->>'imei_1', ''),
      nullif(v_unit->>'imei_2', ''),
      nullif(v_unit->>'serial_no', ''),
      'in_stock',
      nullif(v_unit->>'purchase_price', '')::numeric,
      nullif(v_unit->>'purchase_invoice_ref', ''),
      nullif(v_unit->>'supplier_id', '')::uuid,
      v_user_id,
      v_user_id
    );

    insert into public.imei_history (
      stock_unit_id, imei_1, imei_2, event_type, to_status,
      supplier_id, created_by
    ) values (
      v_new_id,
      nullif(v_unit->>'imei_1', ''),
      nullif(v_unit->>'imei_2', ''),
      'purchase',
      'in_stock',
      nullif(v_unit->>'supplier_id', '')::uuid,
      v_user_id
    );

    v_result := v_result || json_build_object(
      'id', v_new_id,
      'imei_1', nullif(v_unit->>'imei_1', ''),
      'imei_2', nullif(v_unit->>'imei_2', ''),
      'serial_no', nullif(v_unit->>'serial_no', '')
    );
  end loop;

  -- A single implicit transaction wraps the whole function body — if any
  -- iteration's insert raises (unique violation, Luhn CHECK, advisory-lock
  -- trigger conflict, FK violation), Postgres rolls back every insert made
  -- in this call, including ones from earlier loop iterations. No partial
  -- batch can ever be committed.
  return json_build_object('units', array_to_json(v_result));
end;
$$;

comment on function public.add_inventory_units_with_history is
  'Atomically inserts one or more inventory_units rows plus their matching imei_history purchase event. All-or-nothing: any failure (duplicate IMEI, invalid IMEI, etc.) rolls back the entire batch. Call via supabase.rpc(...), not direct table inserts, when adding serialized stock.';
