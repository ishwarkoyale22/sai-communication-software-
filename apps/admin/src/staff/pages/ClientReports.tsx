import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useStaffAuth } from "../context/StaffAuthContext";
import { Upload, FileText } from "lucide-react";

interface Customer {
  id: string;
  name: string;
  phone: string | null;
}

interface ReportRow {
  id: string;
  customer_id: string;
  title: string;
  notes: string | null;
  file_url: string | null;
  status: "draft" | "submitted" | "under_review" | "approved" | "changes_required";
  admin_feedback: string | null;
  created_at: string;
}

const STATUS_STYLE: Record<ReportRow["status"], string> = {
  draft: "bg-gray-100 text-gray-500",
  submitted: "bg-blue-100 text-blue-700",
  under_review: "bg-amber-100 text-amber-700",
  approved: "bg-brand-success/10 text-brand-success",
  changes_required: "bg-brand-danger/10 text-brand-danger",
};

export function ClientReports() {
  const { token } = useStaffAuth();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [resubmitId, setResubmitId] = useState<string | null>(null);

  useEffect(() => {
    supabase.from("customers").select("id, name, phone").order("name").then(({ data }) => setCustomers((data as Customer[]) ?? []));
    loadReports();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function loadReports() {
    if (!token) return;
    const { data } = await supabase.rpc("staff_get_client_reports", { p_token: token });
    setReports((data as ReportRow[]) ?? []);
  }

  async function uploadFileIfAny(): Promise<string | null> {
    if (!file) return null;
    const path = `${customerId}/${Date.now()}-${file.name}`;
    const { data, error: uploadErr } = await supabase.storage.from("client-reports").upload(path, file);
    if (uploadErr) throw new Error(`File upload failed: ${uploadErr.message}`);
    return data.path;
  }

  async function submit() {
    if (!token || !customerId || !title) return;
    setSubmitting(true);
    setError(null);
    try {
      const file_url = await uploadFileIfAny();
      const { data: result, error: rpcErr } = await supabase.rpc("staff_submit_client_report", {
        p_token: token,
        p_customer_id: customerId,
        p_title: title,
        p_notes: notes || null,
        p_file_url: file_url,
      });
      if (rpcErr || !result?.success) throw new Error(rpcErr?.message || result?.error || "Failed to submit report.");
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
      setCustomerId("");
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

  async function resubmit(report: ReportRow) {
    if (!token) return;
    setSubmitting(true);
    setError(null);
    try {
      const file_url = await uploadFileIfAny();
      const { data: result, error: rpcErr } = await supabase.rpc("staff_resubmit_client_report", {
        p_token: token,
        p_report_id: report.id,
        p_title: title || report.title,
        p_notes: notes || report.notes,
        p_file_url: file_url,
      });
      if (rpcErr || !result?.success) throw new Error(rpcErr?.message || result?.error || "Failed to resubmit report.");
      setResubmitId(null);
      setTitle("");
      setNotes("");
      setFile(null);
      loadReports();
    } catch (err: any) {
      setError(err?.message || "Failed to resubmit report.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-gray-800">Client Reports</h1>
      <p className="text-sm text-gray-500">Submit a report for a client — Admin reviews and approves it.</p>

      {success && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
          Report submitted successfully!
        </div>
      )}
      {error && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-brand-danger">{error}</div>}

      {!resubmitId && (
        <div className="card space-y-2.5 p-4">
          <select className="input" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">Select client...</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} {c.phone ? `· ${c.phone}` : ""}
              </option>
            ))}
          </select>
          <input className="input" placeholder="Report title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <textarea className="input" placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <label className="btn-secondary w-full cursor-pointer justify-center">
            <Upload size={14} />
            {file ? file.name : "Attach file (optional)"}
            <input type="file" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
          <button className="btn-primary w-full" disabled={!customerId || !title || submitting} onClick={submit}>
            {submitting ? "Submitting..." : "Submit Report"}
          </button>
        </div>
      )}

      <div className="space-y-2">
        <div className="text-xs font-semibold uppercase text-gray-400">Your reports</div>
        {reports.map((r) => (
          <div key={r.id} className="card space-y-2 p-3">
            <div className="flex items-start gap-2">
              <FileText size={16} className="mt-0.5 shrink-0 text-brand-primary" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{r.title}</div>
                <div className="text-xs text-gray-400">{new Date(r.created_at).toLocaleString("en-IN")}</div>
              </div>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLE[r.status]}`}>
                {r.status.replace(/_/g, " ")}
              </span>
            </div>
            {r.status === "changes_required" && (
              <>
                {r.admin_feedback && <div className="rounded-md bg-brand-danger/5 p-2 text-xs text-brand-danger">{r.admin_feedback}</div>}
                {resubmitId === r.id ? (
                  <div className="space-y-2">
                    <input className="input" placeholder="Updated title" defaultValue={r.title} onChange={(e) => setTitle(e.target.value)} />
                    <textarea className="input" placeholder="Updated notes" defaultValue={r.notes || ""} onChange={(e) => setNotes(e.target.value)} />
                    <label className="btn-secondary w-full cursor-pointer justify-center">
                      <Upload size={14} />
                      {file ? file.name : "Replace attachment (optional)"}
                      <input type="file" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                    </label>
                    <button className="btn-primary w-full" disabled={submitting} onClick={() => resubmit(r)}>
                      {submitting ? "Resubmitting..." : "Resubmit"}
                    </button>
                  </div>
                ) : (
                  <button
                    className="rounded-md bg-brand-primary/10 px-3 py-1.5 text-xs font-medium text-brand-primary"
                    onClick={() => {
                      setResubmitId(r.id);
                      setTitle(r.title);
                      setNotes(r.notes || "");
                    }}
                  >
                    Edit & Resubmit
                  </button>
                )}
              </>
            )}
          </div>
        ))}
        {reports.length === 0 && <p className="text-sm text-gray-400">No reports submitted yet</p>}
      </div>
    </div>
  );
}
