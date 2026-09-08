import { useEffect, useState } from "react";
import { formatCurrency } from "@sai/shared";
import { supabase } from "../lib/supabase";
import { ExportExcelButton } from "../components/ExportExcelButton";
import { StatusPill } from "../components/StatusPill";
import { Plus, Trash2, X, Edit2 } from "lucide-react";

interface FinancePartner {
  id: string;
  name: string;
  description: string | null;
  logo_url: string | null;
  min_amount: number | null;
  max_amount: number | null;
  available_tenures: number[];
  processing_fee_pct: number;
  is_active: boolean;
}

const emptyForm = {
  name: "",
  description: "",
  logo_url: "",
  min_amount: 0,
  max_amount: 0,
  available_tenures: "3,6,9,12,18,24",
  processing_fee_pct: 0,
};

function parseTenures(input: string): number[] {
  return input
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

export function FinancePartners() {
  const [partners, setPartners] = useState<FinancePartner[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<FinancePartner | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    load();
    const channel = supabase
      .channel("finance-partners-page")
      .on("postgres_changes", { event: "*", schema: "public", table: "finance_partners" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function load() {
    const { data } = await supabase.from("finance_partners").select("*").order("name");
    setPartners((data as FinancePartner[]) ?? []);
  }

  function openAdd() {
    setEditing(null);
    setForm(emptyForm);
    setError(null);
    setShowForm(true);
  }

  function openEdit(p: FinancePartner) {
    setEditing(p);
    setForm({
      name: p.name,
      description: p.description ?? "",
      logo_url: p.logo_url ?? "",
      min_amount: p.min_amount ?? 0,
      max_amount: p.max_amount ?? 0,
      available_tenures: (p.available_tenures ?? []).join(","),
      processing_fee_pct: p.processing_fee_pct ?? 0,
    });
    setError(null);
    setShowForm(true);
  }

  async function save() {
    if (!form.name.trim()) {
      setError("Partner name is required.");
      return;
    }
    const tenures = parseTenures(form.available_tenures);
    if (tenures.length === 0) {
      setError("Enter at least one valid tenure (months), comma-separated — e.g. 3,6,12.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        logo_url: form.logo_url.trim() || null,
        min_amount: Number(form.min_amount) || null,
        max_amount: Number(form.max_amount) || null,
        available_tenures: tenures,
        processing_fee_pct: Number(form.processing_fee_pct) || 0,
      };
      if (editing) {
        const { error: updateErr } = await supabase.from("finance_partners").update(payload).eq("id", editing.id);
        if (updateErr) throw updateErr;
      } else {
        const { error: insertErr } = await supabase.from("finance_partners").insert({ ...payload, is_active: true });
        if (insertErr) throw insertErr;
      }
      setShowForm(false);
      load();
    } catch (err: any) {
      setError(err?.message || "Failed to save finance partner.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(p: FinancePartner) {
    await supabase.from("finance_partners").update({ is_active: !p.is_active }).eq("id", p.id);
    load();
  }

  async function remove(p: FinancePartner) {
    if (!confirm(`Delete "${p.name}"? This cannot be undone.`)) return;
    const { error: delErr } = await supabase.from("finance_partners").delete().eq("id", p.id);
    if (delErr) await supabase.from("finance_partners").update({ is_active: false }).eq("id", p.id);
    load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-800">Finance Partners</h1>
        <div className="flex gap-2">
          <ExportExcelButton
            rows={partners.map((p) => ({
              Name: p.name,
              Description: p.description,
              "Min Amount": p.min_amount,
              "Max Amount": p.max_amount,
              "Tenures (months)": (p.available_tenures ?? []).join(", "),
              "Processing Fee %": p.processing_fee_pct,
              Active: p.is_active ? "Yes" : "No",
            }))}
            fileName="finance-partners"
          />
          <button className="btn-primary" onClick={openAdd}>
            <Plus size={14} /> Add Partner
          </button>
        </div>
      </div>
      <p className="text-sm text-gray-500">
        Only partners marked Active show up in the EMI step of the website's checkout.
      </p>

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>Partner</th>
              <th>Amount Range</th>
              <th>Tenures</th>
              <th className="text-right">Processing Fee</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {partners.map((p) => (
              <tr key={p.id}>
                <td className="font-medium">
                  {p.name}
                  {p.description && <div className="text-xs font-normal text-gray-400">{p.description}</div>}
                </td>
                <td className="text-gray-500">
                  {p.min_amount != null || p.max_amount != null
                    ? `${formatCurrency(p.min_amount ?? 0)} – ${formatCurrency(p.max_amount ?? 0)}`
                    : "-"}
                </td>
                <td className="text-gray-500">{(p.available_tenures ?? []).join(", ")} mo</td>
                <td className="text-right">{p.processing_fee_pct}%</td>
                <td>
                  <StatusPill status={p.is_active ? "active" : "neutral"} label={p.is_active ? "Active" : "Inactive"} />
                </td>
                <td>
                  <div className="flex justify-end gap-1">
                    <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => openEdit(p)}>
                      <Edit2 size={12} />
                    </button>
                    <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => toggleActive(p)}>
                      {p.is_active ? "Deactivate" : "Activate"}
                    </button>
                    <button className="btn-ghost !px-2 !py-1 text-xs text-brand-danger" onClick={() => remove(p)}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {partners.length === 0 && (
              <tr>
                <td colSpan={6} className="py-8 text-center text-gray-400">
                  No finance partners yet — add one above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/30 p-4">
          <div className="card w-full max-w-md space-y-2.5 p-5">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-800">{editing ? "Edit Finance Partner" : "Add Finance Partner"}</h2>
              <button onClick={() => setShowForm(false)}><X size={16} /></button>
            </div>
            {error && <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-brand-danger">{error}</div>}

            <input className="input" placeholder="Partner name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <textarea className="input" placeholder="Description (shown to customers)" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            <input className="input" placeholder="Logo image URL (optional)" value={form.logo_url} onChange={(e) => setForm({ ...form, logo_url: e.target.value })} />

            <div className="grid grid-cols-2 gap-2">
              <label className="block text-xs text-gray-500">
                Min Amount (₹)
                <input type="number" className="input mt-0.5" value={form.min_amount || ""} onChange={(e) => setForm({ ...form, min_amount: Number(e.target.value) })} />
              </label>
              <label className="block text-xs text-gray-500">
                Max Amount (₹)
                <input type="number" className="input mt-0.5" value={form.max_amount || ""} onChange={(e) => setForm({ ...form, max_amount: Number(e.target.value) })} />
              </label>
            </div>

            <label className="block text-xs text-gray-500">
              Available Tenures (months, comma-separated)
              <input className="input mt-0.5" placeholder="3,6,9,12,18,24" value={form.available_tenures} onChange={(e) => setForm({ ...form, available_tenures: e.target.value })} />
            </label>

            <label className="block text-xs text-gray-500">
              Processing Fee (%)
              <input type="number" step="0.1" className="input mt-0.5" value={form.processing_fee_pct || ""} onChange={(e) => setForm({ ...form, processing_fee_pct: Number(e.target.value) })} />
            </label>

            <div className="flex justify-end gap-2 pt-2">
              <button className="btn-ghost" onClick={() => setShowForm(false)} disabled={saving}>Cancel</button>
              <button className="btn-primary" onClick={save} disabled={saving}>{saving ? "Saving..." : "Save"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
