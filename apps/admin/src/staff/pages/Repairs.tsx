import { useEffect, useState } from "react";
import { PhoneCall } from "lucide-react";
import { useStaffAuth } from "../context/StaffAuthContext";
import { supabase } from "../lib/supabase";

interface Repair {
  id: string;
  customer_name: string;
  phone: string;
  device_brand: string;
  device_model: string;
  problem: string;
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

export function RepairsPage() {
  const { token } = useStaffAuth();
  const [repairs, setRepairs] = useState<Repair[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

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

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-gray-800">My Repairs</h1>

      <div className="card divide-y divide-border">
        {loading ? (
          <div className="p-6 text-center text-sm text-gray-400">Loading…</div>
        ) : repairs.length === 0 ? (
          <div className="p-6 text-center text-sm text-gray-400">No repairs assigned to you yet.</div>
        ) : (
          repairs.map((r) => (
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
            </div>
          ))
        )}
      </div>
    </div>
  );
}
