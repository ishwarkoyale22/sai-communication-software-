import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { ExportExcelButton } from "../components/ExportExcelButton";
import { StatusPill } from "../components/StatusPill";
import { Plus, Trash2 } from "lucide-react";

interface Brand {
  id: string;
  name: string;
  logo_url: string | null;
  is_active: boolean;
}

export function Brands() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    load();
    const channel = supabase
      .channel("brands-page")
      .on("postgres_changes", { event: "*", schema: "public", table: "brands" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function load() {
    const { data } = await supabase.from("brands").select("*").order("name");
    setBrands((data as Brand[]) ?? []);
  }

  async function addBrand() {
    if (!name.trim()) return;
    setError(null);
    const { error: insertErr } = await supabase.from("brands").insert({ name: name.trim(), is_active: true });
    if (insertErr) {
      setError(insertErr.message);
      return;
    }
    setName("");
    load();
  }

  async function toggleActive(b: Brand) {
    await supabase.from("brands").update({ is_active: !b.is_active }).eq("id", b.id);
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
          rows={brands.map((b) => ({ Brand: b.name, Status: b.is_active ? "Active" : "Inactive" }))}
          fileName="brands"
        />
      </div>

      {error && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-brand-danger">{error}</div>}

      <div className="card flex items-end gap-2 p-4">
        <input className="input flex-1" placeholder="New brand name" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn-primary" onClick={addBrand}>
          <Plus size={14} /> Add Brand
        </button>
      </div>

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>Brand</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {brands.map((b) => (
              <tr key={b.id}>
                <td className="font-medium">{b.name}</td>
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
                <td colSpan={3} className="py-8 text-center text-gray-400">
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
