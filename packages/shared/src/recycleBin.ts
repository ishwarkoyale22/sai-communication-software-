import type { SupabaseClient } from "@supabase/supabase-js";

export interface RecycleBinRow {
  id: string;
  table_name: string;
  record_id: string;
  label: string | null;
  data: Record<string, unknown>;
  deleted_at: string;
}

/**
 * Soft-delete: snapshots the full row into recycle_bin, then hard-deletes it
 * from its source table. Every existing SELECT across the app stays correct
 * with zero changes, since the row genuinely leaves its source table.
 */
export async function softDelete(
  supabase: SupabaseClient,
  table: string,
  id: string,
  label?: string | null
): Promise<{ error: string | null }> {
  const { data: row, error: fetchErr } = await supabase.from(table).select("*").eq("id", id).single();
  if (fetchErr || !row) return { error: fetchErr?.message ?? "Record not found." };

  const { data: auth } = await supabase.auth.getUser();
  const { error: insertErr } = await supabase.from("recycle_bin").insert({
    table_name: table,
    record_id: id,
    label: label ?? null,
    data: row,
    deleted_by: auth.user?.id ?? null,
  });
  if (insertErr) return { error: insertErr.message };

  const { error: delErr } = await supabase.from(table).delete().eq("id", id);
  if (delErr) return { error: delErr.message };
  return { error: null };
}

/** Re-inserts a recycle_bin snapshot into its source table, then removes the bin entry. */
export async function restoreFromBin(supabase: SupabaseClient, binRow: RecycleBinRow): Promise<{ error: string | null }> {
  const { error: insertErr } = await supabase.from(binRow.table_name).upsert(binRow.data);
  if (insertErr) return { error: insertErr.message };

  const { error: delErr } = await supabase.from("recycle_bin").delete().eq("id", binRow.id);
  if (delErr) return { error: delErr.message };
  return { error: null };
}

/** Permanently discards a recycle_bin snapshot — the record is no longer recoverable. */
export async function permanentlyDelete(supabase: SupabaseClient, binId: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from("recycle_bin").delete().eq("id", binId);
  return { error: error?.message ?? null };
}

export async function listRecycleBin(supabase: SupabaseClient): Promise<RecycleBinRow[]> {
  const { data } = await supabase.from("recycle_bin").select("*").order("deleted_at", { ascending: false });
  return (data as RecycleBinRow[]) ?? [];
}
