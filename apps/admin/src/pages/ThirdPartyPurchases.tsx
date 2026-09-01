import { useEffect, useState } from "react";
import { formatCurrency, formatDate } from "@sai/shared";
import { supabase } from "../lib/supabase";
import { ExportExcelButton } from "../components/ExportExcelButton";
import { Plus } from "lucide-react";

interface ThirdPartyPurchase {
  id: string;
  vendor_name: string;
  item_name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  purchase_date: string;
  notes: string | null;
}

const empty = { vendor_name: "", item_name: "", quantity: 1, unit_price: 0, purchase_date: new Date().toISOString().slice(0, 10), notes: "" };

export function ThirdPartyPurchases() {
  const [rows, setRows] = useState<ThirdPartyPurchase[]>([]);
  const [form, setForm] = useState(empty);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const { data } = await supabase.from("third_party_purchases").select("*").order("purchase_date", { ascending: false });
    setRows((data as ThirdPartyPurchase[]) ?? []);
  }

  async function add() {
    if (!form.vendor_name || !form.item_name) return;
    await supabase.from("third_party_purchases").insert({
      vendor_name: form.vendor_name,
      item_name: form.item_name,
      quantity: form.quantity,
      unit_price: form.unit_price,
      total_price: form.quantity * form.unit_price,
      purchase_date: form.purchase_date,
      notes: form.notes || null,
    });
    setForm(empty);
    setShowForm(false);
    load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-800">Third-Party Purchases</h1>
        <div className="flex gap-2">
          <ExportExcelButton
            rows={rows.map((r) => ({ Vendor: r.vendor_name, Item: r.item_name, Qty: r.quantity, "Unit Price": r.unit_price, Total: r.total_price, Date: r.purchase_date }))}
            fileName="third-party-purchases"
          />
          <button className="btn-primary" onClick={() => setShowForm(true)}>
            <Plus size={14} /> Add Purchase
          </button>
        </div>
      </div>
      <p className="text-sm text-gray-500">External purchases for repairs or resale — not linked to main inventory stock.</p>

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>Vendor</th>
              <th>Item</th>
              <th className="text-right">Qty</th>
              <th className="text-right">Total</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="font-medium">{r.vendor_name}</td>
                <td>{r.item_name}</td>
                <td className="text-right">{r.quantity}</td>
                <td className="text-right">{formatCurrency(r.total_price)}</td>
                <td className="text-gray-500">{formatDate(r.purchase_date)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="py-8 text-center text-gray-400">No purchases logged</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/30">
          <div className="card w-96 space-y-2.5 p-5">
            <h2 className="mb-2 text-sm font-semibold text-gray-800">Add Purchase</h2>
            <input className="input" placeholder="Vendor" value={form.vendor_name} onChange={(e) => setForm({ ...form, vendor_name: e.target.value })} />
            <input className="input" placeholder="Item name" value={form.item_name} onChange={(e) => setForm({ ...form, item_name: e.target.value })} />
            <div className="grid grid-cols-2 gap-2">
              <input type="number" className="input" placeholder="Quantity" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })} />
              <input type="number" className="input" placeholder="Unit price" value={form.unit_price} onChange={(e) => setForm({ ...form, unit_price: Number(e.target.value) })} />
            </div>
            <input type="date" className="input" value={form.purchase_date} onChange={(e) => setForm({ ...form, purchase_date: e.target.value })} />
            <textarea className="input" placeholder="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            <div className="flex justify-end gap-2 pt-2">
              <button className="btn-ghost" onClick={() => setShowForm(false)}>Cancel</button>
              <button className="btn-primary" onClick={add}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
