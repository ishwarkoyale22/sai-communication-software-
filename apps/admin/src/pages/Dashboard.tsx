import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { IndianRupee, Package, Wrench, ShoppingBag } from "lucide-react";
import { formatCurrency, formatDateTime } from "@sai/shared";
import { supabase } from "../lib/supabase";
import { StatusPill } from "../components/StatusPill";

interface Metrics {
  todayRevenue: number;
  lowStockCount: number;
  pendingRepairEnquiries: number;
  pendingWebsiteOrders: number;
}

interface RecentOrder {
  id: string;
  order_number: string;
  customer_name: string;
  total_amount: number;
  order_status: string;
  created_at: string;
}

interface LowStockItem {
  id: string;
  name: string;
  stock: number;
}

export function Dashboard() {
  const [metrics, setMetrics] = useState<Metrics>({ todayRevenue: 0, lowStockCount: 0, pendingRepairEnquiries: 0, pendingWebsiteOrders: 0 });
  const [recentOrders, setRecentOrders] = useState<RecentOrder[]>([]);
  const [lowStock, setLowStock] = useState<LowStockItem[]>([]);

  useEffect(() => {
    load();
    const channel = supabase
      .channel("dashboard-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "sales" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "website_orders" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "repair_enquiries" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "inventory" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function load() {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [
      { data: todaySales },
      { data: inventory },
      { count: pendingRepairEnq },
      { count: pendingOrders },
      { data: orders },
    ] = await Promise.all([
      supabase.from("sales").select("final_amount").gte("created_at", todayStart.toISOString()),
      supabase.from("inventory").select("id, name, stock").eq("is_active", true).order("stock", { ascending: true }),
      supabase.from("repair_enquiries").select("id", { count: "exact", head: true }).eq("status", "pending"),
      supabase.from("website_orders").select("id", { count: "exact", head: true }).eq("order_status", "pending"),
      supabase.from("website_orders").select("id, order_number, customer_name, total_amount, order_status, created_at").order("created_at", { ascending: false }).limit(5),
    ]);

    const revenue = (todaySales ?? []).reduce((s, r: any) => s + Number(r.final_amount ?? 0), 0);
    const low = ((inventory as LowStockItem[]) ?? []).filter((i) => i.stock < 5);

    setMetrics({
      todayRevenue: revenue,
      lowStockCount: low.length,
      pendingRepairEnquiries: pendingRepairEnq ?? 0,
      pendingWebsiteOrders: pendingOrders ?? 0,
    });
    setLowStock(low.slice(0, 8));
    setRecentOrders((orders as RecentOrder[]) ?? []);
  }

  const cards = [
    { label: "Today's Sales", value: formatCurrency(metrics.todayRevenue), icon: IndianRupee, iconBg: "bg-emerald-50 text-emerald-600" },
    { label: "Pending Repair Enquiries", value: metrics.pendingRepairEnquiries.toString(), icon: Wrench, iconBg: "bg-amber-50 text-amber-600", to: "/repair-enquiries" },
    { label: "Pending Website Orders", value: metrics.pendingWebsiteOrders.toString(), icon: ShoppingBag, iconBg: "bg-sky-50 text-sky-600", to: "/web-orders" },
    { label: "Low Stock Products", value: metrics.lowStockCount.toString(), icon: Package, iconBg: "bg-red-50 text-red-600", to: "/inventory" },
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-4 gap-4">
        {cards.map((c) => {
          const Card = (
            <div className="card relative overflow-hidden p-4 pl-5 transition-shadow hover:shadow-cardHover">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-xs font-medium text-gray-500">{c.label}</div>
                  <div className="mt-1 text-2xl font-semibold text-gray-800">{c.value}</div>
                </div>
                <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${c.iconBg}`}>
                  <c.icon size={18} />
                </div>
              </div>
            </div>
          );
          return c.to ? <Link key={c.label} to={c.to}>{Card}</Link> : <div key={c.label}>{Card}</div>;
        })}
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="card col-span-2 p-4">
          <div className="mb-3 text-sm font-semibold text-gray-700">Recent Website Orders</div>
          <table className="table-base">
            <thead>
              <tr>
                <th>Order #</th>
                <th>Customer</th>
                <th className="text-right">Amount</th>
                <th>Status</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {recentOrders.map((o) => (
                <tr key={o.id}>
                  <td className="font-medium">{o.order_number}</td>
                  <td>{o.customer_name}</td>
                  <td className="text-right">{formatCurrency(o.total_amount)}</td>
                  <td><StatusPill status={o.order_status} label={o.order_status} /></td>
                  <td className="text-gray-500">{formatDateTime(o.created_at)}</td>
                </tr>
              ))}
              {recentOrders.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-gray-400">No orders yet</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="card p-4">
          <div className="mb-3 text-sm font-semibold text-gray-700">Low Stock Alerts (&lt; 5)</div>
          <ul className="space-y-1.5">
            {lowStock.map((p) => (
              <li key={p.id} className="flex justify-between text-sm">
                <span className="text-gray-700">{p.name}</span>
                <span className="pill-danger">{p.stock} left</span>
              </li>
            ))}
            {lowStock.length === 0 && <p className="text-sm text-gray-400">All stocked up</p>}
          </ul>
        </div>
      </div>
    </div>
  );
}
