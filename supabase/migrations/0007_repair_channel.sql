-- ============================================================================
-- 0007_repair_channel.sql
-- Distinguishes online vs offline repair entries, mirroring the existing
-- sales.sale_type pattern (client requirement #15). Defaults existing rows
-- to 'offline' since every repair so far was walk-in/manual.
-- ============================================================================

alter table repairs
  add column if not exists channel text not null default 'offline' check (channel in ('online', 'offline'));

create index if not exists idx_repairs_channel on repairs (channel);
