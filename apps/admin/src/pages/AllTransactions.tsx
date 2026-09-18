import { useEffect, useMemo, useState } from "react";
import { formatCurrency, formatDate, openRetailTaxInvoice, openPurchaseBill, openBlankInvoiceWindow } from "@sai/shared";
import { supabase, SHOP } from "../lib/supabase";
import { ExportExcelButton } from "../components/ExportExcelButton";
import { Search, Filter, Printer, Share2, MoreVertical, FileText } from "lucide-react";

// "All Transactions" — a single ledger combining every Sale (money coming
// in) and every Purchase (money going out, from Wholesaler Invoices +
// Third-Party Purchases) so the owner doesn't have to check three separate
// pages to see the day's activity. Read-only view; editing still happens on
// the source page (Sales & Invoices / Wholesaler Invoices / Third-Party
// Purchases) — this just reports on records that already exist there.

type TxnType = "Sale" | "Purchase";
type ReportType = "All" | TxnType;

interface TxnRow {
  id: string;
  date: string; // ISO date/time
  refNo: string;
  partyName: string;
  gstin: string | null;
  paymentType: string;
  type: TxnType;
  total: number;
  received: number;
  balance: number;
  // Fields needed to reprint the original document for this row.
  source: "sale" | "wholesaler" | "third_party";
  sourceId: string;
}

// Fixed proportional widths (%) for every column — keeps the header and
// body cells locked to the exact same grid regardless of content length,
// while still stretching to fill the full width of whatever screen it's on
// (a hardcoded pixel sum would leave dead space on wide screens instead).
const COL_WIDTHS = ["4%", "9%", "12%", "16%", "8%", "8%", "10%", "12%", "10%", "11%"];

function toDDMMYYYY(dateStr: string): string {
  const d = new Date(dateStr);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

function firstDayOfMonth(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function ColumnFilter({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-block">
      <button
        className={`ml-1 align-middle ${value ? "text-brand-primary" : "text-gray-400"} hover:text-brand-primary`}
        onClick={() => setOpen((v) => !v)}
        title={`Filter ${label}`}
      >
        <Filter size={12} />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-44 rounded-md border border-gray-200 bg-white p-2 shadow-lg">
          <input
            autoFocus
            className="input !py-1 w-full text-xs"
            placeholder={`Filter ${label}...`}
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
          {value && (
            <button className="mt-1 text-[11px] text-gray-400 hover:text-brand-danger" onClick={() => onChange("")}>
              Clear
            </button>
          )}
        </div>
      )}
    </span>
  );
}


export function AllTransactions() {
  const [rows, setRows] = useState<TxnRow[]>([]);
  const [search, setSearch] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [refFilter, setRefFilter] = useState("");
  const [partyFilter, setPartyFilter] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Report type (All/Sale/Purchase) is the SINGLE control for "what kind of
  // transaction am I looking at" — it drives the on-screen table below as
  // well as the print/Excel report, rather than having two separate type
  // toggles (the table used to have its own independent column filter,
  // which looked broken since picking "Sale" up top did nothing to the list).
  const [reportType, setReportType] = useState<ReportType>("All");
  const [reportFrom, setReportFrom] = useState(firstDayOfMonth());
  const [reportTo, setReportTo] = useState(today());

  useEffect(() => {
    load();
    const channel = supabase
      .channel("all-transactions-page")
      .on("postgres_changes", { event: "*", schema: "public", table: "sales" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "wholesaler_invoices" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "third_party_purchases" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function load() {
    const [{ data: sales }, { data: wholesaler }, { data: thirdParty }] = await Promise.all([
      // Note: the live `customers` table has no GSTIN column (schema drift
      // vs. the aspirational Customer type elsewhere in this repo) — GSTIN
      // is shown as "-" for every row rather than fabricating a data source.
      supabase
        .from("sales")
        .select("id, invoice_number, customer_name, final_amount, payment_status, payment_method, created_at"),
      supabase
        .from("wholesaler_invoices")
        .select("id, invoice_number, wholesaler_name, total_amount, paid_amount, due_amount, payment_status, invoice_date"),
      supabase.from("third_party_purchases").select("id, vendor_name, total_price, purchase_date"),
    ]);

    const combined: TxnRow[] = [
      ...((sales ?? []) as any[]).map((s) => ({
        id: `sale-${s.id}`,
        date: s.created_at,
        refNo: s.invoice_number,
        partyName: s.customer_name,
        gstin: null,
        paymentType: (s.payment_method ?? "-").toString().replace(/_/g, " "),
        type: "Sale" as const,
        total: Number(s.final_amount ?? 0),
        received: s.payment_status === "paid" ? Number(s.final_amount ?? 0) : 0,
        balance: s.payment_status === "paid" ? 0 : Number(s.final_amount ?? 0),
        source: "sale" as const,
        sourceId: s.id,
      })),
      ...((wholesaler ?? []) as any[]).map((w) => ({
        id: `wholesaler-${w.id}`,
        date: w.invoice_date,
        refNo: w.invoice_number || w.id.slice(0, 8).toUpperCase(),
        partyName: w.wholesaler_name,
        gstin: null,
        paymentType: w.payment_status ?? "-",
        type: "Purchase" as const,
        total: Number(w.total_amount ?? 0),
        received: Number(w.paid_amount ?? 0),
        balance: Number(w.due_amount ?? 0),
        source: "wholesaler" as const,
        sourceId: w.id,
      })),
      ...((thirdParty ?? []) as any[]).map((t) => ({
        id: `tpp-${t.id}`,
        date: t.purchase_date,
        refNo: `TPP-${t.id.slice(0, 8).toUpperCase()}`,
        partyName: t.vendor_name,
        gstin: null,
        paymentType: "Cash",
        type: "Purchase" as const,
        total: Number(t.total_price ?? 0),
        received: Number(t.total_price ?? 0),
        balance: 0,
        source: "third_party" as const,
        sourceId: t.id,
      })),
    ].sort((a, b) => (a.date < b.date ? -1 : 1));

    setRows(combined);
  }

  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        if (reportType !== "All" && r.type !== reportType) return false;
        if (dateFilter && !formatDate(r.date).toLowerCase().includes(dateFilter.toLowerCase())) return false;
        if (refFilter && !r.refNo.toLowerCase().includes(refFilter.toLowerCase())) return false;
        if (partyFilter && !r.partyName?.toLowerCase().includes(partyFilter.toLowerCase())) return false;
        if (search) {
          const q = search.toLowerCase();
          if (!r.refNo.toLowerCase().includes(q) && !r.partyName?.toLowerCase().includes(q)) return false;
        }
        return true;
      }),
    [rows, reportType, dateFilter, refFilter, partyFilter, search]
  );

  // Rows for the currently selected report (type + date range) — separate
  // from `filtered` above, which only drives the on-screen table.
  const reportRows = useMemo(
    () =>
      rows.filter((r) => {
        if (reportType !== "All" && r.type !== reportType) return false;
        const d = r.date.slice(0, 10);
        if (reportFrom && d < reportFrom) return false;
        if (reportTo && d > reportTo) return false;
        return true;
      }),
    [rows, reportType, reportFrom, reportTo]
  );

  const reportTotal = reportRows.reduce((sum, r) => sum + r.total, 0);

  async function printTransaction(row: TxnRow, mode: "print" | "view" = "print") {
    // Opened synchronously, still inside the click's user-gesture window —
    // opening it after the awaits below would get silently popup-blocked.
    const win = openBlankInvoiceWindow();
    setBusyId(row.id);
    setMenuOpenId(null);
    try {
      if (row.source === "sale") {
        const { data: sale, error: saleErr } = await supabase.from("sales").select("*").eq("id", row.sourceId).single();
        if (saleErr) throw saleErr;
        const { data: items, error: itemsErr } = await supabase
          .from("sales_items")
          .select("item_name, quantity, total_price, serial_no")
          .eq("sale_id", row.sourceId);
        if (itemsErr) throw itemsErr;
        openRetailTaxInvoice({
          invoiceNumber: sale.invoice_number,
          createdAt: sale.created_at,
          customerName: sale.customer_name,
          customerPhone: sale.customer_phone,
          paymentMethod: sale.payment_method,
          receivedAmount: sale.payment_status === "paid" ? sale.final_amount : undefined,
          items: (items ?? []).map((i: any) => ({ name: i.item_name, quantity: i.quantity, totalPrice: i.total_price, serialNo: i.serial_no ?? null })),
          totalAmount: sale.final_amount,
          shop: SHOP,
          mode,
        }, win);
      } else if (row.source === "wholesaler") {
        const { data: inv, error } = await supabase.from("wholesaler_invoices").select("*").eq("id", row.sourceId).single();
        if (error) throw error;
        const rawItems = Array.isArray(inv.items) ? (inv.items as any[]) : [];
        const items = rawItems.length > 0
          ? rawItems.map((it) => ({ name: it.name ?? it.item_name ?? "Item", quantity: it.qty ?? it.quantity ?? 1, totalPrice: it.total_price ?? it.totalPrice ?? 0 }))
          : [{ name: inv.notes || "Wholesale Purchase", quantity: 1, totalPrice: inv.total_amount }];
        openPurchaseBill({
          billNumber: inv.invoice_number || inv.id.slice(0, 8).toUpperCase(),
          billDate: inv.invoice_date,
          supplierName: inv.wholesaler_name,
          paymentMode: inv.payment_status === "paid" ? "paid in full" : inv.payment_status,
          paidAmount: inv.paid_amount,
          items,
          totalAmount: inv.total_amount,
          shop: SHOP,
          mode,
        }, win);
      } else {
        const { data: p, error } = await supabase.from("third_party_purchases").select("*").eq("id", row.sourceId).single();
        if (error) throw error;
        openPurchaseBill({
          billNumber: `TPP-${p.id.slice(0, 8).toUpperCase()}`,
          billDate: p.purchase_date,
          supplierName: p.vendor_name,
          paymentMode: "cash",
          paidAmount: p.total_price,
          items: [{ name: p.item_name, quantity: p.quantity, totalPrice: p.total_price }],
          totalAmount: p.total_price,
          shop: SHOP,
          mode,
        }, win);
      }
    } catch (err: any) {
      win?.close();
      alert(err?.message || "Failed to generate document.");
    } finally {
      setBusyId(null);
    }
  }

  async function shareTransaction(row: TxnRow) {
    setMenuOpenId(null);
    const text = `${row.type} · ${row.refNo} · ${row.partyName} · ${formatCurrency(row.total)}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: row.refNo, text });
        return;
      } catch {
        /* user cancelled or share failed — fall back to clipboard */
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      alert("Copied to clipboard: " + text);
    } catch {
      alert(text);
    }
  }

  // Printable report — mirrors the shop's existing "Sale Report" paper
  // format: branded header, title, duration, a flat transaction table, and
  // a grand-total footer with a generated timestamp.
  function printReport() {
    const title = reportType === "All" ? "All Transactions Report" : `${reportType} Report`;
    const rowsHtml = reportRows
      .map(
        (r) => `<tr>
          <td>${toDDMMYYYY(r.date)}</td>
          <td>${r.refNo}</td>
          <td>${r.partyName}</td>
          <td>${r.gstin ?? "-"}</td>
          <td class="tr">₹ ${r.total.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
          <td>${r.paymentType}</td>
          <td class="tr">₹ ${r.received.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
          <td class="tr">₹ ${r.balance.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
        </tr>`
      )
      .join("");

    const generatedAt = new Date().toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true });

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${title} - ${SHOP.name}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; }
  body { background: #fff; padding: 24px; color: #1a202c; }
  .header { display: flex; align-items: center; gap: 16px; border-bottom: 1.5px solid #2d3748; padding-bottom: 12px; margin-bottom: 16px; }
  .header img { width: 84px; height: 68px; object-fit: contain; border-radius: 4px; }
  .header h1 { font-size: 20px; font-weight: 800; }
  .header .addr { font-size: 11px; color: #333; margin-top: 2px; }
  .header .meta { font-size: 11px; color: #333; margin-top: 4px; }
  .title { text-align: center; font-size: 22px; font-weight: 700; text-decoration: underline; margin: 16px 0; }
  .info { font-size: 14px; font-weight: 700; margin-bottom: 6px; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 12px; }
  th, td { border: 1px solid #cbd5e0; padding: 6px 8px; text-align: left; }
  th { background: #edf2f7; font-weight: 700; text-transform: uppercase; font-size: 10.5px; }
  .tr { text-align: right; }
  .footer { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 20px; }
  .grand-total { font-size: 16px; font-weight: 800; text-decoration: underline; }
  .generated { font-size: 11px; color: #666; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>
  <div class="header">
    <img src="${window.location.origin}/logo.png" alt="${SHOP.name}" />
    <div>
      <h1>${SHOP.name.toUpperCase()}</h1>
      <div class="addr">${SHOP.address}</div>
      <div class="meta">Phone no.: ${SHOP.phone} Email: ${SHOP.email.toUpperCase()}</div>
      <div class="meta">GSTIN: ${SHOP.gstNumber}, State: ${SHOP.state}</div>
    </div>
  </div>

  <div class="title">${title}</div>
  <div class="info">Duration: From ${toDDMMYYYY(reportFrom)} to ${toDDMMYYYY(reportTo)}</div>
  <div class="info">User: All Users</div>

  <table>
    <thead>
      <tr>
        <th>Date</th>
        <th>Invoice No.</th>
        <th>Party Name</th>
        <th>GSTIN</th>
        <th class="tr">Total</th>
        <th>Payment Type</th>
        <th class="tr">Received / Paid</th>
        <th class="tr">Balance Due</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml || `<tr><td colspan="8" style="text-align:center; color:#888;">No transactions in this range.</td></tr>`}
    </tbody>
  </table>

  <div class="footer">
    <div class="generated">Generated on ${generatedAt}</div>
    <div class="grand-total">Total ${reportType === "All" ? "Transactions" : reportType}: ₹ ${reportTotal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</div>
  </div>

  <script>window.onload = () => window.print();</script>
</body>
</html>`;

    const win = window.open("", "_blank", "width=960,height=1000");
    if (!win) return;
    win.document.write(html);
    win.document.close();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold text-gray-800">All Transactions</h1>
      </div>

      <div className="card space-y-3 p-3">
        <div className="flex flex-wrap items-end gap-3 border-b border-border pb-3">
          <div>
            <span className="mb-1 block text-xs font-medium text-gray-500">Report</span>
            <div className="flex overflow-hidden rounded-md border border-gray-300">
              {(["All", "Sale", "Purchase"] as ReportType[]).map((t) => (
                <button
                  key={t}
                  className={`px-3 py-1.5 text-xs font-medium ${
                    reportType === t ? "bg-brand-primary text-white" : "bg-white text-gray-600 hover:bg-gray-50"
                  }`}
                  onClick={() => setReportType(t)}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div>
            <span className="mb-1 block text-xs font-medium text-gray-500">From</span>
            <input type="date" className="input !w-auto" value={reportFrom} onChange={(e) => setReportFrom(e.target.value)} />
          </div>
          <div>
            <span className="mb-1 block text-xs font-medium text-gray-500">To</span>
            <input type="date" className="input !w-auto" value={reportTo} onChange={(e) => setReportTo(e.target.value)} />
          </div>
          <button className="btn-primary" onClick={printReport}>
            <FileText size={14} /> Print Report
          </button>
          <ExportExcelButton
            rows={reportRows.map((r) => ({
              Date: toDDMMYYYY(r.date),
              "Invoice No.": r.refNo,
              "Party Name": r.partyName,
              GSTIN: r.gstin ?? "-",
              Type: r.type,
              Total: r.total,
              "Payment Type": r.paymentType,
              "Received / Paid": r.received,
              "Balance Due": r.balance,
            }))}
            fileName={`${reportType.toLowerCase()}-report-${reportFrom}-to-${reportTo}`}
            sheetName={reportType === "All" ? "All Transactions" : `${reportType} Report`}
          />
          <span className="ml-auto text-xs text-gray-500">
            {reportRows.length} record{reportRows.length === 1 ? "" : "s"} · Total{" "}
            <span className="font-semibold text-gray-800">{formatCurrency(reportTotal)}</span>
          </span>
        </div>

        <div className="relative max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" size={15} />
          <input
            className="input w-full !pl-8"
            placeholder="Search ref no. or party name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="overflow-x-auto">
          <table className="table-base" style={{ tableLayout: "fixed", width: "100%", minWidth: 950 }}>
            <colgroup>
              {COL_WIDTHS.map((w, i) => (
                <col key={i} style={{ width: w }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th>#</th>
                <th>
                  Date <ColumnFilter label="Date" value={dateFilter} onChange={setDateFilter} />
                </th>
                <th>
                  Ref No. <ColumnFilter label="Ref No." value={refFilter} onChange={setRefFilter} />
                </th>
                <th>
                  Party Name <ColumnFilter label="Party Name" value={partyFilter} onChange={setPartyFilter} />
                </th>
                <th>Category</th>
                <th>Type</th>
                <th className="text-right">Total</th>
                <th className="text-right">Received Amount</th>
                <th className="text-right">Balance</th>
                <th className="text-right">Print / Share</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr
                  key={r.id}
                  className={`cursor-pointer ${selectedId === r.id ? "bg-brand-primary/5" : ""}`}
                  onClick={() => setSelectedId(r.id)}
                >
                  <td className="text-gray-500">{i + 1}</td>
                  <td className="truncate">{formatDate(r.date)}</td>
                  <td className="truncate font-medium text-brand-primary">{r.refNo}</td>
                  <td className="truncate font-medium text-gray-800">{r.partyName}</td>
                  <td className="text-gray-400">-</td>
                  <td className={r.type === "Sale" ? "text-emerald-600" : "text-amber-600"}>{r.type}</td>
                  <td className="text-right font-medium">{formatCurrency(r.total)}</td>
                  <td className="text-right">{formatCurrency(r.received)}</td>
                  <td className={`text-right ${r.balance > 0 ? "text-brand-danger font-medium" : ""}`}>{formatCurrency(r.balance)}</td>
                  <td className="text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-2">
                      <button
                        className="text-gray-500 hover:text-brand-primary disabled:opacity-40"
                        disabled={busyId === r.id}
                        onClick={() => printTransaction(r, "print")}
                        title="Print"
                      >
                        <Printer size={15} />
                      </button>
                      <button className="text-gray-500 hover:text-brand-primary" onClick={() => shareTransaction(r)} title="Share">
                        <Share2 size={15} />
                      </button>
                      <span className="relative">
                        <button
                          className="text-gray-500 hover:text-brand-primary"
                          onClick={() => setMenuOpenId(menuOpenId === r.id ? null : r.id)}
                          title="More"
                        >
                          <MoreVertical size={15} />
                        </button>
                        {menuOpenId === r.id && (
                          <div className="absolute right-0 top-full z-20 mt-1 w-36 rounded-md border border-gray-200 bg-white py-1 text-xs shadow-lg">
                            <button className="block w-full px-3 py-1.5 text-left hover:bg-gray-50" onClick={() => printTransaction(r, "view")}>
                              View
                            </button>
                            <button className="block w-full px-3 py-1.5 text-left hover:bg-gray-50" onClick={() => printTransaction(r, "print")}>
                              Print
                            </button>
                          </div>
                        )}
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={10} className="py-8 text-center text-gray-400">
                    No transactions found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
