import { useEffect, useState } from "react";
import { formatCurrency } from "@sai/shared";
import { Receipt } from "lucide-react";
import { useStaffAuth } from "../context/StaffAuthContext";
import { supabase } from "../lib/supabase";

interface Sale {
  id: string;
  invoice_number: string;
  customer_name: string;
  final_amount: number;
  payment_method: string;
  created_at: string;
}

export function SalesHistory() {
  const { token } = useStaffAuth();
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    supabase.rpc("staff_get_my_sales", { p_token: token }).then(({ data }) => {
      setSales((data as Sale[]) ?? []);
      setLoading(false);
    });
  }, [token]);

  const total = sales.reduce((s, r) => s + r.final_amount, 0);

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-gray-800">My Sales History</h1>
      <div className="card p-4">
        <div className="text-xs text-gray-500">Total sales recorded by you</div>
        <div className="mt-1 font-serif text-xl font-semibold text-brand-primary">{formatCurrency(total)}</div>
      </div>
      {loading ? (
        <div className="text-center text-sm text-gray-400">Loading…</div>
      ) : sales.length === 0 ? (
        <div className="card p-6 text-center text-sm text-gray-400">No sales recorded yet.</div>
      ) : (
        <div className="space-y-2">
          {sales.map((s) => (
            <div key={s.id} className="card flex items-center justify-between p-3">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 truncate text-sm font-medium text-gray-800">
                  <Receipt size={13} className="shrink-0 text-brand-primary" /> {s.invoice_number}
                </div>
                <div className="truncate text-xs text-gray-500">{s.customer_name}</div>
                <div className="text-[11px] text-gray-400">{new Date(s.created_at).toLocaleString("en-IN")}</div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-sm font-semibold text-gray-800">{formatCurrency(s.final_amount)}</div>
                <div className="text-xs capitalize text-gray-400">{s.payment_method}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
