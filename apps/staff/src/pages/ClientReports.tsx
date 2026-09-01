import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useStaffAuth } from "../context/StaffAuthContext";
import { Upload, FileText } from "lucide-react";

interface Customer {
  id: string;
  name: string;
  phone: string | null;
}

interface ActivityRow {
  id: string;
  action: string;
  details: { report_id?: string; title?: string };
  created_at: string;
}

export function ClientReports() {
  const { token } = useStaffAuth();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [recent, setRecent] = useState<ActivityRow[]>([]);

  useEffect(() => {
    supabase.from("customers").select("id, name, phone").order("name").then(({ data }) => setCustomers((data as Customer[]) ?? []));
    loadRecent();
  }, [token]);

  async function loadRecent() {
    if (!token) return;
    const { data } = await supabase.rpc("staff_get_activity", { p_token: token });
    setRecent(((data as ActivityRow[]) ?? []).filter((r) => r.action === "client_report_submitted").slice(0, 10));
  }

  async function submit() {
    if (!token || !customerId || !title) return;
    setSubmitting(true);
    setError(null);

    let file_url: string | null = null;
    if (file) {
      const path = `${customerId}/${Date.now()}-${file.name}`;
      const { data, error: uploadErr } = await supabase.storage.from("client-reports").upload(path, file);
      if (uploadErr) {
        setSubmitting(false);
        setError(`File upload failed: ${uploadErr.message}`);
        return;
      }
      file_url = data.path;
    }

    const { data: result, error: rpcErr } = await supabase.rpc("staff_submit_client_report", {
      p_token: token,
      p_customer_id: customerId,
      p_report_type: "visit_report",
      p_report_data: { title, file_url },
      p_notes: notes || null,
    });

    setSubmitting(false);
    if (rpcErr || !result?.success) {
      setError(rpcErr?.message || result?.error || "Failed to submit report.");
      return;
    }

    setSuccess(true);
    setTimeout(() => setSuccess(false), 3000);
    setCustomerId("");
    setTitle("");
    setNotes("");
    setFile(null);
    loadRecent();
  }

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-gray-800">Client Reports</h1>
      <p className="text-sm text-gray-500">Submit a report for a client — Admin can view it right away.</p>

      {success && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
          Report submitted successfully!
        </div>
      )}
      {error && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-brand-danger">{error}</div>}

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

      <div className="space-y-2">
        <div className="text-xs font-semibold uppercase text-gray-400">Your recent reports</div>
        {recent.map((r) => (
          <div key={r.id} className="card flex items-center gap-2 p-3">
            <FileText size={16} className="text-brand-primary" />
            <div className="flex-1">
              <div className="text-sm font-medium">{r.details?.title ?? "Report"}</div>
              <div className="text-xs text-gray-400">{new Date(r.created_at).toLocaleString("en-IN")}</div>
            </div>
          </div>
        ))}
        {recent.length === 0 && <p className="text-sm text-gray-400">No reports submitted yet</p>}
      </div>
    </div>
  );
}
