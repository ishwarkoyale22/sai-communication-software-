import { useEffect, useState } from "react";
import { formatDate, formatCurrency } from "@sai/shared";
import { supabase } from "../lib/supabase";
import { ExportExcelButton } from "../components/ExportExcelButton";
import { StatusPill } from "../components/StatusPill";
import { Plus, X } from "lucide-react";

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
              </tr>
            ))}
            {invoices.length === 0 && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-gray-400">No invoices recorded yet.</td>
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
