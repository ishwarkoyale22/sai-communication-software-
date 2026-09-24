import { useEffect, useState } from "react";
import { PhoneCall, ChevronDown, ChevronUp } from "lucide-react";
import { formatCurrency } from "@sai/shared";
import { useStaffAuth } from "../context/StaffAuthContext";
import { supabase } from "../lib/supabase";

interface Repair {
  id: string;
  customer_name: string;
  phone: string;
  device_brand: string;
  device_model: string;
  problem: string;
  diagnosis: string | null;
  parts_used: string | null;
  repair_cost: number | null;
  advance_paid: number | null;
  notes: string | null;
  status: string;
  contacted_at: string | null;
  received_at: string;
}

// Must match the live `repairs_status_check` constraint — see
// apps/admin/src/pages/Repairs.tsx for the empirical verification. The
// admin-side kanban and this staff view must stay in sync since both write
// the same `repairs.status` column.
const STATUS_LABEL: Record<string, string> = {
  received: "Submitted / Pending",
  in_repair: "In Process",
  waiting_parts: "Waiting Parts",
  completed: "Repaired / Completed",
  delivered: "Delivered",
  cancelled: "Cancelled",
};
const STATUS_OPTIONS = ["received", "in_repair", "waiting_parts", "completed", "delivered", "cancelled"];
const OPEN_STATUSES = ["received", "in_repair", "waiting_parts"];

export function RepairsPage() {
  const { token } = useStaffAuth();
  const [repairs, setRepairs] = useState<Repair[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [tab, setTab] = useState<"active" | "history">("active");
  const [detailDraft, setDetailDraft] = useState({ diagnosis: "", parts_used: "", repair_cost: "", notes: "" });

  useEffect(() => {
    load();
  }, [token]);

  async function load() {
    if (!token) return;
    setLoading(true);
    const { data } = await supabase.rpc("staff_get_repairs", { p_token: token });
    setRepairs((data as Repair[]) ?? []);
    setLoading(false);
  }

  async function updateStatus(repairId: string, status: string) {
    if (!token) return;
    setUpdatingId(repairId);
    const { error } = await supabase.rpc("staff_update_repair_status", {
      p_token: token,
      p_repair_id: repairId,
      p_status: status,
    });
    if (error) alert(error.message || "Failed to update repair status.");
    await load();
    setUpdatingId(null);
  }

  async function markContacted(repairId: string) {
    if (!token) return;
    setUpdatingId(repairId);
    await supabase.rpc("staff_mark_repair_contacted", { p_token: token, p_repair_id: repairId });
    await load();
    setUpdatingId(null);
  }

  function expand(r: Repair) {
    if (expandedId === r.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(r.id);
    setDetailDraft({
      diagnosis: r.diagnosis ?? "",
      parts_used: r.parts_used ?? "",
      repair_cost: r.repair_cost != null ? String(r.repair_cost) : "",
      notes: r.notes ?? "",
    });
  }

  async function saveDetails(repairId: string) {
    if (!token) return;
    setUpdatingId(repairId);
    const { error } = await supabase.rpc("staff_update_repair_details", {
      p_token: token,
      p_repair_id: repairId,
      p_diagnosis: detailDraft.diagnosis || null,
      p_parts_used: detailDraft.parts_used || null,
      p_repair_cost: detailDraft.repair_cost ? Number(detailDraft.repair_cost) : null,
      p_notes: detailDraft.notes || null,
    });
    if (error) alert(error.message || "Failed to save repair details.");
    await load();
    setUpdatingId(null);
  }

  const filtered = repairs.filter((r) => (tab === "active" ? OPEN_STATUSES.includes(r.status) : !OPEN_STATUSES.includes(r.status)));

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-gray-800">My Repairs</h1>

      <div className="flex gap-1 rounded-md bg-gray-100 p-1 w-fit">
        {(["active", "history"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded px-4 py-1.5 text-xs font-medium capitalize transition-colors ${
              tab === t ? "bg-white text-brand-primary shadow-sm" : "text-gray-500"
            }`}
          >
            {t === "active" ? "Active" : "History"}
          </button>
        ))}
      </div>

      <div className="card divide-y divide-border">
        {loading ? (
          <div className="p-6 text-center text-sm text-gray-400">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="p-6 text-center text-sm text-gray-400">
            {tab === "active" ? "No repairs assigned to you yet." : "No completed repair history yet."}
          </div>
        ) : (
          filtered.map((r) => (
            <div key={r.id} className="space-y-1.5 p-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium text-gray-800">{r.device_brand} {r.device_model}</div>
                <button
                  className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    r.contacted_at ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-500"
                  }`}
                  onClick={() => markContacted(r.id)}
                  disabled={updatingId === r.id}
                >
                  <PhoneCall size={11} />
                  {r.contacted_at ? "Called up" : "Mark called up"}
                </button>
              </div>
              <p className="text-xs text-gray-600">{r.customer_name} · {r.phone}</p>
              <p className="text-xs text-gray-600">{r.problem}</p>
              {tab === "active" && (
                <select
                  className="input mt-1 !py-1 text-xs"
                  value={r.status}
                  disabled={updatingId === r.id}
                  onChange={(e) => updateStatus(r.id, e.target.value)}
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                  ))}
                </select>
              )}
              {tab === "history" && <span className="pill-info text-[11px]">{STATUS_LABEL[r.status]}</span>}

              <button
                onClick={() => expand(r)}
                className="flex items-center gap-1 pt-1 text-[11px] font-medium text-brand-primary"
              >
                {expandedId === r.id ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                {expandedId === r.id ? "Hide details" : "Diagnosis / Parts / Cost / Notes"}
              </button>

              {expandedId === r.id && (
                <div className="space-y-1.5 rounded-md border border-border bg-page p-2.5">
                  <textarea
                    className="input w-full !py-1 text-xs"
                    placeholder="Diagnosis"
                    rows={2}
                    value={detailDraft.diagnosis}
                    onChange={(e) => setDetailDraft({ ...detailDraft, diagnosis: e.target.value })}
                  />
                  <input
                    className="input w-full !py-1 text-xs"
                    placeholder="Parts used / required"
                    value={detailDraft.parts_used}
                    onChange={(e) => setDetailDraft({ ...detailDraft, parts_used: e.target.value })}
                  />
                  <input
                    type="number"
                    className="input w-full !py-1 text-xs"
                    placeholder="Repair cost / estimate (₹)"
                    value={detailDraft.repair_cost}
                    onChange={(e) => setDetailDraft({ ...detailDraft, repair_cost: e.target.value })}
                  />
                  {r.advance_paid != null && r.advance_paid > 0 && (
                    <p className="text-[11px] text-gray-500">Advance paid: {formatCurrency(r.advance_paid)}</p>
                  )}
                  <textarea
                    className="input w-full !py-1 text-xs"
                    placeholder="Notes"
                    rows={2}
                    value={detailDraft.notes}
                    onChange={(e) => setDetailDraft({ ...detailDraft, notes: e.target.value })}
                  />
                  <button
                    className="btn-primary w-full !py-1.5 text-xs"
                    disabled={updatingId === r.id}
                    onClick={() => saveDetails(r.id)}
                  >
                    {updatingId === r.id ? "Saving…" : "Save Details"}
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
