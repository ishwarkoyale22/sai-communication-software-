import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useStaffAuth } from "../context/StaffAuthContext";
import { Upload, FileText } from "lucide-react";

interface ReportRow {
  id: string;
  title: string;
  notes: string | null;
  file_url: string | null;
  created_at: string;
}

export function FinanceReports() {
  const { staff, token } = useStaffAuth();
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    loadReports();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staff?.id, token]);

  async function loadReports() {
    if (!token) return;
    const { data } = await supabase.rpc("staff_get_finance_reports", { p_token: token });
    setReports((data as ReportRow[]) ?? []);
  }

  async function submit() {
    if (!staff?.id || !token || !title.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      let file_url: string | null = null;
      if (file) {
        const path = `${staff.id}/${Date.now()}-${file.name}`;
        const { data, error: uploadErr } = await supabase.storage.from("finance-reports").upload(path, file);
        if (uploadErr) throw new Error(`File upload failed: ${uploadErr.message}`);
        file_url = data.path;
      }
      const { data: res, error: insertErr } = await supabase.rpc("staff_submit_finance_report", {
        p_token: token,
        p_title: title.trim(),
        p_notes: notes.trim() || null,
        p_file_url: file_url,
      });
      if (insertErr) throw insertErr;
      if (!res?.success) throw new Error(res?.error || "Failed to submit report.");
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
      setTitle("");
      setNotes("");
      setFile(null);
      loadReports();
    } catch (err: any) {
      setError(err?.message || "Failed to submit report.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-gray-800">Finance Reports</h1>
      <p className="text-sm text-gray-500">Upload a finance report for Admin to review.</p>

      {success && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
          Report uploaded successfully!
        </div>
      )}
      {error && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-brand-danger">{error}</div>}

      <div className="card space-y-2.5 p-4">
        <input className="input" placeholder="Report name" value={title} onChange={(e) => setTitle(e.target.value)} />
        <textarea className="input" placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <label className="btn-secondary w-full cursor-pointer justify-center">
          <Upload size={14} />
          {file ? file.name : "Attach file"}
          <input type="file" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        <button className="btn-primary w-full" disabled={!title.trim() || submitting} onClick={submit}>
          {submitting ? "Uploading..." : "Upload Report"}
        </button>
      </div>

      <div className="space-y-2">
        <div className="text-xs font-semibold uppercase text-gray-400">Your reports</div>
        {reports.map((r) => {
                    return (
            <div key={r.id} className="card space-y-1.5 p-3">
              <div className="flex items-start gap-2">
                <FileText size={16} className="mt-0.5 shrink-0 text-brand-primary" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{r.title}</div>
                  <div className="text-xs text-gray-400">{new Date(r.created_at).toLocaleString("en-IN")}</div>
                </div>
              </div>
              {r.notes && <div className="text-xs text-gray-500">{r.notes}</div>}
              {r.file_url && <div className="text-xs text-gray-400">File attached — the admin can open it.</div>}
            </div>
          );
        })}
        {reports.length === 0 && <p className="text-sm text-gray-400">No reports uploaded yet</p>}
      </div>
    </div>
  );
}
