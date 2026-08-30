import { useEffect, useState } from "react";
import { formatCurrency, formatDateTime, generateGstInvoicePdf, type Sale, type SaleItem, type Customer, type Product } from "@sai/shared";
import { supabase, SHOP } from "../lib/supabase";
import { ExportExcelButton } from "../components/ExportExcelButton";
import { StatusPill } from "../components/StatusPill";
import { FileText } from "lucide-react";

type SaleRow = Sale & { customer?: Customer | null; profit?: number };

export function Sales() {
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [saleType, setSaleType] = useState<"all" | "online" | "offline">("all");
  const [gstFilter, setGstFilter] = useState<"all" | "gst" | "non-gst">("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const { data } = await supabase
      .from("sales")
      .select("*, customer:customers(*)")
      .order("created_at", { ascending: false });
    if (!data) return;

    setSales(
      data.map((s: any) => ({
        ...s,
        profit: Number(s.total_amount || 0) - Number(s.purchase_total || 0),
      }))
    );
  }

  async function printInvoice(sale: SaleRow) {
    const { data: items } = await supabase
      .from("sale_items")
      .select("*, product:products(*)")
      .eq("sale_id", sale.id);
    generateGstInvoicePdf({
      sale,
      items: (items as (SaleItem & { product: Product })[]) ?? [],
      customer: sale.customer ?? null,
      shop: SHOP,
    });
  }

  const filtered = sales.filter((s) => {
    if (saleType !== "all" && s.sale_type !== saleType) return false;
    if (gstFilter === "gst" && !s.gst_applicable) return false;
    if (gstFilter === "non-gst" && s.gst_applicable) return false;
    if (dateFrom && s.created_at < dateFrom) return false;
    if (dateTo && s.created_at > dateTo + "T23:59:59") return false;
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-800">Sales & Invoices</h1>
        <ExportExcelButton
          rows={filtered.map((s) => ({
            Invoice: s.invoice_number,
            Customer: s.customer?.name ?? "Walk-in",
            Type: s.sale_type,
            GST: s.gst_applicable ? "Yes" : "No",
            Total: s.total_amount,
            Profit: s.profit,
            Date: s.created_at,
            "Staff Notes": s.staff_notes,
          }))}
          fileName="sales"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select className="input w-auto" value={saleType} onChange={(e) => setSaleType(e.target.value as any)}>
          <option value="all">Online + Offline</option>
          <option value="online">Online only</option>
          <option value="offline">Offline only</option>
        </select>
        <select className="input w-auto" value={gstFilter} onChange={(e) => setGstFilter(e.target.value as any)}>
          <option value="all">GST + Non-GST</option>
          <option value="gst">GST only</option>
          <option value="non-gst">Non-GST only</option>
        </select>
        <input type="date" className="input w-auto" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        <span className="text-sm text-gray-400">to</span>
        <input type="date" className="input w-auto" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
      </div>

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>Invoice</th>
              <th>Customer</th>
              <th>Type</th>
              <th>GST</th>
              <th className="text-right">Total</th>
              <th className="text-right">Profit</th>
              <th>Date</th>
              <th>Staff Notes</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => (
              <tr key={s.id}>
                <td className="font-medium">{s.invoice_number}</td>
                <td>{s.customer?.name ?? "Walk-in"}</td>
                <td>
                  <StatusPill status={s.sale_type} />
                </td>
                <td>{s.gst_applicable ? <StatusPill status="paid" label="GST" /> : "-"}</td>
                <td className="text-right">{formatCurrency(s.total_amount)}</td>
                <td className="text-right text-brand-success">{formatCurrency(s.profit)}</td>
                <td className="text-gray-500">{formatDateTime(s.created_at)}</td>
                <td className="max-w-[16rem] truncate text-gray-500" title={s.staff_notes ?? ""}>
                  {s.staff_notes || "-"}
                </td>
                <td>
                  <button className="btn-ghost" onClick={() => printInvoice(s)}>
                    <FileText size={14} /> PDF
                  </button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="py-8 text-center text-gray-400">
                  No sales found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
