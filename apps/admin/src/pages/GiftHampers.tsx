import { useEffect, useState } from "react";
import { formatCurrency } from "@sai/shared";
import { supabase } from "../lib/supabase";
import { ExportExcelButton } from "../components/ExportExcelButton";
import { Plus, Trash2, X } from "lucide-react";

interface HamperItem {
  id: string;
  name: string;
  category: string | null;
  price: number;
  image: string | null;
  stock: number;
  is_active: boolean;
}

const emptyForm = { name: "", category: "", price: 0, stock: 0 };

export function GiftHampers() {
  const [hampers, setHampers] = useState<HamperItem[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    load();
    const channel = supabase
      .channel("hamper-items-page")
      .on("postgres_changes", { event: "*", schema: "public", table: "hamper_items" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function load() {
    const { data } = await supabase.from("hamper_items").select("*").order("name");
    setHampers((data as HamperItem[]) ?? []);
  }

  async function addHamper() {
    if (!form.name.trim()) return;
    setError(null);
    const { error: insertErr } = await supabase.from("hamper_items").insert({
      name: form.name.trim(),
      category: form.category.trim() || null,
      price: Number(form.price) || 0,
      stock: Number(form.stock) || 0,
      is_active: true,
    });
    if (insertErr) {
      setError(insertErr.message);
      return;
    }
    setForm(emptyForm);
    setShowForm(false);
    load();
  }

  async function toggleActive(h: HamperItem) {
    await supabase.from("hamper_items").update({ is_active: !h.is_active }).eq("id", h.id);
    load();
  }

  async function removeHamper(h: HamperItem) {
    if (!confirm(`Delete "${h.name}"?`)) return;
    const { error: delErr } = await supabase.from("hamper_items").delete().eq("id", h.id);
    if (delErr) await supabase.from("hamper_items").update({ is_active: false }).eq("id", h.id);
    load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-800">Gift Hampers</h1>
        <div className="flex gap-2">
          <ExportExcelButton
            rows={hampers.map((h) => ({ Name: h.name, Category: h.category, Price: h.price, Stock: h.stock, Active: h.is_active ? "Yes" : "No" }))}
            fileName="gift-hampers"
          />
          <button className="btn-primary" onClick={() => setShowForm(true)}>
            <Plus size={14} /> Add Hamper
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {hampers.map((h) => (
          <div key={h.id} className={`card p-4 ${!h.is_active ? "opacity-50" : ""}`}>
            <div className="font-medium text-gray-800">{h.name}</div>
            <div className="mt-1 text-sm text-gray-500">{h.category ?? "-"}</div>
            <div className="mt-2 flex items-center justify-between">
              <span className="pill-info">Stock: {h.stock}</span>
              <span className="font-semibold text-brand-primary">{formatCurrency(h.price)}</span>
            </div>
            <div className="mt-2 flex justify-end gap-1">
              <button className="btn-ghost !py-0.5 text-xs" onClick={() => toggleActive(h)}>
                {h.is_active ? "Deactivate" : "Activate"}
              </button>
              <button className="btn-ghost !py-0.5 text-xs text-brand-danger" onClick={() => removeHamper(h)}>
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        ))}
        {hampers.length === 0 && <p className="text-sm text-gray-400">No gift hampers yet.</p>}
      </div>

      {showForm && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/30">
          <div className="card w-96 space-y-2.5 p-5">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-800">Add Gift Hamper</h2>
              <button onClick={() => setShowForm(false)}><X size={16} /></button>
            </div>
            {error && <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-brand-danger">{error}</div>}
            <input className="input" placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input className="input" placeholder="Category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
            <div className="grid grid-cols-2 gap-2">
              <input type="number" className="input" placeholder="Price" value={form.price || ""} onChange={(e) => setForm({ ...form, price: Number(e.target.value) })} />
              <input type="number" className="input" placeholder="Stock" value={form.stock || ""} onChange={(e) => setForm({ ...form, stock: Number(e.target.value) })} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button className="btn-ghost" onClick={() => setShowForm(false)}>Cancel</button>
              <button className="btn-primary" onClick={addHamper}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
