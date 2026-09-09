import { useEffect, useState } from "react";
import jsPDF from "jspdf";
import * as autoTableModule from "jspdf-autotable";
import { formatDate, formatCurrency } from "@sai/shared";
import { supabase, SHOP } from "../lib/supabase";
import { ExportExcelButton } from "../components/ExportExcelButton";
import { StatusPill } from "../components/StatusPill";
import { Plus, X, Download } from "lucide-react";

// jspdf-autotable's default export needs this same defensive two-level
// unwrap as packages/shared/src/simpleInvoice.ts (see the comment there) —
// Vite/rolldown's CJS interop otherwise hands back the whole module object
// instead of the callable function, and calling it throws "is not a
// function".
const autoTableExports = autoTableModule as any;
const autoTable = (
  typeof autoTableExports === "function"
    ? autoTableExports
    : typeof autoTableExports.default === "function"
      ? autoTableExports.default
      : autoTableExports.default?.default
) as (doc: jsPDF, options: any) => void;

interface WholesalerInvoice {
  id: string;
  wholesaler_name: string;
  invoice_number: string | null;
  items: unknown;
  total_amount: number;
  paid_amount: number;
  due_amount: number | null;
  payment_status: string;
  invoice_date: string;
  due_date: string | null;
  notes: string | null;
}

const empty = {
  wholesaler_name: "",
  invoice_number: "",
  total_amount: 0,
  paid_amount: 0,
  invoice_date: new Date().toISOString().slice(0, 10),
  due_date: "",
  notes: "",
};

export function WholesalerInvoices() {
  const [invoices, setInvoices] = useState<WholesalerInvoice[]>([]);
  const [form, setForm] = useState(empty);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    load();
    const channel = supabase
      .channel("wholesaler-invoices-page")
      .on("postgres_changes", { event: "*", schema: "public", table: "wholesaler_invoices" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function load() {
    const { data } = await supabase.from("wholesaler_invoices").select("*").order("invoice_date", { ascending: false });
    setInvoices((data as WholesalerInvoice[]) ?? []);
  }

  async function addInvoice() {
    if (!form.wholesaler_name.trim()) {
      setError("Wholesaler name is required.");
      return;
    }
    setError(null);
    const dueAmount = form.total_amount - form.paid_amount;
    const { error: insertErr } = await supabase.from("wholesaler_invoices").insert({
      wholesaler_name: form.wholesaler_name.trim(),
      invoice_number: form.invoice_number.trim() || null,
      items: [],
      total_amount: form.total_amount,
      paid_amount: form.paid_amount,
      due_amount: dueAmount,
      payment_status: dueAmount <= 0 ? "paid" : form.paid_amount > 0 ? "partial" : "pending",
      invoice_date: form.invoice_date,
      due_date: form.due_date || null,
      notes: form.notes || null,
    });
    if (insertErr) {
      setError(insertErr.message);
      return;
    }
    setForm(empty);
    setShowForm(false);
    load();
  }

  // No file is ever uploaded for these (no storage bucket, no file_url
  // column on the live table — recording a wholesaler invoice here is just
  // manual data entry). This generates a downloadable PDF record from that
  // data on demand instead, the same way Sales.tsx's "Download" button
  // builds a PDF from sale data rather than an uploaded file.
  function downloadInvoicePdf(inv: WholesalerInvoice) {
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text(SHOP.name, 14, 18);
    doc.setFontSize(10);
    doc.text(SHOP.address, 14, 24);
    doc.text(`Phone: ${SHOP.phone}`, 14, 29);

    doc.setFontSize(14);
    doc.text("PURCHASE RECORD", 140, 18);
    doc.setFontSize(10);
    doc.text(`Invoice #: ${inv.invoice_number ?? "-"}`, 140, 24);
    doc.text(`Date: ${formatDate(inv.invoice_date)}`, 140, 29);

    doc.text("Supplier:", 14, 40);
    doc.text(inv.wholesaler_name, 14, 45);

    autoTable(doc, {
      startY: 55,
      head: [["", "Amount"]],
      body: [
        ["Total Amount", formatCurrency(inv.total_amount)],
        ["Paid Amount", formatCurrency(inv.paid_amount)],
        ["Due Amount", formatCurrency(inv.due_amount ?? 0)],
        ["Status", inv.payment_status],
        ...(inv.due_date ? [["Due Date", formatDate(inv.due_date)]] : []),
      ],
    });

    if (inv.notes) {
      // @ts-expect-error lastAutoTable is added by jspdf-autotable at runtime
      const y = (doc.lastAutoTable?.finalY ?? 55) + 10;
      doc.setFontSize(10);
      doc.text("Notes:", 14, y);
      doc.text(doc.splitTextToSize(inv.notes, 180), 14, y + 5);
    }

    doc.save(`${inv.invoice_number || inv.wholesaler_name}.pdf`);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-800">Wholesaler Invoices</h1>
        <div className="flex gap-2">
          <ExportExcelButton
            rows={invoices.map((i) => ({
              Wholesaler: i.wholesaler_name,
              "Invoice #": i.invoice_number,
              Total: i.total_amount,
              Paid: i.paid_amount,
              Due: i.due_amount,
              Status: i.payment_status,
              Date: i.invoice_date,
            }))}
            fileName="wholesaler-invoices"
          />
          <button className="btn-primary" onClick={() => setShowForm(true)}>
            <Plus size={14} /> Add Invoice
          </button>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>Wholesaler</th>
              <th>Invoice #</th>
              <th className="text-right">Total</th>
              <th className="text-right">Paid</th>
              <th className="text-right">Due</th>
              <th>Status</th>
              <th>Date</th>
              <th className="text-right">Invoice</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((i) => (
              <tr key={i.id}>
                <td className="font-medium">{i.wholesaler_name}</td>
                <td className="text-gray-500">{i.invoice_number ?? "-"}</td>
                <td className="text-right">{formatCurrency(i.total_amount)}</td>
                <td className="text-right">{formatCurrency(i.paid_amount)}</td>
                <td className="text-right">{formatCurrency(i.due_amount ?? 0)}</td>
                <td>
                  <StatusPill status={i.payment_status} />
                </td>
                <td className="text-gray-500">{formatDate(i.invoice_date)}</td>
                <td className="text-right">
                  <button
                    className="btn-ghost !px-2 !py-1 text-xs"
                    onClick={() => downloadInvoicePdf(i)}
                    title="Download a PDF record of this invoice"
                  >
                    <Download size={13} /> Download
                  </button>
                </td>
              </tr>
            ))}
            {invoices.length === 0 && (
              <tr>
                <td colSpan={8} className="py-8 text-center text-gray-400">No invoices recorded yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/30">
          <div className="card w-96 space-y-2.5 p-5">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-800">Add Wholesaler Invoice</h2>
              <button onClick={() => setShowForm(false)}><X size={16} /></button>
            </div>
            {error && <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-brand-danger">{error}</div>}
            <input className="input" placeholder="Wholesaler name *" value={form.wholesaler_name} onChange={(e) => setForm({ ...form, wholesaler_name: e.target.value })} />
            <input className="input" placeholder="Invoice number" value={form.invoice_number} onChange={(e) => setForm({ ...form, invoice_number: e.target.value })} />
            <div className="grid grid-cols-2 gap-2">
              <input type="number" className="input" placeholder="Total amount" value={form.total_amount || ""} onChange={(e) => setForm({ ...form, total_amount: Number(e.target.value) })} />
              <input type="number" className="input" placeholder="Paid amount" value={form.paid_amount || ""} onChange={(e) => setForm({ ...form, paid_amount: Number(e.target.value) })} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input type="date" className="input" value={form.invoice_date} onChange={(e) => setForm({ ...form, invoice_date: e.target.value })} />
              <input type="date" className="input" placeholder="Due date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
            </div>
            <textarea className="input" placeholder="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            <div className="flex justify-end gap-2 pt-2">
              <button className="btn-ghost" onClick={() => setShowForm(false)}>Cancel</button>
              <button className="btn-primary" onClick={addInvoice}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
