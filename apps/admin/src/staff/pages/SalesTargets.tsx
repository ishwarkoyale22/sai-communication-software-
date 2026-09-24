import { useEffect, useState } from "react";
import { formatCurrency } from "@sai/shared";
import { Target } from "lucide-react";
import { useStaffAuth } from "../context/StaffAuthContext";
import { supabase } from "../lib/supabase";
import { dbTime } from "../lib/time";

interface SalesTarget {
  period: "daily" | "weekly" | "monthly";
  target_amount: number;
}
interface Sale {
  final_amount: number;
  created_at: string;
}

function periodStart(period: "daily" | "weekly" | "monthly"): Date {
  const d = new Date();
  if (period === "daily") d.setHours(0, 0, 0, 0);
  else if (period === "weekly") {
    d.setDate(d.getDate() - d.getDay());
    d.setHours(0, 0, 0, 0);
  } else {
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
  }
  return d;
}

export function SalesTargets() {
  const { token } = useStaffAuth();
  const [targets, setTargets] = useState<SalesTarget[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    Promise.all([
      supabase.rpc("staff_get_sales_targets", { p_token: token }),
      supabase.rpc("staff_get_my_sales", { p_token: token }),
    ]).then(([t, s]) => {
      setTargets((t.data as SalesTarget[]) ?? []);
      setSales((s.data as Sale[]) ?? []);
      setLoading(false);
    });
  }, [token]);

  const rows = (["daily", "weekly", "monthly"] as const).map((period) => {
    const target = targets.find((t) => t.period === period)?.target_amount ?? 0;
    const since = periodStart(period).getTime();
    const achieved = sales.filter((s) => dbTime(s.created_at).getTime() >= since).reduce((sum, s) => sum + s.final_amount, 0);
    return { period, target, achieved, pct: target > 0 ? Math.min(100, Math.round((achieved / target) * 100)) : 0 };
  });

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-gray-800">My Sales Performance</h1>
      {loading ? (
        <div className="text-center text-sm text-gray-400">Loading…</div>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <div key={r.period} className="card p-4">
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-sm font-medium capitalize text-gray-700">
                  <Target size={14} className="text-brand-primary" /> {r.period}
                </div>
                <span className="text-xs text-gray-500">{formatCurrency(r.achieved)} / {formatCurrency(r.target)}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-accent">
                <div className="h-full rounded-full bg-brand-primary transition-all" style={{ width: `${r.pct}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
