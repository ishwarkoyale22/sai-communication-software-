import { useEffect, useState } from "react";
import { Download, Eye, X } from "lucide-react";
import { exportToExcel } from "@sai/shared";

const VIEW_LIMIT = 2000;

function cell(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) return v.toLocaleString("en-IN");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export function ExportExcelButton<T extends Record<string, unknown>>({
  rows,
  fileName,
  sheetName,
}: {
  rows: T[];
  fileName: string;
  sheetName?: string;
}) {
  const [viewing, setViewing] = useState(false);
  const columns = rows.length ? Object.keys(rows[0]) : [];

  useEffect(() => {
    if (!viewing) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setViewing(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewing]);

  return (
    <>
      {/* One wrapper so the two buttons always sit together, even inside a "justify-between" header. */}
      <div className="inline-flex items-center gap-2">
      <button
        className="btn-secondary"
        disabled={rows.length === 0}
        onClick={() => setViewing(true)}
        title={rows.length === 0 ? "No rows to view" : "View the visible rows as a spreadsheet"}
      >
        <Eye size={14} />
        View in Excel
      </button>
      <button
        className="btn-secondary"
        disabled={rows.length === 0}
        onClick={() => exportToExcel(rows, fileName, sheetName)}
        title={rows.length === 0 ? "No rows to export" : "Export visible rows to Excel"}
      >
        <Download size={14} />
        Export Excel
      </button>
      </div>

      {viewing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-2 sm:p-4" onClick={() => setViewing(false)}>
          <div className="flex max-h-[92vh] w-full max-w-6xl flex-col rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-3">
              <div>
                <div className="text-sm font-semibold text-gray-800">{sheetName || fileName}.xlsx</div>
                <div className="text-xs text-gray-400">
                  {rows.length} row{rows.length === 1 ? "" : "s"} · {columns.length} column{columns.length === 1 ? "" : "s"}
                  {rows.length > VIEW_LIMIT ? ` · showing the first ${VIEW_LIMIT} (the download has all)` : ""}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button className="btn-primary text-xs" onClick={() => exportToExcel(rows, fileName, sheetName)}>
                  <Download size={13} /> Download .xlsx
                </button>
                <button onClick={() => setViewing(false)} aria-label="Close"><X size={18} className="text-gray-400" /></button>
              </div>
            </div>

            <div className="overflow-auto">
              <table className="w-full border-collapse text-xs" style={{ fontFamily: "Calibri, Arial, sans-serif" }}>
                <thead className="sticky top-0 z-10">
                  <tr>
                    <th className="w-10 border border-gray-300 bg-gray-100" />
                    {columns.map((_, i) => (
                      <th key={i} className="border border-gray-300 bg-gray-100 px-2 py-0.5 text-center font-normal text-gray-500">
                        {String.fromCharCode(65 + (i % 26)).repeat(Math.floor(i / 26) + 1)}
                      </th>
                    ))}
                  </tr>
                  <tr>
                    <th className="border border-gray-300 bg-gray-100 text-center font-normal text-gray-500">1</th>
                    {columns.map((c) => (
                      <th key={c} className="whitespace-nowrap border border-gray-300 bg-emerald-50 px-2 py-1 text-left font-semibold text-gray-800">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, VIEW_LIMIT).map((r, i) => (
                    <tr key={i} className="hover:bg-emerald-50/40">
                      <td className="border border-gray-300 bg-gray-100 text-center text-gray-500">{i + 2}</td>
                      {columns.map((c) => {
                        const v = r[c];
                        return (
                          <td key={c} className={`whitespace-nowrap border border-gray-200 px-2 py-1 ${typeof v === "number" ? "text-right tabular-nums" : ""}`}>
                            {cell(v)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
