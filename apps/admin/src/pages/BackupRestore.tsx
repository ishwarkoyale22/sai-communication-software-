import { useEffect, useRef, useState } from "react";
import {
  downloadBackup,
  parseBackupFile,
  restoreBackup,
  listRecycleBin,
  restoreFromBin,
  permanentlyDelete,
  type BackupFile,
  type RecycleBinRow,
} from "@sai/shared";
import { supabase } from "../lib/supabase";
import { Download, Upload, AlertTriangle, RotateCcw, Trash2, DatabaseBackup } from "lucide-react";

type Tab = "backup" | "bin";

const TABLE_LABELS: Record<string, string> = {
  inventory: "Product",
  brands: "Brand",
  suppliers: "Supplier",
  branches: "Branch",
  staff: "Staff member",
  finance_partners: "Finance partner",
  offers: "Offer",
  gallery: "Gallery photo/video",
  services: "Service",
  hamper_items: "Gift hamper",
};

export function BackupRestore() {
  const [tab, setTab] = useState<Tab>("backup");
  const [downloading, setDownloading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreProgress, setRestoreProgress] = useState<{ table: string; done: number; total: number } | null>(null);
  const [pendingFile, setPendingFile] = useState<{ file: File; parsed: BackupFile } | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [bin, setBin] = useState<RecycleBinRow[]>([]);
  const [binLoading, setBinLoading] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  useEffect(() => {
    if (tab === "bin") loadBin();
  }, [tab]);

  async function loadBin() {
    setBinLoading(true);
    setBin(await listRecycleBin(supabase));
    setBinLoading(false);
  }

  async function handleDownload() {
    setDownloading(true);
    setMessage(null);
    const { error, tableCounts } = await downloadBackup(supabase);
    setDownloading(false);
    if (error) {
      setMessage({ type: "error", text: error });
      return;
    }
    const totalRows = Object.values(tableCounts ?? {}).reduce((s, n) => s + n, 0);
    setMessage({ type: "success", text: `Backup downloaded — ${totalRows.toLocaleString("en-IN")} rows across ${Object.keys(tableCounts ?? {}).length} tables.` });
  }

  async function handleFilePicked(file: File | undefined) {
    if (!file) return;
    setMessage(null);
    try {
      const parsed = await parseBackupFile(file);
      setPendingFile({ file, parsed });
    } catch (err: any) {
      setMessage({ type: "error", text: err?.message || "Couldn't read that file." });
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function confirmRestore() {
    if (!pendingFile) return;
    setRestoring(true);
    setMessage(null);
    const { error, restoredCounts } = await restoreBackup(supabase, pendingFile.parsed, (table, done, total) =>
      setRestoreProgress({ table, done, total })
    );
    setRestoring(false);
    setRestoreProgress(null);
    setPendingFile(null);
    if (error) {
      setMessage({ type: "error", text: error });
      return;
    }
    const totalRows = Object.values(restoredCounts).reduce((s, n) => s + n, 0);
    setMessage({ type: "success", text: `Restore complete — ${totalRows.toLocaleString("en-IN")} rows restored across ${Object.keys(restoredCounts).length} tables.` });
  }

  async function handleRestoreFromBin(row: RecycleBinRow) {
    setActingId(row.id);
    const { error } = await restoreFromBin(supabase, row);
    setActingId(null);
    if (error) {
      setMessage({ type: "error", text: error });
      return;
    }
    setMessage({ type: "success", text: `${TABLE_LABELS[row.table_name] ?? row.table_name} restored.` });
    loadBin();
  }

  async function handlePermanentDelete(row: RecycleBinRow) {
    if (!confirm("Permanently delete this? It cannot be recovered after this.")) return;
    setActingId(row.id);
    await permanentlyDelete(supabase, row.id);
    setActingId(null);
    loadBin();
  }

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const selectedRows = bin.filter((r) => selected.has(r.id));
  const allSelected = bin.length > 0 && selectedRows.length === bin.length;

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleBulkRestore() {
    if (selectedRows.length === 0) return;
    setBulkBusy(true);
    let failed = 0;
    for (const row of selectedRows) {
      const { error } = await restoreFromBin(supabase, row);
      if (error) failed++;
    }
    setBulkBusy(false);
    setSelected(new Set());
    setMessage(
      failed
        ? { type: "error", text: `${selectedRows.length - failed} restored, ${failed} failed.` }
        : { type: "success", text: `${selectedRows.length} item(s) restored.` }
    );
    loadBin();
  }

  async function handleBulkDelete() {
    if (selectedRows.length === 0) return;
    if (!confirm(`Permanently delete ${selectedRows.length} item(s)? They cannot be recovered after this.`)) return;
    setBulkBusy(true);
    for (const row of selectedRows) await permanentlyDelete(supabase, row.id);
    setBulkBusy(false);
    setSelected(new Set());
    loadBin();
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-gray-800">Backup & Restore</h1>
        <p className="text-xs text-gray-500">Download a full data backup, restore from one, or recover something you deleted by mistake.</p>
      </div>

      <div className="flex w-fit rounded-lg border border-border bg-card p-0.5">
        {(["backup", "bin"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
              tab === t ? "bg-brand-primary text-white" : "text-gray-500 hover:text-gray-800"
            }`}
          >
            {t === "backup" ? "Backup & Restore" : "Recycle Bin"}
          </button>
        ))}
      </div>

      {message && (
        <div
          className={`flex items-start gap-2 rounded-md border p-3 text-sm ${
            message.type === "success" ? "border-green-200 bg-green-50 text-brand-success" : "border-red-200 bg-red-50 text-brand-danger"
          }`}
        >
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>{message.text}</span>
        </div>
      )}

      {tab === "backup" && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="card-blue p-5">
            <div className="mb-1 flex items-center gap-2 font-serif text-sm font-semibold text-gray-700">
              <DatabaseBackup size={16} className="text-brand-primary" /> Download Backup
            </div>
            <p className="mb-4 text-xs text-gray-600">
              Saves every product, sale, customer, and other business record to one JSON file on your device. Keep it somewhere safe.
            </p>
            <button className="btn-primary" onClick={handleDownload} disabled={downloading}>
              <Download size={14} /> {downloading ? "Preparing…" : "Download Backup"}
            </button>
          </div>

          <div className="card-gold p-5">
            <div className="mb-1 flex items-center gap-2 font-serif text-sm font-semibold text-gray-700">
              <Upload size={16} className="text-gold" /> Restore from Backup
            </div>
            <p className="mb-4 text-xs text-gray-600">
              Upload a backup file to restore its data. Existing records with the same ID are overwritten — newer data created since the backup is left untouched.
            </p>
            <input ref={fileInputRef} type="file" accept="application/json" className="hidden" onChange={(e) => handleFilePicked(e.target.files?.[0])} />
            <button className="btn-secondary" onClick={() => fileInputRef.current?.click()} disabled={restoring}>
              <Upload size={14} /> Choose Backup File
            </button>
          </div>
        </div>
      )}

      {tab === "bin" && (
        <div className="card overflow-x-auto">
          {selectedRows.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 text-sm">
              <span className="text-gray-600">{selectedRows.length} selected</span>
              <button className="btn-secondary !px-2 !py-1 text-xs" disabled={bulkBusy} onClick={handleBulkRestore}>
                <RotateCcw size={12} /> Restore selected
              </button>
              <button className="btn-ghost !px-2 !py-1 text-xs text-brand-danger" disabled={bulkBusy} onClick={handleBulkDelete}>
                <Trash2 size={12} /> Delete selected
              </button>
            </div>
          )}
          <table className="table-base">
            <thead>
              <tr>
                <th className="w-8">
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    checked={allSelected}
                    onChange={() => setSelected(allSelected ? new Set() : new Set(bin.map((r) => r.id)))}
                  />
                </th>
                <th>Type</th>
                <th>Name</th>
                <th>Deleted</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {bin.map((row) => (
                <tr key={row.id}>
                  <td>
                    <input type="checkbox" aria-label="Select row" checked={selected.has(row.id)} onChange={() => toggleOne(row.id)} />
                  </td>
                  <td>{TABLE_LABELS[row.table_name] ?? row.table_name}</td>
                  <td className="font-medium">{row.label ?? String(row.data.name ?? row.data.title ?? row.record_id)}</td>
                  <td className="text-gray-500">{new Date(row.deleted_at).toLocaleString("en-IN")}</td>
                  <td className="text-right">
                    <div className="flex justify-end gap-1">
                      <button className="btn-secondary !px-2 !py-1 text-xs" disabled={actingId === row.id} onClick={() => handleRestoreFromBin(row)}>
                        <RotateCcw size={12} /> Restore
                      </button>
                      <button className="btn-ghost !px-2 !py-1 text-xs text-brand-danger" disabled={actingId === row.id} onClick={() => handlePermanentDelete(row)}>
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!binLoading && bin.length === 0 && (
                <tr>
                  <td colSpan={5}className="py-8 text-center text-gray-400">
                    Nothing here — deleted products, staff, brands and similar records show up here for recovery.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {pendingFile && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4">
          <div className="card w-full max-w-md space-y-3 p-5">
            <div className="flex items-center gap-2 font-serif text-sm font-semibold text-gray-800">
              <AlertTriangle size={16} className="text-brand-warning" /> Confirm Restore
            </div>
            <p className="text-sm text-gray-600">
              Restoring <span className="font-medium">{pendingFile.file.name}</span> (backed up{" "}
              {new Date(pendingFile.parsed.createdAt).toLocaleString("en-IN")}) will overwrite any current record that shares an ID with something in
              this file. This can't be undone. Continue?
            </p>
            {restoring && restoreProgress && (
              <p className="text-xs text-gray-500">
                Restoring {restoreProgress.table}… ({restoreProgress.done}/{restoreProgress.total})
              </p>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <button className="btn-ghost" onClick={() => setPendingFile(null)} disabled={restoring}>
                Cancel
              </button>
              <button className="btn-primary" onClick={confirmRestore} disabled={restoring}>
                {restoring ? "Restoring…" : "Restore"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
