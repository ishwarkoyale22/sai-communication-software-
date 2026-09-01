import { useEffect, useState } from "react";
import { useStaffAuth } from "../context/StaffAuthContext";
import { supabase } from "../lib/supabase";

interface ActivityRow {
  id: string;
  action: string;
  details: Record<string, unknown>;
  created_at: string;
}

const ACTION_LABEL: Record<string, string> = {
  login: "Logged in",
  clock_in: "Clocked in",
  clock_out: "Clocked out",
  leave_applied: "Applied for leave",
  review_submitted: "Submitted a customer review",
  client_report_submitted: "Submitted a client report",
};

export function ActivityPage() {
  const { token } = useStaffAuth();
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      if (!token) return;
      const { data } = await supabase.rpc("staff_get_activity", { p_token: token });
      setRows((data as ActivityRow[]) ?? []);
      setLoading(false);
    })();
  }, [token]);

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-gray-800">My Activity</h1>

      <div className="card divide-y divide-border">
        {loading ? (
          <div className="p-6 text-center text-sm text-gray-400">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="p-6 text-center text-sm text-gray-400">No activity recorded yet.</div>
        ) : (
          rows.map((r) => (
            <div key={r.id} className="flex items-center justify-between p-3 text-sm">
              <span className="text-gray-700">{ACTION_LABEL[r.action] ?? r.action}</span>
              <span className="text-xs text-gray-400">{new Date(r.created_at).toLocaleString("en-IN")}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
