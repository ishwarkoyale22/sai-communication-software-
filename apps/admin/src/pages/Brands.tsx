import { useEffect, useState } from "react";
import { type Brand } from "@sai/shared";
import { supabase } from "../lib/supabase";
import { ExportExcelButton } from "../components/ExportExcelButton";
import { StatusPill } from "../components/StatusPill";
import { Plus } from "lucide-react";

export function Brands() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [name, setName] = useState("");

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const { data } = await supabase.from("brands").select("*").order("name");
    setBrands(data ?? []);
  }

  async function addBrand() {
    if (!name.trim()) return;
    await supabase.from("brands").upsert({ name: name.trim(), is_active: true }, { onConflict: "name" });
    setName("");
    load();
  }

  async function toggleActive(b: Brand) {
    await supabase.from("brands").update({ is_active: !b.is_active }).eq("name", b.name);
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
      <p className="text-sm text-gray-500">
        Brands are also auto-added when you type a new one on the Add Product form. Deactivate one
        here to hide it from that dropdown without losing any products already tagged with it.
      </p>

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
              <tr key={b.name}>
                <td className="font-medium">{b.name}</td>
                <td>
                  <StatusPill status={b.is_active ? "active" : "neutral"} label={b.is_active ? "Active" : "Inactive"} />
                </td>
                <td>
                  <button className="btn-ghost" onClick={() => toggleActive(b)}>
                    {b.is_active ? "Deactivate" : "Activate"}
                  </button>
                </td>
              </tr>
            ))}
            {brands.length === 0 && (
              <tr>
                <td colSpan={3} className="py-8 text-center text-gray-400">
                  No brands yet — add one above, or add a product with a new brand name
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
