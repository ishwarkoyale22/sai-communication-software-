import { useEffect, useState } from "react";
import { softDelete } from "@sai/shared";
import { supabase } from "../lib/supabase";
import { ExportExcelButton } from "../components/ExportExcelButton";
import { StatusPill } from "../components/StatusPill";
import { Plus, Trash2, X } from "lucide-react";

interface Branch {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  is_main: boolean;
  is_active: boolean;
}

const emptyForm = { name: "", address: "", phone: "" };

export function Branches() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    load();
    const channel = supabase
      .channel("branches-page")
      .on("postgres_changes", { event: "*", schema: "public", table: "branches" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function load() {
    const { data } = await supabase.from("branches").select("*").order("is_main", { ascending: false }).order("name");
    setBranches((data as Branch[]) ?? []);
  }

  async function addBranch() {
    if (!form.name.trim()) {
      setError("Branch name is required.");
      return;
    }
    setError(null);
    const { error: insertErr } = await supabase.from("branches").insert({
      name: form.name.trim(),
      address: form.address.trim() || null,
      phone: form.phone.trim() || null,
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

  async function setMain(b: Branch) {
    // Only one branch can be "main" at a time.
    await supabase.from("branches").update({ is_main: false }).neq("id", b.id);
    await supabase.from("branches").update({ is_main: true }).eq("id", b.id);
    load();
  }

  async function toggleActive(b: Branch) {
    await supabase.from("branches").update({ is_active: !b.is_active }).eq("id", b.id);
    load();
  }

  async function removeBranch(b: Branch) {
    if (b.is_main) {
      alert("Can't delete the main branch — mark another branch as main first.");
      return;
    }
    if (!confirm(`Delete branch "${b.name}"? You can restore it from the Recycle Bin afterwards.`)) return;
    await softDelete(supabase, "branches", b.id, b.name);
    load();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold text-gray-800">Branches</h1>
        <div className="flex gap-2">
          <ExportExcelButton
            rows={branches.map((b) => ({ Name: b.name, Address: b.address, Phone: b.phone, Main: b.is_main ? "Yes" : "No", Active: b.is_active ? "Yes" : "No" }))}
            fileName="branches"
          />
          <button className="btn-primary" onClick={() => setShowForm(true)}>
            <Plus size={14} /> Add Branch
          </button>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>Name</th>
              <th>Address</th>
              <th>Phone</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {branches.map((b) => (
              <tr key={b.id}>
                <td className="font-medium">
                  {b.name}
                  {b.is_main && <span className="pill-info ml-2 text-[10px]">Main</span>}
                </td>
                <td className="max-w-xs truncate text-gray-500">{b.address ?? "-"}</td>
                <td className="text-gray-500">{b.phone ?? "-"}</td>
                <td>
                  <StatusPill status={b.is_active ? "active" : "neutral"} label={b.is_active ? "Active" : "Inactive"} />
                </td>
                <td>
                  <div className="flex justify-end gap-1">
                    {!b.is_main && (
                      <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => setMain(b)}>
                        Set as Main
                      </button>
                    )}
                    <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => toggleActive(b)}>
                      {b.is_active ? "Deactivate" : "Activate"}
                    </button>
                    <button className="btn-ghost !px-2 !py-1 text-xs text-brand-danger" onClick={() => removeBranch(b)}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {branches.length === 0 && (
              <tr>
                <td colSpan={5} className="py-8 text-center text-gray-400">No branches yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/30 p-4">
          <div className="card w-full max-w-sm space-y-2.5 p-5">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-800">Add Branch</h2>
              <button onClick={() => setShowForm(false)}><X size={16} /></button>
            </div>
            {error && <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-brand-danger">{error}</div>}
            <input className="input" placeholder="Branch name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input className="input" placeholder="Address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            <input className="input" placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            <div className="flex justify-end gap-2 pt-2">
              <button className="btn-ghost" onClick={() => setShowForm(false)}>Cancel</button>
              <button className="btn-primary" onClick={addBranch}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
