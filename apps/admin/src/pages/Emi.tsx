import { useEffect, useState } from "react";
import { formatCurrency, formatDate } from "@sai/shared";
import { supabase } from "../lib/supabase";
import { ExportExcelButton } from "../components/ExportExcelButton";
import { Plus, X } from "lucide-react";

interface EmiRecord {
  id: string;
  customer_name: string;
  phone: string;
  product_name: string;
  total_amount: number;
  down_payment: number;
  loan_amount: number;
  emi_months: number;
  emi_amount: number;
  finance_company: string | null;
  status: string;
  start_date: string;
  notes: string | null;
}

const empty = {
  customer_name: "",
  phone: "",
  product_name: "",
  total_amount: 0,
  down_payment: 0,
  emi_months: 6,
  finance_company: "",
};

export function Emi() {
  const [records, setRecords] = useState<EmiRecord[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(empty);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    load();
    const channel = supabase
      .channel("emi-finance-page")
      .on("postgres_changes", { event: "*", schema: "public", table: "emi_finance" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function load() {
    const { data } = await supabase.from("emi_finance").select("*").order("start_date", { ascending: false });
    setRecords((data as EmiRecord[]) ?? []);
  }

  async function setStatus(id: string, status: string) {
    await supabase.from("emi_finance").update({ status }).eq("id", id);
    load();
  }

  async function addRecord() {
    if (!form.customer_name.trim() || !form.phone.trim() || !form.product_name.trim()) {
      setError("Customer name, phone and product are required.");
      return;
    }
    setError(null);
    const loanAmount = form.total_amount - form.down_payment;
    const emiAmount = form.emi_months > 0 ? Math.ceil(loanAmount / form.emi_months) : 0;
    const { error: insertErr } = await supabase.from("emi_finance").insert({
      customer_name: form.customer_name.trim(),
      phone: form.phone.trim(),
      product_name: form.product_name.trim(),
      total_amount: form.total_amount,
      down_payment: form.down_payment,
      loan_amount: loanAmount,
      emi_months: form.emi_months,
      emi_amount: emiAmount,
      finance_company: form.finance_company.trim() || null,
      status: "active",
    });
    if (insertErr) {
      setError(insertErr.message);
      return;
    }
    setForm(empty);
    setShowForm(false);
    load();
  }

  const outstanding = records.filter((r) => r.status === "active").reduce((sum, r) => sum + r.loan_amount, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-800">EMI / Finance</h1>
        <div className="flex gap-2">
          <ExportExcelButton
            rows={records.map((r) => ({
              Customer: r.customer_name,
              Phone: r.phone,
              Product: r.product_name,
              "Loan Amount": r.loan_amount,
              "EMI/mo": r.emi_amount,
              Months: r.emi_months,
              Company: r.finance_company,
              Status: r.status,
              "Start Date": r.start_date,
            }))}
            fileName="emi-finance"
          />
          <button className="btn-primary" onClick={() => setShowForm(true)}>
            <Plus size={14} /> Add EMI
          </button>
        </div>
      </div>

      <div className="card p-4">
        <span className="text-sm text-gray-500">Total outstanding (active EMIs)</span>
        <div className="text-2xl font-bold text-brand-primary">{formatCurrency(outstanding)}</div>
      </div>

      {error && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-brand-danger">{error}</div>}

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>Customer</th>
              <th>Product</th>
              <th className="text-right">Loan</th>
              <th className="text-right">EMI/mo</th>
              <th>Company</th>
              <th>Status</th>
              <th>Start Date</th>
            </tr>
          </thead>
          <tbody>
            {records.map((r) => (
              <tr key={r.id}>
                <td className="font-medium">
                  {r.customer_name}
                  <div className="text-xs font-normal text-gray-400">{r.phone}</div>
                </td>
                <td>{r.product_name}</td>
                <td className="text-right">{formatCurrency(r.loan_amount)}</td>
                <td className="text-right">{formatCurrency(r.emi_amount)} ×{r.emi_months}</td>
                <td className="text-gray-500">{r.finance_company ?? "-"}</td>
                <td>
                  <select className="input !w-auto !py-1 text-xs" value={r.status} onChange={(e) => setStatus(r.id, e.target.value)}>
                    <option value="active">Active</option>
                    <option value="completed">Completed</option>
                    <option value="defaulted">Defaulted</option>
                  </select>
                </td>
                <td className="text-gray-500">{formatDate(r.start_date)}</td>
              </tr>
            ))}
            {records.length === 0 && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-gray-400">No EMI records yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/30">
          <div className="card w-96 space-y-2.5 p-5">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-800">Add EMI Record</h2>
              <button onClick={() => setShowForm(false)}><X size={16} /></button>
            </div>
            <input className="input" placeholder="Customer name *" value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} />
            <input className="input" placeholder="Phone *" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            <input className="input" placeholder="Product name *" value={form.product_name} onChange={(e) => setForm({ ...form, product_name: e.target.value })} />
            <div className="grid grid-cols-2 gap-2">
              <input type="number" className="input" placeholder="Total amount" value={form.total_amount || ""} onChange={(e) => setForm({ ...form, total_amount: Number(e.target.value) })} />
              <input type="number" className="input" placeholder="Down payment" value={form.down_payment || ""} onChange={(e) => setForm({ ...form, down_payment: Number(e.target.value) })} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input type="number" className="input" placeholder="EMI months" value={form.emi_months || ""} onChange={(e) => setForm({ ...form, emi_months: Number(e.target.value) })} />
              <input className="input" placeholder="Finance company" value={form.finance_company} onChange={(e) => setForm({ ...form, finance_company: e.target.value })} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button className="btn-ghost" onClick={() => setShowForm(false)}>Cancel</button>
              <button className="btn-primary" onClick={addRecord}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
