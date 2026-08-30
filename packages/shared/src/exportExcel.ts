import * as XLSX from "xlsx";

/**
 * Universal "Export Excel" utility — implement once, use on every table page.
 *
 * @param rows    Array of flat objects (already shaped the way you want columns to appear)
 * @param fileName File name without extension, e.g. "products-2026-08-27"
 * @param sheetName Optional sheet name (defaults to "Sheet1")
 */
export function exportToExcel<T extends Record<string, unknown>>(
  rows: T[],
  fileName: string,
  sheetName = "Sheet1"
): void {
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);

  // Auto-size columns roughly based on content length
  const colWidths = Object.keys(rows[0] ?? {}).map((key) => {
    const maxLen = Math.max(
      key.length,
      ...rows.map((r) => String(r[key] ?? "").length)
    );
    return { wch: Math.min(Math.max(maxLen + 2, 10), 40) };
  });
  worksheet["!cols"] = colWidths;

  XLSX.writeFile(workbook, `${fileName}.xlsx`);
}
