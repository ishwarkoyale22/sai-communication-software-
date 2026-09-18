import { useEffect, useState } from "react";
import { softDelete } from "@sai/shared";
import { supabase } from "../lib/supabase";
import { ExportExcelButton } from "../components/ExportExcelButton";
import { StatusPill } from "../components/StatusPill";
import { Plus, Trash2, X, Edit2 } from "lucide-react";

interface Supplier {
  id: string;
  name: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  gst_number: string | null;
  notes: string | null;
  is_active: boolean;
}

const emptyForm = { name: "", contact_person: "", phone: "", email: "", address: "", gst_number: "", notes: "" };

export function Suppliers() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    load();
    const channel = supabase
      .channel("suppliers-page")
      .on("postgres_changes", { event: "*", schema: "public", table: "suppliers" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function load() {
    const { data } = await supabase.from("suppliers").select("*").order("name");
    setSuppliers((data as Supplier[]) ?? []);
  }

  function openAdd() {
    setEditing(null);
    setForm(emptyForm);
    setError(null);
    setShowForm(true);
  }

  function openEdit(s: Supplier) {
    setEditing(s);
    setForm({
      name: s.name,
      contact_person: s.contact_person ?? "",
      phone: s.phone ?? "",
      email: s.email ?? "",
      address: s.address ?? "",
      gst_number: s.gst_number ?? "",
      notes: s.notes ?? "",
    });
    setError(null);
    setShowForm(true);
  }

  async function save() {
    if (!form.name.trim()) {
      setError("Supplier name is required.");
      return;
    }
    setError(null);
    const payload = {
      name: form.name.trim(),
      contact_person: form.contact_person.trim() || null,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      address: form.address.trim() || null,
      gst_number: form.gst_number.trim() || null,
      notes: form.notes.trim() || null,
    };
    const { error: err } = editing
      ? await supabase.from("suppliers").update(payload).eq("id", editing.id)
      : await supabase.from("suppliers").insert({ ...payload, is_active: true });
    if (err) {
      setError(err.message);
      return;
    }
    setShowForm(false);
    load();
  }

  async function toggleActive(s: Supplier) {
    await supabase.from("suppliers").update({ is_active: !s.is_active }).eq("id", s.id);
    load();
  }

  async function remove(s: Supplier) {
    if (!confirm(`Delete supplier "${s.name}"? You can restore it from the Recycle Bin afterwards.`)) return;
    const { error: delErr } = await softDelete(supabase, "suppliers", s.id, s.name);
    if (delErr) await supabase.from("suppliers").update({ is_active: false }).eq("id", s.id);
    load();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold text-gray-800">Suppliers</h1>
        <div className="flex gap-2">
          <ExportExcelButton
            rows={suppliers.map((s) => ({
              Name: s.name,
              Contact: s.contact_person,
              Phone: s.phone,
              Email: s.email,
              Address: s.address,
              GSTIN: s.gst_number,
              Active: s.is_active ? "Yes" : "No",
            }))}
            fileName="suppliers"
          />
          <button className="btn-primary" onClick={openAdd}>
            <Plus size={14} /> Add Supplier
          </button>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>Name</th>
              <th>Contact</th>
              <th>Phone / Email</th>
              <th>GSTIN</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {suppliers.map((s) => (
              <tr key={s.id}>
                <td className="font-medium">{s.name}</td>
                <td className="text-gray-500">{s.contact_person ?? "-"}</td>
                <td className="text-gray-500">
                  {s.phone ?? "-"}
                  {s.email ? ` · ${s.email}` : ""}
                </td>
                <td className="text-gray-500">{s.gst_number ?? "-"}</td>
                <td>
                  <StatusPill status={s.is_active ? "active" : "neutral"} label={s.is_active ? "Active" : "Inactive"} />
                </td>
                <td>
                  <div className="flex justify-end gap-1">
                    <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => openEdit(s)}>
                      <Edit2 size={12} />
                    </button>
                    <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => toggleActive(s)}>
                      {s.is_active ? "Deactivate" : "Activate"}
                    </button>
                    <button className="btn-ghost !px-2 !py-1 text-xs text-brand-danger" onClick={() => remove(s)}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {suppliers.length === 0 && (
              <tr>
                <td colSpan={6} className="py-8 text-center text-gray-400">No suppliers yet — add one above.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/30 p-4">
          <div className="card w-full max-w-md space-y-2.5 p-5">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-800">{editing ? "Edit Supplier" : "Add Supplier"}</h2>
              <button onClick={() => setShowForm(false)}><X size={16} /></button>
            </div>
            {error && <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-brand-danger">{error}</div>}
            <input className="input" placeholder="Supplier name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input className="input" placeholder="Contact person" value={form.contact_person} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} />
            <div className="grid grid-cols-2 gap-2">
              <input className="input" placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              <input className="input" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <input className="input" placeholder="Address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            <input className="input" placeholder="GSTIN" value={form.gst_number} onChange={(e) => setForm({ ...form, gst_number: e.target.value })} />
            <textarea className="input" placeholder="Notes" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
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
