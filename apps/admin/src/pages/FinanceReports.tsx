import { useEffect, useState } from "react";
import { formatDateTime } from "@sai/shared";
import { supabase } from "../lib/supabase";
import { ExportExcelButton } from "../components/ExportExcelButton";
import { FileText, Download } from "lucide-react";

interface Staff {
  id: string;
  name: string;
}
interface FinanceReport {
  id: string;
  staff_id: string | null;
  title: string;
  notes: string | null;
  file_url: string | null;
  created_at: string;
}

export function FinanceReports() {
  const [reports, setReports] = useState<FinanceReport[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);

  useEffect(() => {
    load();
    supabase.from("staff").select("id, name").then(({ data }) => setStaff((data as Staff[]) ?? []));
    const channel = supabase
      .channel("finance-reports-page")
      .on("postgres_changes", { event: "*", schema: "public", table: "finance_reports" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function load() {
    const { data } = await supabase.from("finance_reports").select("*").order("created_at", { ascending: false });
    setReports((data as FinanceReport[]) ?? []);
  }

  function staffName(id: string | null) {
    if (!id) return "Unknown";
    return staff.find((s) => s.id === id)?.name ?? "Unknown";
  }

  // The bucket is private: open the file through a short-lived signed link.
  async function openFile(path: string) {
    const { data, error } = await supabase.storage.from("finance-reports").createSignedUrl(path, 300);
    if (error || !data?.signedUrl) {
      window.alert(error?.message || "Could not open the file.");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener");
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold text-gray-800">Finance Reports</h1>
        <ExportExcelButton
          rows={reports.map((r) => ({
            "Report Name": r.title,
            "Uploaded By": staffName(r.staff_id),
            "Upload Date": r.created_at,
            Notes: r.notes,
          }))}
          fileName="finance-reports"
        />
      </div>
      <p className="text-sm text-gray-500">Finance reports uploaded by staff from the Staff Portal.</p>

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>Report Name</th>
              <th>Uploaded By</th>
              <th>Upload Date</th>
              <th>Notes</th>
              <th className="text-right">File</th>
            </tr>
          </thead>
          <tbody>
            {reports.map((r) => {
              return (
                <tr key={r.id}>
                  <td className="font-medium">
                    <span className="inline-flex items-center gap-1"><FileText size={13} /> {r.title}</span>
                  </td>
                  <td>{staffName(r.staff_id)}</td>
                  <td className="text-gray-500">{formatDateTime(r.created_at)}</td>
                  <td className="max-w-xs truncate text-gray-500">{r.notes ?? "-"}</td>
                  <td className="text-right">
                    {r.file_url ? (
                      <button type="button" onClick={() => openFile(r.file_url!)} className="btn-secondary inline-flex !px-2 !py-1 text-xs">
                        <Download size={13} /> View / Download
                      </button>
                    ) : (
                      <span className="text-xs text-gray-400">No file</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {reports.length === 0 && (
              <tr>
                <td colSpan={5} className="py-8 text-center text-gray-400">No finance reports uploaded yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
