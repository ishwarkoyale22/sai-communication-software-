import { useEffect, useState } from "react";
import { formatDateTime, type ClientReport, type Customer, type Staff } from "@sai/shared";
import { supabase } from "../lib/supabase";
import { ExportExcelButton } from "../components/ExportExcelButton";
import { FileText, Download } from "lucide-react";

type ReportRow = ClientReport & { customer?: Customer | null; staff?: Staff | null };

export function ClientReports() {
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [customerFilter, setCustomerFilter] = useState("");
  const [customers, setCustomers] = useState<Customer[]>([]);

  useEffect(() => {
    load();
    supabase.from("customers").select("*").order("name").then(({ data }) => setCustomers(data ?? []));
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
      .select("*, customer:customers(*), staff:staff(*)")
      .order("created_at", { ascending: false });
    setReports((data as any) ?? []);
  }

  async function openFile(path: string) {
    const { data } = await supabase.storage.from("client-reports").createSignedUrl(path, 60);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
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
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <ExportExcelButton
            rows={filtered.map((r) => ({
              Title: r.title,
              Client: r.customer?.name,
              Staff: r.staff?.name,
              Notes: r.notes,
              "Has File": r.file_url ? "Yes" : "No",
              Submitted: r.created_at,
            }))}
            fileName="client-reports"
          />
        </div>
      </div>
      <p className="text-sm text-gray-500">Reports submitted by staff about a particular client, from the Staff Portal.</p>

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>Title</th>
              <th>Client</th>
              <th>Staff</th>
              <th>Notes</th>
              <th>Submitted</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id}>
                <td className="font-medium">
                  <span className="flex items-center gap-1.5">
                    <FileText size={14} className="text-brand-primary" /> {r.title}
                  </span>
                </td>
                <td>{r.customer?.name ?? "-"}</td>
                <td>{r.staff?.name ?? "-"}</td>
                <td className="max-w-xs truncate text-gray-500">{r.notes ?? "-"}</td>
                <td className="text-gray-500">{formatDateTime(r.created_at)}</td>
                <td>
                  {r.file_url && (
                    <button className="btn-ghost" onClick={() => openFile(r.file_url!)}>
                      <Download size={14} /> File
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="py-8 text-center text-gray-400">
                  No client reports submitted yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
