import { useEffect, useState } from "react";
import { formatCurrency, formatDateTime } from "@sai/shared";
import { supabase } from "../lib/supabase";
import { ExportExcelButton } from "../components/ExportExcelButton";
import { StatusPill } from "../components/StatusPill";
import { Plus, Trash2, X } from "lucide-react";

interface Customer {
  id: string;
  name: string;
  phone: string;
}
interface InventoryItem {
  id: string;
  name: string;
  model: string;
  price: number;
  stock: number;
}
interface Sale {
  id: string;
  invoice_number: string;
  customer_id: string | null;
  customer_name: string;
  customer_phone: string | null;
  sale_type: string;
  total_amount: number;
  discount: number;
  final_amount: number;
  payment_method: string;
  payment_status: string;
  notes: string | null;
  created_at: string;
}
interface CartLine {
  inventory_id: string;
  item_name: string;
  quantity: number;
  unit_price: number;
}

function nextInvoiceNumber() {
  const now = new Date();
  const ymd = now.toISOString().slice(0, 10).replace(/-/g, "");
  return `INV-${ymd}-${Math.floor(1000 + Math.random() * 9000)}`;
}

export function Sales() {
  const [sales, setSales] = useState<Sale[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [pickId, setPickId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    load();
    supabase.from("customers").select("id, name, phone").order("name").then(({ data }) => setCustomers((data as Customer[]) ?? []));
    supabase.from("inventory").select("id, name, model, price, stock").eq("is_active", true).order("name").then(({ data }) => setInventory((data as InventoryItem[]) ?? []));
    const channel = supabase
      .channel("sales-page")
      .on("postgres_changes", { event: "*", schema: "public", table: "sales" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function load() {
    const { data } = await supabase.from("sales").select("*").order("created_at", { ascending: false });
    setSales((data as Sale[]) ?? []);
  }

  function addToCart() {
    const item = inventory.find((i) => i.id === pickId);
    if (!item) return;
    setCart((prev) => {
      const existing = prev.find((l) => l.inventory_id === item.id);
      if (existing) {
        return prev.map((l) => (l.inventory_id === item.id ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return [...prev, { inventory_id: item.id, item_name: `${item.name} ${item.model}`, quantity: 1, unit_price: item.price }];
    });
    setPickId("");
  }

  function updateQty(id: string, qty: number) {
    setCart((prev) => prev.map((l) => (l.inventory_id === id ? { ...l, quantity: Math.max(1, qty) } : l)));
  }

  function removeLine(id: string) {
    setCart((prev) => prev.filter((l) => l.inventory_id !== id));
  }

  const cartTotal = cart.reduce((sum, l) => sum + l.quantity * l.unit_price, 0);

  async function createSale() {
    if (cart.length === 0) {
      setError("Add at least one item.");
      return;
    }
    if (!customerName.trim()) {
      setError("Customer name is required.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const { data: sale, error: saleErr } = await supabase
        .from("sales")
        .insert({
          invoice_number: nextInvoiceNumber(),
          customer_id: customerId || null,
          customer_name: customerName.trim(),
          customer_phone: customerPhone.trim() || null,
          sale_type: "in_store",
          total_amount: cartTotal,
          discount: 0,
          final_amount: cartTotal,
          payment_method: paymentMethod,
          payment_status: "paid",
        })
        .select()
        .single();

      if (saleErr) throw saleErr;

      const { error: itemsErr } = await supabase.from("sales_items").insert(
        cart.map((l) => ({
          sale_id: sale.id,
          inventory_id: l.inventory_id,
          item_name: l.item_name,
          quantity: l.quantity,
          unit_price: l.unit_price,
          total_price: l.quantity * l.unit_price,
        }))
      );
      if (itemsErr) throw itemsErr;

      // Deduct stock for each line — best-effort per item so one bad row
      // doesn't block the rest; the sale itself is already saved above.
      for (const l of cart) {
        const item = inventory.find((i) => i.id === l.inventory_id);
        if (!item) continue;
        await supabase.from("inventory").update({ stock: Math.max(0, item.stock - l.quantity) }).eq("id", l.inventory_id);
      }

      setCart([]);
      setCustomerId("");
      setCustomerName("");
      setCustomerPhone("");
      setShowForm(false);
      await load();
      const { data: freshInv } = await supabase.from("inventory").select("id, name, model, price, stock").eq("is_active", true).order("name");
      setInventory((freshInv as InventoryItem[]) ?? []);
    } catch (err: any) {
      setError(err?.message || "Failed to create sale.");
    } finally {
      setSaving(false);
    }
  }

  const filtered = sales.filter((s) => {
    if (dateFrom && s.created_at < dateFrom) return false;
    if (dateTo && s.created_at > dateTo + "T23:59:59") return false;
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-800">Sales & Invoices</h1>
        <div className="flex gap-2">
          <ExportExcelButton
            rows={filtered.map((s) => ({
              Invoice: s.invoice_number,
              Customer: s.customer_name,
              Type: s.sale_type,
              Total: s.final_amount,
              Payment: `${s.payment_method} (${s.payment_status})`,
              Date: s.created_at,
            }))}
            fileName="sales"
          />
          <button className="btn-primary" onClick={() => setShowForm(true)}>
            <Plus size={14} /> New Sale
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
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
              <th className="text-right">Total</th>
              <th>Payment</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => (
              <tr key={s.id}>
                <td className="font-medium">{s.invoice_number}</td>
                <td>{s.customer_name}</td>
                <td>
                  <StatusPill status={s.sale_type} />
                </td>
                <td className="text-right">{formatCurrency(s.final_amount)}</td>
                <td className="text-gray-500 capitalize">{s.payment_method} · {s.payment_status}</td>
                <td className="text-gray-500">{formatDateTime(s.created_at)}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="py-8 text-center text-gray-400">
                  No sales found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4">
          <div className="card w-full max-w-lg p-5 space-y-3">
            <div className="flex items-center justify-between border-b border-border pb-2">
              <h2 className="text-sm font-semibold text-gray-800">New Sale</h2>
              <button onClick={() => setShowForm(false)}><X size={16} /></button>
            </div>

            {error && <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-brand-danger">{error}</div>}

            <select
              className="input"
              value={customerId}
              onChange={(e) => {
                const c = customers.find((x) => x.id === e.target.value);
                setCustomerId(e.target.value);
                setCustomerName(c?.name ?? customerName);
                setCustomerPhone(c?.phone ?? customerPhone);
              }}
            >
              <option value="">Walk-in / choose existing customer</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>{c.name} · {c.phone}</option>
              ))}
            </select>
            <div className="grid grid-cols-2 gap-2">
              <input className="input" placeholder="Customer name *" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
              <input className="input" placeholder="Phone" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} />
            </div>

            <div className="flex gap-2">
              <select className="input flex-1" value={pickId} onChange={(e) => setPickId(e.target.value)}>
                <option value="">Select an item to add...</option>
                {inventory.map((i) => (
                  <option key={i.id} value={i.id}>{i.name} {i.model} — {formatCurrency(i.price)} ({i.stock} in stock)</option>
                ))}
              </select>
              <button className="btn-secondary" onClick={addToCart} disabled={!pickId}>Add</button>
            </div>

            <div className="max-h-48 space-y-1 overflow-y-auto">
              {cart.map((l) => (
                <div key={l.inventory_id} className="flex items-center gap-2 rounded border border-gray-200 p-2 text-sm">
                  <span className="flex-1">{l.item_name}</span>
                  <input
                    type="number"
                    className="input !w-16 !py-0.5 text-right"
                    value={l.quantity}
                    onChange={(e) => updateQty(l.inventory_id, Number(e.target.value))}
                  />
                  <span className="w-20 text-right font-medium">{formatCurrency(l.quantity * l.unit_price)}</span>
                  <button onClick={() => removeLine(l.inventory_id)} className="text-brand-danger"><Trash2 size={13} /></button>
                </div>
              ))}
              {cart.length === 0 && <p className="text-sm text-gray-400">No items added yet.</p>}
            </div>

            <div className="flex items-center justify-between border-t border-border pt-2">
              <select className="input !w-auto" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                <option value="cash">Cash</option>
                <option value="card">Card</option>
                <option value="upi">UPI</option>
                <option value="bank_transfer">Bank Transfer</option>
              </select>
              <span className="text-lg font-bold text-brand-primary">{formatCurrency(cartTotal)}</span>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button className="btn-ghost" onClick={() => setShowForm(false)} disabled={saving}>Cancel</button>
              <button className="btn-primary" onClick={createSale} disabled={saving}>
                {saving ? "Saving..." : "Complete Sale"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
