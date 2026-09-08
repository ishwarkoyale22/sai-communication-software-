import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { ExportExcelButton } from "../components/ExportExcelButton";
import { StatusPill } from "../components/StatusPill";
import { Plus, Trash2 } from "lucide-react";

interface Brand {
  id: string;
  name: string;
  logo_url: string | null;
  is_active: boolean;
  mobile_type: string | null;
}

interface InventoryRow {
  brand_id: string | null;
  stock: number;
}

export function Brands() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [inventory, setInventory] = useState<InventoryRow[]>([]);
  const [name, setName] = useState("");
  const [mobileType, setMobileType] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editMobileType, setEditMobileType] = useState("");

  useEffect(() => {
    load();
    const channel = supabase
      .channel("brands-page")
      .on("postgres_changes", { event: "*", schema: "public", table: "brands" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "inventory" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function load() {
    const [{ data: b }, { data: inv }] = await Promise.all([
      supabase.from("brands").select("*").order("name"),
      supabase.from("inventory").select("brand_id, stock").eq("is_active", true),
    ]);
    setBrands((b as Brand[]) ?? []);
    setInventory((inv as InventoryRow[]) ?? []);
  }

  const stockByBrand = useMemo(() => {
    const map: Record<string, number> = {};
    for (const i of inventory) {
      if (!i.brand_id) continue;
      map[i.brand_id] = (map[i.brand_id] ?? 0) + (i.stock ?? 0);
    }
    return map;
  }, [inventory]);

  async function addBrand() {
    if (!name.trim()) return;
    setError(null);
    const { error: insertErr } = await supabase
      .from("brands")
      .insert({ name: name.trim(), is_active: true, mobile_type: mobileType.trim() || null });
    if (insertErr) {
      setError(insertErr.message);
      return;
    }
    setName("");
    setMobileType("");
    load();
  }

  async function toggleActive(b: Brand) {
    await supabase.from("brands").update({ is_active: !b.is_active }).eq("id", b.id);
    load();
  }

  async function saveMobileType(b: Brand) {
    await supabase.from("brands").update({ mobile_type: editMobileType.trim() || null }).eq("id", b.id);
    setEditingId(null);
    load();
  }

  async function removeBrand(b: Brand) {
    if (!confirm(`Delete brand "${b.name}"?`)) return;
    const { error: delErr } = await supabase.from("brands").delete().eq("id", b.id);
    if (delErr) {
      // Likely referenced by inventory items — deactivate instead.
      await supabase.from("brands").update({ is_active: false }).eq("id", b.id);
    }
    load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-800">Brands</h1>
        <ExportExcelButton
          rows={brands.map((b) => ({
            Brand: b.name,
            "Mobile Type": b.mobile_type,
            Status: b.is_active ? "Active" : "Inactive",
            "Stock in hand": stockByBrand[b.id] ?? 0,
          }))}
          fileName="brands"
        />
      </div>

      {error && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-brand-danger">{error}</div>}

      <div className="card flex items-end gap-2 p-4">
        <input className="input flex-1" placeholder="New brand name" value={name} onChange={(e) => setName(e.target.value)} />
        <input
          className="input flex-1"
          placeholder="Mobile type / category (e.g. Flagship, Budget)"
          value={mobileType}
          onChange={(e) => setMobileType(e.target.value)}
        />
        <button className="btn-primary" onClick={addBrand}>
          <Plus size={14} /> Add Brand
        </button>
      </div>

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>Brand</th>
              <th>Mobile Type</th>
              <th className="text-right">Stock in hand</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {brands.map((b) => (
              <tr key={b.id}>
                <td className="font-medium">{b.name}</td>
                <td>
                  {editingId === b.id ? (
                    <input
                      autoFocus
                      className="input !w-40 !py-1"
                      value={editMobileType}
                      onChange={(e) => setEditMobileType(e.target.value)}
                      onBlur={() => saveMobileType(b)}
                      onKeyDown={(e) => e.key === "Enter" && saveMobileType(b)}
                    />
                  ) : (
                    <span
                      className="cursor-pointer text-gray-600 underline decoration-dotted decoration-gray-300"
                      onClick={() => {
                        setEditingId(b.id);
                        setEditMobileType(b.mobile_type ?? "");
                      }}
                      title="Click to edit"
                    >
                      {b.mobile_type || "— set type —"}
                    </span>
                  )}
                </td>
                <td className="text-right font-medium">{stockByBrand[b.id] ?? 0}</td>
                <td>
                  <StatusPill status={b.is_active ? "active" : "neutral"} label={b.is_active ? "Active" : "Inactive"} />
                </td>
                <td className="flex justify-end gap-1">
                  <button className="btn-ghost" onClick={() => toggleActive(b)}>
                    {b.is_active ? "Deactivate" : "Activate"}
                  </button>
                  <button className="btn-ghost text-brand-danger" onClick={() => removeBrand(b)}>
                    <Trash2 size={13} />
                  </button>
                </td>
              </tr>
            ))}
            {brands.length === 0 && (
              <tr>
                <td colSpan={5} className="py-8 text-center text-gray-400">
                  No brands yet — add one above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
