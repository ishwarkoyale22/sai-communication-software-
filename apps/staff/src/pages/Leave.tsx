import { useEffect, useState } from "react";
import { useStaffAuth } from "../context/StaffAuthContext";
import { supabase } from "../lib/supabase";
import { Plus, X } from "lucide-react";

interface LeaveRequest {
  id: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  reason: string | null;
  status: "pending" | "approved" | "rejected";
  created_at: string;
}

const LEAVE_TYPES = [
  { value: "sick", label: "Sick Leave" },
  { value: "casual", label: "Casual Leave" },
  { value: "annual", label: "Annual Leave" },
  { value: "unpaid", label: "Unpaid Leave" },
  { value: "other", label: "Other" },
];

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-amber-50 text-amber-700 border-amber-200",
  approved: "bg-emerald-50 text-emerald-700 border-emerald-200",
  rejected: "bg-red-50 text-brand-danger border-red-200",
};

export function LeavePage() {
  const { token } = useStaffAuth();
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ leave_type: "casual", start_date: "", end_date: "", reason: "" });

  useEffect(() => {
    load();
  }, [token]);

  async function load() {
    if (!token) return;
    setLoading(true);
    const { data } = await supabase.rpc("staff_get_leave_requests", { p_token: token });
    setRequests((data as LeaveRequest[]) ?? []);
    setLoading(false);
  }

  async function submit() {
    if (!token) return;
    if (!form.start_date || !form.end_date) {
      setError("Please select a start and end date.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const { data, error: rpcErr } = await supabase.rpc("staff_apply_leave", {
      p_token: token,
      p_leave_type: form.leave_type,
      p_start_date: form.start_date,
      p_end_date: form.end_date,
      p_reason: form.reason || null,
    });
    setSubmitting(false);
    if (rpcErr || !data?.success) {
      setError(rpcErr?.message || data?.error || "Failed to submit leave request.");
      return;
    }
    setForm({ leave_type: "casual", start_date: "", end_date: "", reason: "" });
    setShowForm(false);
    await load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-800">Leave</h1>
        <button className="btn-primary flex items-center gap-1.5 text-sm" onClick={() => setShowForm(true)}>
          <Plus size={15} /> Apply
        </button>
      </div>

      <div className="card divide-y divide-border">
        {loading ? (
          <div className="p-6 text-center text-sm text-gray-400">Loading…</div>
        ) : requests.length === 0 ? (
          <div className="p-6 text-center text-sm text-gray-400">No leave requests yet.</div>
        ) : (
          requests.map((r) => (
            <div key={r.id} className="p-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium capitalize text-gray-800">{r.leave_type} Leave</div>
                <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize ${STATUS_STYLE[r.status]}`}>
                  {r.status}
                </span>
              </div>
              <div className="text-xs text-gray-500">
                {new Date(r.start_date).toLocaleDateString("en-IN")} – {new Date(r.end_date).toLocaleDateString("en-IN")}
              </div>
              {r.reason && <div className="mt-1 text-xs text-gray-600">{r.reason}</div>}
            </div>
          ))
        )}
      </div>

      {showForm && (
        <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/40 sm:items-center">
          <div className="card w-full max-w-sm space-y-3 rounded-b-none p-5 sm:rounded-b-card">
            <div className="flex items-center justify-between border-b border-border pb-2">
              <h2 className="text-sm font-semibold text-gray-800">Apply for Leave</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600">
                <X size={18} />
              </button>
            </div>

            {error && <div className="rounded-md border border-red-200 bg-red-50 p-2.5 text-xs text-brand-danger">{error}</div>}

            <select className="input w-full" value={form.leave_type} onChange={(e) => setForm({ ...form, leave_type: e.target.value })}>
              {LEAVE_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">From</label>
                <input type="date" className="input w-full" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">To</label>
                <input type="date" className="input w-full" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
              </div>
            </div>
            <textarea
              className="input w-full"
              placeholder="Reason (optional)"
              rows={3}
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
            />

            <button className="btn-primary w-full py-2.5" disabled={submitting} onClick={submit}>
              {submitting ? "Submitting…" : "Submit Request"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
