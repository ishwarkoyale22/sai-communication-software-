import type { SupabaseClient } from "@supabase/supabase-js";

// Restore order matters: parent tables before the children that reference
// them (FK inserts fail otherwise). `profiles` is deliberately excluded —
// its id must match an existing auth.users row, so restoring it blind could
// orphan or hijack a login; staff/admin accounts are recreated through the
// normal "Add Staff" flow instead.
export const BACKUP_TABLES = [
  "branches",
  "suppliers",
  "brands",
  "staff",
  "customers",
  "settings",
  "inventory",
  "inventory_units",
  "finance_partners",
  "hamper_items",
  "hamper_products",
  "sales",
  "sales_items",
  "sales_targets",
  "finance_transactions",
  "finance_status_history",
  "wholesaler_invoices",
  "third_party_purchases",
  "repairs",
  "repair_enquiries",
  "service_feedback",
  "reviews",
  "enquiries",
  "website_orders",
  "gallery",
  "offers",
  "services",
  "attendance",
  "leave_requests",
  "staff_tasks",
  "client_reports",
  "imei_history",
] as const;

export interface BackupFile {
  createdAt: string;
  tables: Record<string, unknown[]>;
}

/** Downloads a single JSON file containing every row of every backed-up table. */
export async function downloadBackup(supabase: SupabaseClient): Promise<{ error: string | null; tableCounts?: Record<string, number> }> {
  const tables: Record<string, unknown[]> = {};
  const tableCounts: Record<string, number> = {};
  for (const table of BACKUP_TABLES) {
    const { data, error } = await supabase.from(table).select("*");
    if (error) return { error: `Failed to export "${table}": ${error.message}` };
    tables[table] = data ?? [];
    tableCounts[table] = (data ?? []).length;
  }

  const file: BackupFile = { createdAt: new Date().toISOString(), tables };
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `sai-communication-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return { error: null, tableCounts };
}

/** Parses an uploaded backup file. Throws if it isn't shaped like one. */
export async function parseBackupFile(file: File): Promise<BackupFile> {
  const text = await file.text();
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || !parsed.tables || typeof parsed.tables !== "object") {
    throw new Error("This doesn't look like a Sai Communication backup file.");
  }
  return parsed as BackupFile;
}

/**
 * Restores a backup by upserting every row (matched by id) back into its
 * table, in BACKUP_TABLES order. Existing rows with the same id are
 * overwritten; rows that only exist live (created after the backup) are
 * left untouched — this is a merge, not a wipe-and-replace.
 */
export async function restoreBackup(
  supabase: SupabaseClient,
  file: BackupFile,
  onProgress?: (table: string, done: number, total: number) => void
): Promise<{ error: string | null; restoredCounts: Record<string, number> }> {
  const restoredCounts: Record<string, number> = {};
  const tablesToRestore = BACKUP_TABLES.filter((t) => Array.isArray(file.tables[t]) && file.tables[t].length > 0);
  let done = 0;
  for (const table of tablesToRestore) {
    const rows = file.tables[table] as Record<string, unknown>[];
    // Chunk to stay well under request size / row-count limits on a large backup.
    const chunkSize = 500;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const conflictKey = table === "settings" ? "key" : "id";
      const { error } = await supabase.from(table).upsert(chunk, { onConflict: conflictKey });
      if (error) return { error: `Failed restoring "${table}": ${error.message}`, restoredCounts };
    }
    restoredCounts[table] = rows.length;
    done += 1;
    onProgress?.(table, done, tablesToRestore.length);
  }
  return { error: null, restoredCounts };
}
