import { useEffect, useState } from "react";
import { Plus, X, CalendarDays } from "lucide-react";
import { useStaffAuth } from "../context/StaffAuthContext";
import { supabase } from "../lib/supabase";

interface Client {
  id: string;
  name: string;
  phone: string;
}

interface FollowUp {
  id: string;
  customer_id: string;
  follow_up_date: string;
  reason: string;
  notes: string | null;
  status: "pending" | "completed" | "rescheduled" | "cancelled";
}

const STATUS_STYLE: Record<FollowUp["status"], string> = {
  pending: "bg-amber-100 text-amber-700",
  completed: "bg-brand-success/10 text-brand-success",
  rescheduled: "bg-blue-100 text-blue-700",
  cancelled: "bg-gray-100 text-gray-500",
};

const TABS = [
  { key: "today", label: "Today's" },
  { key: "upcoming", label: "Upcoming" },
  { key: "pending", label: "Pending" },
] as const;

export function FollowUps() {
  const { token } = useStaffAuth();
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("today");
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ customer_id: "", follow_up_date: "", reason: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    if (!token) return;
    const [fRes, cRes] = await Promise.all([
      supabase.rpc("staff_get_followups", { p_token: token }),
      supabase.rpc("staff_get_clients", { p_token: token, p_search: null }),
    ]);
    setFollowUps((fRes.data as FollowUp[]) || []);
    setClients((cRes.data as Client[]) || []);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function create() {
    if (!token || !form.customer_id || !form.follow_up_date || !form.reason.trim()) {
      setError("Client, date and reason are required.");
      return;
    }
    setSaving(true);
    setError("");
    const { data, error: err } = await supabase.rpc("staff_create_followup", {
      p_token: token,
      p_customer_id: form.customer_id,
      p_follow_up_date: form.follow_up_date,
      p_reason: form.reason.trim(),
      p_notes: form.notes.trim() || null,
    });
    setSaving(false);
    if (err || !data?.success) {
      setError(err?.message || data?.error || "Failed to create follow-up.");
      return;
    }
    setForm({ customer_id: "", follow_up_date: "", reason: "", notes: "" });
    setShowAdd(false);
    load();
  }

  async function updateStatus(id: string, status: FollowUp["status"]) {
    if (!token) return;
    await supabase.rpc("staff_update_followup_status", { p_token: token, p_follow_up_id: id, p_status: status });
    load();
  }

  const today = new Date().toISOString().slice(0, 10);
  const filtered = followUps.filter((f) => {
    if (tab === "today") return f.follow_up_date === today && f.status === "pending";
    if (tab === "upcoming") return f.follow_up_date > today && f.status === "pending";
    return f.status === "pending";
  });

  function clientName(id: string) {
    return clients.find((c) => c.id === id)?.name || "Client";
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-1 rounded-lg bg-page p-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium ${tab === t.key ? "bg-card text-brand-primary shadow-sm" : "text-gray-500"}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button onClick={() => setShowAdd(true)} className="btn-primary flex items-center gap-1 px-3">
          <Plus size={16} /> New
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="card p-6 text-center text-sm text-gray-400">No follow-ups here.</div>
      ) : (
        <div className="space-y-2">
          {filtered.map((f) => (
            <div key={f.id} className="card space-y-2 p-3">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-sm font-medium text-gray-800">{clientName(f.customer_id)}</div>
                  <div className="text-xs text-gray-500">{f.reason}</div>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLE[f.status]}`}>{f.status}</span>
              </div>
              <div className="flex items-center gap-1 text-xs text-gray-400">
                <CalendarDays size={12} /> {f.follow_up_date}
              </div>
              {f.status === "pending" && (
                <div className="flex gap-2 pt-1">
                  <button onClick={() => updateStatus(f.id, "completed")} className="rounded-md bg-brand-success/10 px-2 py-1 text-xs font-medium text-brand-success">
                    Complete
                  </button>
                  <button onClick={() => updateStatus(f.id, "rescheduled")} className="rounded-md bg-blue-100 px-2 py-1 text-xs font-medium text-blue-700">
                    Reschedule
                  </button>
                  <button onClick={() => updateStatus(f.id, "cancelled")} className="rounded-md bg-gray-100 px-2 py-1 text-xs font-medium text-gray-500">
                    Cancel
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={() => setShowAdd(false)}>
          <div className="w-full rounded-t-2xl bg-card p-4" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold">New Follow-up</h3>
              <button onClick={() => setShowAdd(false)}>
                <X size={18} />
              </button>
            </div>
            {error && <div className="mb-2 text-xs text-brand-danger">{error}</div>}
            <div className="space-y-2">
              <select className="input w-full" value={form.customer_id} onChange={(e) => setForm({ ...form, customer_id: e.target.value })}>
                <option value="">Select client…</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} — {c.phone}
                  </option>
                ))}
              </select>
              <input type="date" className="input w-full" value={form.follow_up_date} onChange={(e) => setForm({ ...form, follow_up_date: e.target.value })} />
              <input className="input w-full" placeholder="Reason" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
              <textarea className="input w-full" placeholder="Notes (optional)" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              <button onClick={create} disabled={saving} className="btn-primary w-full">
                {saving ? "Saving…" : "Create Follow-up"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
