import { useEffect, useState } from "react";
import { formatDateTime } from "@sai/shared";
import { supabase } from "../lib/supabase";
import { ExportExcelButton } from "../components/ExportExcelButton";
import { FileText, Plus, X } from "lucide-react";

interface Customer {
  id: string;
  name: string;
}
interface ClientReport {
  id: string;
  customer_id: string;
  report_type: string | null;
  report_data: Record<string, unknown> | null;
  notes: string | null;
  created_at: string;
  customer?: Customer | null;
}

const empty = { customer_id: "", report_type: "", notes: "" };

export function ClientReports() {
  const [reports, setReports] = useState<ClientReport[]>([]);
  const [customerFilter, setCustomerFilter] = useState("");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(empty);

  useEffect(() => {
    load();
    supabase.from("customers").select("id, name").order("name").then(({ data }) => setCustomers((data as Customer[]) ?? []));
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

  const filtered = customerFilter ? reports.filter((r) => r.customer_id === customerFilter) : reports;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-800">Client Reports</h1>
        <div className="flex gap-2">
          <select className="input !w-auto" value={customerFilter} onChange={(e) => setCustomerFilter(e.target.value)}>
            <option value="">All clients</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <ExportExcelButton
            rows={filtered.map((r) => ({ Customer: r.customer?.name, Type: r.report_type, Notes: r.notes, Date: r.created_at }))}
            fileName="client-reports"
          />
          <button className="btn-primary" onClick={() => setShowForm(true)}>
            <Plus size={14} /> Add Report
          </button>
        </div>
      </div>

      <div className="card overflow-x-auto">
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
            {filtered.map((r) => (
              <tr key={r.id}>
                <td className="font-medium">{r.customer?.name ?? "-"}</td>
                <td>
                  <span className="inline-flex items-center gap-1"><FileText size={13} /> {r.report_type}</span>
                </td>
                <td className="max-w-xs truncate text-gray-500">{r.notes ?? "-"}</td>
                <td className="text-gray-500">{formatDateTime(r.created_at)}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
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
