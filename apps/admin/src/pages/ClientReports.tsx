import { useEffect, useState } from "react";
import { formatDateTime } from "@sai/shared";
import { supabase } from "../lib/supabase";
import { ExportExcelButton } from "../components/ExportExcelButton";
import { FileText, Plus, X, Download, Check, RotateCcw } from "lucide-react";

interface Customer {
  id: string;
  name: string;
}
interface Staff {
  id: string;
  name: string;
}
interface ClientReport {
  id: string;
  customer_id: string;
  staff_id: string | null;
  title: string | null;
  report_type: string | null;
  report_data: Record<string, unknown> | null;
  notes: string | null;
  file_url: string | null;
  status: string;
  admin_feedback: string | null;
  created_at: string;
  customer?: Customer | null;
}

const STATUS_STYLE: Record<string, string> = {
  submitted: "pill-info",
  under_review: "pill-warning",
  approved: "pill-success",
  changes_required: "pill-danger",
};

const empty = { customer_id: "", report_type: "", notes: "" };

export function ClientReports() {
  const [reports, setReports] = useState<ClientReport[]>([]);
  const [customerFilter, setCustomerFilter] = useState("");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [fileUrls, setFileUrls] = useState<Record<string, string>>({});
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(empty);
  const [feedbackFor, setFeedbackFor] = useState<string | null>(null);
  const [feedbackText, setFeedbackText] = useState("");

  useEffect(() => {
    load();
    supabase.from("customers").select("id, name").order("name").then(({ data }) => setCustomers((data as Customer[]) ?? []));
    supabase.from("staff").select("id, name").then(({ data }) => setStaff((data as Staff[]) ?? []));
    const channel = supabase
      .channel("client-reports-page")
      .on("postgres_changes", { event: "*", schema: "public", table: "client_reports" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function load() {
    const { data } = await supabase
      .from("client_reports")
      .select("*, customer:customers(id, name)")
      .order("created_at", { ascending: false });
    setReports((data as any) ?? []);
  }

  function staffName(id: string | null) {
    if (!id) return "-";
    return staff.find((s) => s.id === id)?.name ?? "Unknown";
  }

  // 'client-reports' is a private bucket — a public URL won't resolve, so
  // each file needs its own short-lived signed URL fetched on demand.
  async function getSignedUrl(path: string): Promise<string | null> {
    if (fileUrls[path]) return fileUrls[path];
    const { data } = await supabase.storage.from("client-reports").createSignedUrl(path, 3600);
    if (data?.signedUrl) {
      setFileUrls((prev) => ({ ...prev, [path]: data.signedUrl }));
      return data.signedUrl;
    }
    return null;
  }

  async function openFile(path: string) {
    const url = await getSignedUrl(path);
    if (url) window.open(url, "_blank");
  }

  async function setStatus(report: ClientReport, status: string, feedback?: string | null) {
    await supabase.from("client_reports").update({ status, admin_feedback: feedback ?? null }).eq("id", report.id);
    setFeedbackFor(null);
    setFeedbackText("");
    load();
  }

  async function addReport() {
    if (!form.customer_id || !form.report_type.trim()) return;
    await supabase.from("client_reports").insert({
      customer_id: form.customer_id,
      report_type: form.report_type.trim(),
      notes: form.notes || null,
    });
    setForm(empty);
    setShowForm(false);
    load();
  }

  // Staff Portal submissions carry a title (and usually a staff_id); the
  // older Admin-only manual entries only ever set report_type — keep the
  // two lists visually separate since they serve different workflows.
  const staffSubmitted = reports.filter((r) => r.title != null || r.staff_id != null);
  const manual = reports.filter((r) => r.title == null && r.staff_id == null);
  const filteredManual = customerFilter ? manual.filter((r) => r.customer_id === customerFilter) : manual;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold text-gray-800">Client Reports</h1>
      </div>

      <div className="card overflow-x-auto">
        <div className="border-b border-border p-3 text-sm font-semibold text-gray-700">
          Reports submitted by staff
        </div>
        <table className="table-base">
          <thead>
            <tr>
              <th>Title</th>
              <th>Client</th>
              <th>Submitted By</th>
              <th>Date</th>
              <th>Status</th>
              <th className="text-right">File</th>
              <th className="text-right">Review</th>
            </tr>
          </thead>
          <tbody>
            {staffSubmitted.map((r) => (
              <tr key={r.id}>
                <td className="font-medium">
                  <span className="inline-flex items-center gap-1"><FileText size={13} /> {r.title ?? "-"}</span>
                  {r.notes && <div className="mt-0.5 max-w-xs truncate text-xs text-gray-400">{r.notes}</div>}
                </td>
                <td>{r.customer?.name ?? "-"}</td>
                <td>{staffName(r.staff_id)}</td>
                <td className="text-gray-500">{formatDateTime(r.created_at)}</td>
                <td>
                  <span className={STATUS_STYLE[r.status] ?? "pill-info"}>{r.status.replace(/_/g, " ")}</span>
                </td>
                <td className="text-right">
                  {r.file_url ? (
                    <button className="btn-secondary inline-flex !px-2 !py-1 text-xs" onClick={() => openFile(r.file_url!)}>
                      <Download size={13} /> View
                    </button>
                  ) : (
                    <span className="text-xs text-gray-400">No file</span>
                  )}
                </td>
                <td className="text-right">
                  {feedbackFor === r.id ? (
                    <div className="flex items-center justify-end gap-1">
                      <input
                        className="input !w-40 !py-1 text-xs"
                        placeholder="Feedback for staff"
                        value={feedbackText}
                        onChange={(e) => setFeedbackText(e.target.value)}
                      />
                      <button className="btn-secondary !px-2 !py-1 text-xs" onClick={() => setStatus(r, "changes_required", feedbackText)}>
                        Send
                      </button>
                      <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => setFeedbackFor(null)}>
                        <X size={13} />
                      </button>
                    </div>
                  ) : (
                    <div className="flex justify-end gap-1">
                      {r.status !== "approved" && (
                        <button className="btn-secondary !px-2 !py-1 text-xs" onClick={() => setStatus(r, "approved")} title="Approve">
                          <Check size={13} />
                        </button>
                      )}
                      {r.status !== "changes_required" && (
                        <button
                          className="btn-ghost !px-2 !py-1 text-xs text-brand-danger"
                          onClick={() => {
                            setFeedbackFor(r.id);
                            setFeedbackText("");
                          }}
                          title="Request changes"
                        >
                          <RotateCcw size={13} />
                        </button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {staffSubmitted.length === 0 && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-gray-400">No reports submitted by staff yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card overflow-x-auto">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-3">
          <span className="text-sm font-semibold text-gray-700">Admin-added reports</span>
          <div className="flex gap-2">
            <select className="input !w-auto" value={customerFilter} onChange={(e) => setCustomerFilter(e.target.value)}>
              <option value="">All clients</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <ExportExcelButton
              rows={filteredManual.map((r) => ({ Customer: r.customer?.name, Type: r.report_type, Notes: r.notes, Date: r.created_at }))}
              fileName="client-reports"
            />
            <button className="btn-primary" onClick={() => setShowForm(true)}>
              <Plus size={14} /> Add Report
            </button>
          </div>
        </div>
        <table className="table-base">
          <thead>
            <tr>
              <th>Customer</th>
              <th>Type</th>
              <th>Notes</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            {filteredManual.map((r) => (
              <tr key={r.id}>
                <td className="font-medium">{r.customer?.name ?? "-"}</td>
                <td>
                  <span className="inline-flex items-center gap-1"><FileText size={13} /> {r.report_type}</span>
                </td>
                <td className="max-w-xs truncate text-gray-500">{r.notes ?? "-"}</td>
                <td className="text-gray-500">{formatDateTime(r.created_at)}</td>
              </tr>
            ))}
            {filteredManual.length === 0 && (
              <tr>
                <td colSpan={4} className="py-8 text-center text-gray-400">No reports yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/30">
          <div className="card w-96 space-y-2.5 p-5">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-800">Add Client Report</h2>
              <button onClick={() => setShowForm(false)}><X size={16} /></button>
            </div>
            <select className="input" value={form.customer_id} onChange={(e) => setForm({ ...form, customer_id: e.target.value })}>
              <option value="">Select customer *</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <input className="input" placeholder="Report type *" value={form.report_type} onChange={(e) => setForm({ ...form, report_type: e.target.value })} />
            <textarea className="input" placeholder="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            <div className="flex justify-end gap-2 pt-2">
              <button className="btn-ghost" onClick={() => setShowForm(false)}>Cancel</button>
              <button className="btn-primary" onClick={addReport}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
