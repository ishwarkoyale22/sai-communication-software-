import { useEffect, useMemo, useState } from "react";
import { formatCurrency, softDelete } from "@sai/shared";
import { supabase } from "../lib/supabase";
import { ExportExcelButton } from "../components/ExportExcelButton";
import { Plus, Trash2, X, Sparkles } from "lucide-react";

interface Gift {
  id: string;
  name: string;
  price: number;
  cost_price: number;
  stock: number;
  sold_qty: number;
  is_active: boolean;
  created_at: string;
}

interface GiftSaleRow {
  id: string;
  gift_id: string;
  quantity: number;
  unit_price: number;
  unit_cost: number;
  created_at: string;
}

const empty = { name: "", price: 0, cost_price: 0, stock: 0 };

type ReportPeriod = "weekly" | "monthly" | "yearly";

function periodStart(period: ReportPeriod): Date {
  const d = new Date();
  if (period === "weekly") {
    d.setDate(d.getDate() - 7);
  } else if (period === "monthly") {
    d.setMonth(d.getMonth() - 1);
  } else {
    d.setFullYear(d.getFullYear() - 1);
  }
  return d;
}

export function Gifts() {
  const [gifts, setGifts] = useState<Gift[]>([]);
  const [giftSales, setGiftSales] = useState<GiftSaleRow[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Gift | null>(null);
  const [form, setForm] = useState(empty);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<ReportPeriod>("monthly");

  useEffect(() => {
    load();
    const channel = supabase
      .channel("gifts-page")
      .on("postgres_changes", { event: "*", schema: "public", table: "gifts" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "gift_sales" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function load() {
    const [{ data: g }, { data: gs }] = await Promise.all([
      supabase.from("gifts").select("*").order("name"),
      supabase.from("gift_sales").select("id, gift_id, quantity, unit_price, unit_cost, created_at").order("created_at", { ascending: false }),
    ]);
    setGifts((g as Gift[]) ?? []);
    setGiftSales((gs as GiftSaleRow[]) ?? []);
  }

  function giftName(id: string) {
    return gifts.find((g) => g.id === id)?.name ?? "Deleted gift";
  }

  const totals = useMemo(() => {
    return gifts.reduce(
      (acc, g) => {
        acc.stock += g.stock;
        acc.sold += g.sold_qty;
        acc.revenue += g.price * g.sold_qty;
        acc.cost += g.cost_price * g.sold_qty;
        return acc;
      },
      { stock: 0, sold: 0, revenue: 0, cost: 0 }
    );
  }, [gifts]);

  const reportRows = useMemo(() => {
    const since = periodStart(period).getTime();
    const inRange = giftSales.filter((s) => new Date(s.created_at).getTime() >= since);
    const byGift: Record<string, { name: string; qty: number; revenue: number; cost: number }> = {};
    for (const s of inRange) {
      const key = s.gift_id;
      byGift[key] = byGift[key] ?? { name: giftName(s.gift_id), qty: 0, revenue: 0, cost: 0 };
      byGift[key].qty += s.quantity;
      byGift[key].revenue += s.unit_price * s.quantity;
      byGift[key].cost += s.unit_cost * s.quantity;
    }
    return Object.values(byGift).sort((a, b) => b.revenue - a.revenue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [giftSales, period, gifts]);

  function openAdd() {
    setEditing(null);
    setForm(empty);
    setError(null);
    setShowForm(true);
  }
  function openEdit(g: Gift) {
    setEditing(g);
    setForm({ name: g.name, price: g.price, cost_price: g.cost_price, stock: g.stock });
    setError(null);
    setShowForm(true);
  }

  async function save() {
    if (!form.name.trim()) {
      setError("Gift name is required.");
      return;
    }
    setError(null);
    const payload = {
      name: form.name.trim(),
      price: Number(form.price) || 0,
      cost_price: Number(form.cost_price) || 0,
      stock: Number(form.stock) || 0,
    };
    const { error: err } = editing
      ? await supabase.from("gifts").update(payload).eq("id", editing.id)
      : await supabase.from("gifts").insert({ ...payload, is_active: true });
    if (err) {
      setError(err.message);
      return;
    }
    setShowForm(false);
    setForm(empty);
    setEditing(null);
    load();
  }

  async function toggleActive(g: Gift) {
    await supabase.from("gifts").update({ is_active: !g.is_active }).eq("id", g.id);
    load();
  }

  async function removeGift(g: Gift) {
    if (!confirm(`Delete "${g.name}"? You can restore it from the Recycle Bin afterwards.`)) return;
    const { error: delErr } = await softDelete(supabase, "gifts", g.id, g.name);
    if (delErr) await supabase.from("gifts").update({ is_active: false }).eq("id", g.id);
    load();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold text-gray-800">Gifts</h1>
        <div className="flex gap-2">
          <ExportExcelButton
            rows={gifts.map((g) => ({
              Name: g.name,
              "Sale Price": g.price,
              "Cost Price": g.cost_price,
              Stock: g.stock,
              "Sold Qty": g.sold_qty,
              "Total Sales": g.price * g.sold_qty,
              "Total Cost": g.cost_price * g.sold_qty,
              Profit: (g.price - g.cost_price) * g.sold_qty,
              Active: g.is_active ? "Yes" : "No",
            }))}
            fileName="gifts"
          />
          <button className="btn-primary" onClick={openAdd}>
            <Plus size={14} /> Add Gift
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="card p-4">
          <div className="text-xs text-gray-500">Total Stock</div>
          <div className="mt-1 font-serif text-xl font-semibold text-gray-800">{totals.stock}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-gray-500">Total Sold</div>
          <div className="mt-1 font-serif text-xl font-semibold text-gray-800">{totals.sold}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-gray-500">Total Sales</div>
          <div className="mt-1 font-serif text-xl font-semibold text-brand-primary">{formatCurrency(totals.revenue)}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-gray-500">Total Profit</div>
          <div className="mt-1 font-serif text-xl font-semibold text-brand-success">{formatCurrency(totals.revenue - totals.cost)}</div>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>Gift</th>
              <th className="text-right">Sale Price</th>
              <th className="text-right">Cost Price</th>
              <th className="text-right">Stock</th>
              <th className="text-right">Sold</th>
              <th className="text-right">Total Sales</th>
              <th className="text-right">Profit</th>
              <th>Status</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {gifts.map((g) => (
              <tr key={g.id} className={!g.is_active ? "opacity-50" : ""}>
                <td className="font-medium">{g.name}</td>
                <td className="text-right">{formatCurrency(g.price)}</td>
                <td className="text-right text-gray-500">{formatCurrency(g.cost_price)}</td>
                <td className={`text-right font-medium ${g.stock <= 0 ? "text-brand-danger" : ""}`}>{g.stock}</td>
                <td className="text-right">{g.sold_qty}</td>
                <td className="text-right">{formatCurrency(g.price * g.sold_qty)}</td>
                <td className="text-right text-brand-success">{formatCurrency((g.price - g.cost_price) * g.sold_qty)}</td>
                <td>
                  <span className={`pill-${g.is_active ? "success" : "warning"}`}>{g.is_active ? "Active" : "Inactive"}</span>
                </td>
                <td className="text-right">
                  <div className="flex justify-end gap-1">
                    <button className="btn-secondary !px-2 !py-1 text-xs" onClick={() => openEdit(g)}>Edit</button>
                    <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => toggleActive(g)}>
                      {g.is_active ? "Deactivate" : "Activate"}
                    </button>
                    <button className="btn-ghost !px-2 !py-1 text-xs text-brand-danger" onClick={() => removeGift(g)}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {gifts.length === 0 && (
              <tr>
                <td colSpan={9} className="py-8 text-center text-gray-400">No gifts yet — add one to start selling gifts from New Sale.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 font-serif text-sm font-semibold text-gray-700">
            <Sparkles size={14} className="text-brand-primary" /> Gift Sales Report
          </div>
          <div className="flex rounded-lg border border-border bg-page p-0.5">
            {(["weekly", "monthly", "yearly"] as ReportPeriod[]).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`rounded-md px-3 py-1 text-xs font-medium capitalize transition-colors ${
                  period === p ? "bg-brand-primary text-white" : "text-gray-500 hover:text-gray-800"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
        <table className="table-base">
          <thead>
            <tr>
              <th>Gift</th>
              <th className="text-right">Qty Sold</th>
              <th className="text-right">Revenue</th>
              <th className="text-right">Cost</th>
              <th className="text-right">Profit</th>
            </tr>
          </thead>
          <tbody>
            {reportRows.map((r) => (
              <tr key={r.name}>
                <td className="font-medium">{r.name}</td>
                <td className="text-right">{r.qty}</td>
                <td className="text-right">{formatCurrency(r.revenue)}</td>
                <td className="text-right text-gray-500">{formatCurrency(r.cost)}</td>
                <td className="text-right text-brand-success">{formatCurrency(r.revenue - r.cost)}</td>
              </tr>
            ))}
            {reportRows.length === 0 && (
              <tr>
                <td colSpan={5} className="py-4 text-center text-gray-400">No gift sales in this period</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/30">
          <div className="card w-96 space-y-2.5 p-5">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-800">{editing ? "Edit Gift" : "Add Gift"}</h2>
              <button onClick={() => setShowForm(false)}><X size={16} /></button>
            </div>
            {error && <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-brand-danger">{error}</div>}
            <input className="input" placeholder="Gift name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <div className="grid grid-cols-2 gap-2">
              <input type="number" className="input" placeholder="Sale price" value={form.price || ""} onChange={(e) => setForm({ ...form, price: Number(e.target.value) })} />
              <input type="number" className="input" placeholder="Cost price" value={form.cost_price || ""} onChange={(e) => setForm({ ...form, cost_price: Number(e.target.value) })} />
            </div>
            <input type="number" className="input" placeholder="Stock" value={form.stock || ""} onChange={(e) => setForm({ ...form, stock: Number(e.target.value) })} />
            <div className="flex justify-end gap-2 pt-2">
              <button className="btn-ghost" onClick={() => setShowForm(false)}>Cancel</button>
              <button className="btn-primary" onClick={save}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
