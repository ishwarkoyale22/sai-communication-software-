import { useEffect, useState } from "react";
import { Plus, X, Wrench } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useStaffAuth } from "../context/StaffAuthContext";
import { dbTime } from "../lib/time";

interface RepairEnquiry {
  id: string;
  customer_name: string;
  phone: string;
  phone_brand: string | null;
  phone_model: string | null;
  problem_type: string | null;
  description: string | null;
  status: string;
  created_at: string;
}

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-amber-50 text-amber-700",
  contacted: "bg-blue-50 text-blue-700",
  converted: "bg-emerald-50 text-emerald-700",
  closed: "bg-gray-100 text-gray-500",
};

const emptyForm = { customer_name: "", phone: "", phone_brand: "", phone_model: "", problem_type: "", description: "" };

export function RepairIntake() {
  const { token } = useStaffAuth();
  const [items, setItems] = useState<RepairEnquiry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // repair_enquiries is no longer readable by the anonymous role, so there is no
    // realtime feed here — the list is loaded through a session-token function
    // and refreshed after every intake and every 30 seconds.
    load();
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function load() {
    if (!token) return;
    const { data } = await supabase.rpc("staff_get_repair_enquiries", { p_token: token });
    setItems((data as RepairEnquiry[]) ?? []);
    setLoading(false);
  }

  async function submit() {
    if (!form.customer_name.trim() || !form.phone.trim()) {
      setError("Customer name and phone are required.");
      return;
    }
    if (!/^[6-9]\d{9}$/.test(form.phone.trim())) {
      setError("Enter a valid 10-digit mobile number.");
      return;
    }
    setSaving(true);
    setError(null);
    if (!token) {
      setSaving(false);
      return;
    }
    const { data, error: rpcErr } = await supabase.rpc("staff_create_repair_enquiry", {
      p_token: token,
      p_customer_name: form.customer_name.trim(),
      p_phone: form.phone.trim(),
      p_phone_brand: form.phone_brand.trim() || null,
      p_phone_model: form.phone_model.trim() || null,
      p_problem_type: form.problem_type.trim() || null,
      p_description: form.description.trim() || null,
    });
    setSaving(false);
    if (rpcErr || !data?.success) {
      setError(rpcErr?.message || data?.error || "Failed to save intake.");
      return;
    }
    setForm(emptyForm);
    setShowForm(false);
    load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-800">Repair Intake</h1>
        <button className="btn-primary flex items-center gap-1.5 text-sm" onClick={() => setShowForm(true)}>
          <Plus size={15} /> New Intake
        </button>
      </div>

      {loading ? (
        <div className="text-center text-sm text-gray-400">Loading…</div>
      ) : items.length === 0 ? (
        <div className="card p-6 text-center text-sm text-gray-400">No repair requests yet.</div>
      ) : (
        <div className="space-y-2">
          {items.map((r) => (
            <div key={r.id} className="card space-y-1.5 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-1.5 text-sm font-medium text-gray-800">
                  <Wrench size={14} className="shrink-0 text-brand-primary" />
                  {r.customer_name}
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLE[r.status] ?? "bg-gray-100 text-gray-500"}`}>
                  {r.status}
                </span>
              </div>
              <div className="text-xs text-gray-600">{r.phone_brand} {r.phone_model} — {r.problem_type}</div>
              {r.description && <div className="text-xs text-gray-500">{r.description}</div>}
              <div className="text-xs text-gray-400">{r.phone}</div>
              <div className="text-[11px] text-gray-400">{dbTime(r.created_at).toLocaleString("en-IN")}</div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={() => setShowForm(false)}>
          <div className="max-h-[90vh] w-full space-y-2 overflow-y-auto rounded-t-2xl bg-card p-4" onClick={(e) => e.stopPropagation()}>
            <div className="mb-1 flex items-center justify-between">
              <h3 className="text-sm font-semibold">New Repair Intake</h3>
              <button onClick={() => setShowForm(false)}><X size={18} /></button>
            </div>
            {error && <div className="text-xs text-brand-danger">{error}</div>}
            <input className="input w-full" placeholder="Customer name *" value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} />
            <input className="input w-full" placeholder="Phone *" inputMode="numeric" maxLength={10} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            <div className="grid grid-cols-2 gap-2">
              <input className="input" placeholder="Brand" value={form.phone_brand} onChange={(e) => setForm({ ...form, phone_brand: e.target.value })} />
              <input className="input" placeholder="Model" value={form.phone_model} onChange={(e) => setForm({ ...form, phone_model: e.target.value })} />
            </div>
            <input className="input w-full" placeholder="Problem type (e.g. Screen)" value={form.problem_type} onChange={(e) => setForm({ ...form, problem_type: e.target.value })} />
            <textarea className="input w-full" placeholder="Description" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            <button className="btn-primary w-full" disabled={saving} onClick={submit}>
              {saving ? "Saving…" : "Submit Intake"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
