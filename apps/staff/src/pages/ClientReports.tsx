import { useEffect, useState } from "react";
import { formatDateTime, type Customer, type ClientReport } from "@sai/shared";
import { supabase } from "../lib/supabase";
import { useStaffAuth } from "../context/StaffAuthContext";
import { Upload, FileText } from "lucide-react";

export function ClientReports() {
  const { staff } = useStaffAuth();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [myReports, setMyReports] = useState<ClientReport[]>([]);

  useEffect(() => {
    supabase.from("customers").select("*").order("name").then(({ data }) => setCustomers(data ?? []));
    loadMyReports();
  }, []);

  async function loadMyReports() {
    if (!staff) return;
    const { data } = await supabase
      .from("client_reports")
      .select("*")
      .eq("staff_id", staff.id)
      .order("created_at", { ascending: false })
      .limit(10);
    setMyReports(data ?? []);
  }

  async function submit() {
    if (!staff || !customerId || !title) return;
    setSubmitting(true);

    let file_url: string | null = null;
    if (file) {
      const path = `${staff.id}/${Date.now()}-${file.name}`;
      const { data, error } = await supabase.storage.from("client-reports").upload(path, file);
      if (!error) file_url = data.path;
    }

    const { error } = await supabase.from("client_reports").insert({
      customer_id: customerId,
      staff_id: staff.id,
      title,
      notes: notes || null,
      file_url,
    });

    setSubmitting(false);
    if (error) {
      alert(error.message);
      return;
    }
    setCustomerId("");
    setTitle("");
    setNotes("");
    setFile(null);
    loadMyReports();
  }

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-gray-800">Client Reports</h1>
      <p className="text-sm text-gray-500">Submit a report for a client — Admin can view it right away.</p>

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
        <button
          className="btn-primary w-full"
          disabled={!customerId || !title || submitting}
          onClick={submit}
        >
          {submitting ? "Submitting..." : "Submit Report"}
        </button>
      </div>

      <div className="space-y-2">
        <div className="text-xs font-semibold uppercase text-gray-400">Your recent reports</div>
        {myReports.map((r) => (
          <div key={r.id} className="card flex items-center gap-2 p-3">
            <FileText size={16} className="text-brand-primary" />
            <div className="flex-1">
              <div className="text-sm font-medium">{r.title}</div>
              <div className="text-xs text-gray-400">{formatDateTime(r.created_at)}</div>
            </div>
          </div>
        ))}
        {myReports.length === 0 && <p className="text-sm text-gray-400">No reports submitted yet</p>}
      </div>
    </div>
  );
}
