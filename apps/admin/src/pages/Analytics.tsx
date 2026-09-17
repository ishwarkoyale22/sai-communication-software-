import { useEffect, useState } from "react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, CartesianGrid } from "recharts";
import { TrendingUp, Package, PieChart, Trophy } from "lucide-react";
import { formatCurrency } from "@sai/shared";
import { supabase } from "../lib/supabase";

interface Sale {
  id: string;
  staff_id: string | null;
  total_amount: number;
  final_amount: number;
  created_at: string;
}
interface SaleItemRow {
  sale_id: string;
  inventory_id: string | null;
  item_name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
}
interface Staff {
  id: string;
  name: string;
}
interface InventoryRow {
  id: string;
  category: string | null;
}

export function Analytics() {
  const [sales, setSales] = useState<Sale[]>([]);
  const [items, setItems] = useState<SaleItemRow[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [inventoryById, setInventoryById] = useState<Record<string, InventoryRow>>({});

  useEffect(() => {
    (async () => {
      const [{ data: s }, { data: i }, { data: st }, { data: inv }] = await Promise.all([
        supabase.from("sales").select("id, staff_id, total_amount, final_amount, created_at").order("created_at"),
        supabase.from("sales_items").select("sale_id, inventory_id, item_name, quantity, unit_price, total_price"),
        supabase.from("staff").select("id, name"),
        supabase.from("inventory").select("id, category"),
      ]);
      setSales((s as Sale[]) ?? []);
      setItems((i as SaleItemRow[]) ?? []);
      setStaff((st as Staff[]) ?? []);
      const map: Record<string, InventoryRow> = {};
      for (const row of (inv as InventoryRow[]) ?? []) map[row.id] = row;
      setInventoryById(map);
    })();
  }, []);

  const byDay = Object.values(
    sales.reduce<Record<string, { date: string; revenue: number }>>((acc, s) => {
      const day = s.created_at.slice(0, 10);
      acc[day] = acc[day] ?? { date: day, revenue: 0 };
      acc[day].revenue += Number(s.final_amount ?? s.total_amount);
      return acc;
    }, {})
  );

  const byProduct = Object.values(
    items.reduce<Record<string, { name: string; revenue: number; qty: number }>>((acc, i) => {
      const name = i.item_name;
      acc[name] = acc[name] ?? { name, revenue: 0, qty: 0 };
      acc[name].revenue += i.total_price;
      acc[name].qty += i.quantity;
      return acc;
    }, {})
  )
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 8);

  const byCategory = Object.values(
    items.reduce<Record<string, { category: string; revenue: number }>>((acc, i) => {
      const cat = (i.inventory_id ? inventoryById[i.inventory_id]?.category : null) ?? "Other";
      acc[cat] = acc[cat] ?? { category: cat, revenue: 0 };
      acc[cat].revenue += i.total_price;
      return acc;
    }, {})
  );

  const byStaff = Object.values(
    sales.reduce<Record<string, { name: string; revenue: number }>>((acc, s) => {
      const name = staff.find((st) => st.id === s.staff_id)?.name ?? "Unassigned";
      acc[name] = acc[name] ?? { name, revenue: 0 };
      acc[name].revenue += Number(s.final_amount ?? s.total_amount);
      return acc;
    }, {})
  );

  const tooltipStyle = {
    borderRadius: 10,
    border: "1px solid #EADFCB",
    boxShadow: "0 12px 24px -12px rgba(27,27,27,0.25)",
    fontSize: 12,
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-serif text-xl font-semibold text-gray-800">Analytics</h1>
        <p className="text-xs text-gray-500">A glance at revenue, top movers, and who's driving them.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card-blue p-4">
          <div className="mb-2 flex items-center gap-2 font-serif text-sm font-semibold text-gray-700">
            <TrendingUp size={15} className="text-brand-primary" />
            Revenue Trend
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={byDay}>
              <defs>
                <linearGradient id="revenueTrendFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#1F3A8A" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#1F3A8A" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#D9E2F5" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip formatter={(v) => formatCurrency(Number(v))} contentStyle={tooltipStyle} />
              <Area type="monotone" dataKey="revenue" stroke="#1F3A8A" strokeWidth={2.5} fill="url(#revenueTrendFill)" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="card-gold p-4">
          <div className="mb-2 flex items-center gap-2 font-serif text-sm font-semibold text-gray-700">
            <Package size={15} className="text-gold" />
            Top Products by Revenue
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={byProduct} layout="vertical" margin={{ left: 8 }}>
              <defs>
                <linearGradient id="topProductsFill" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#E3B876" />
                  <stop offset="100%" stopColor="#C9975A" />
                </linearGradient>
              </defs>
              <XAxis type="number" tick={{ fontSize: 10 }} />
              <YAxis
                type="category"
                dataKey="name"
                tick={{ fontSize: 10 }}
                width={110}
                tickFormatter={(v: string) => (v.length > 16 ? `${v.slice(0, 16)}…` : v)}
              />
              <Tooltip formatter={(v) => formatCurrency(Number(v))} contentStyle={tooltipStyle} />
              <Bar dataKey="revenue" fill="url(#topProductsFill)" radius={[0, 6, 6, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card-green p-4">
          <div className="mb-2 flex items-center gap-2 font-serif text-sm font-semibold text-gray-700">
            <PieChart size={15} className="text-brand-success" />
            Revenue by Category
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={byCategory}>
              <defs>
                <linearGradient id="categoryFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#34A374" />
                  <stop offset="100%" stopColor="#0F7A54" />
                </linearGradient>
              </defs>
              <XAxis dataKey="category" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip formatter={(v) => formatCurrency(Number(v))} contentStyle={tooltipStyle} />
              <Bar dataKey="revenue" fill="url(#categoryFill)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card-purple p-4">
          <div className="mb-2 flex items-center gap-2 font-serif text-sm font-semibold text-gray-700">
            <Trophy size={15} className="text-purple-600" />
            Staff Performance (Sales Volume)
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={byStaff}>
              <defs>
                <linearGradient id="staffFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#A78BD9" />
                  <stop offset="100%" stopColor="#7C5BC4" />
                </linearGradient>
              </defs>
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip formatter={(v) => formatCurrency(Number(v))} contentStyle={tooltipStyle} />
              <Bar dataKey="revenue" fill="url(#staffFill)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
