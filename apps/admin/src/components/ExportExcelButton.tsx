import { Download } from "lucide-react";
import { exportToExcel } from "@sai/shared";

export function ExportExcelButton<T extends Record<string, unknown>>({
  rows,
  fileName,
  sheetName,
}: {
  rows: T[];
  fileName: string;
  sheetName?: string;
}) {
  return (
    <button
      className="btn-secondary"
      disabled={rows.length === 0}
      onClick={() => exportToExcel(rows, fileName, sheetName)}
      title={rows.length === 0 ? "No rows to export" : "Export visible rows to Excel"}
    >
      <Download size={14} />
      Export Excel
    </button>
  );
}
