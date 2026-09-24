import { useEffect, useState } from "react";
import { formatCurrency } from "@sai/shared";
import { ShoppingBag } from "lucide-react";
import { useStaffAuth } from "../context/StaffAuthContext";
import { supabase } from "../lib/supabase";
import { dbTime } from "../lib/time";

interface Order {
  id: string;
  order_number: string;
  customer_name: string;
  total_amount: number;
  order_status: string;
  created_at: string;
}

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-amber-50 text-amber-700",
  confirmed: "bg-blue-50 text-blue-700",
  ready: "bg-indigo-50 text-indigo-700",
  delivered: "bg-emerald-50 text-emerald-700",
  cancelled: "bg-gray-100 text-gray-500",
};

export function OrdersView() {
  const { token } = useStaffAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    supabase.rpc("staff_get_website_orders", { p_token: token }).then(({ data }) => {
      setOrders((data as Order[]) ?? []);
      setLoading(false);
    });
  }, [token]);

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-gray-800">Website Orders</h1>
      {loading ? (
        <div className="text-center text-sm text-gray-400">Loading…</div>
      ) : orders.length === 0 ? (
        <div className="card p-6 text-center text-sm text-gray-400">No orders yet.</div>
      ) : (
        <div className="space-y-2">
          {orders.map((o) => (
            <div key={o.id} className="card space-y-1 p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-sm font-medium text-gray-800">
                  <ShoppingBag size={14} className="text-brand-primary" /> {o.order_number}
                </div>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLE[o.order_status] ?? "bg-gray-100 text-gray-500"}`}>
                  {o.order_status}
                </span>
              </div>
              <div className="text-xs text-gray-600">{o.customer_name}</div>
              <div className="flex items-center justify-between text-xs text-gray-400">
                <span>{dbTime(o.created_at).toLocaleString("en-IN")}</span>
                <span className="font-semibold text-brand-primary">{formatCurrency(o.total_amount)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
