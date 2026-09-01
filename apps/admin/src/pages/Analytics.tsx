import { useEffect, useState } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, CartesianGrid } from "recharts";
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

  return (
    <div className="space-y-5">
      <h1 className="text-lg font-semibold text-gray-800">Analytics</h1>

      <div className="grid grid-cols-2 gap-4">
        <div className="card p-4">
          <div className="mb-2 text-sm font-semibold text-gray-700">Revenue Trend</div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={byDay}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F1F3F5" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip formatter={(v) => formatCurrency(Number(v))} />
              <Line type="monotone" dataKey="revenue" stroke="#2563EB" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="card p-4">
          <div className="mb-2 text-sm font-semibold text-gray-700">Top Products by Revenue</div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={byProduct} layout="vertical">
              <XAxis type="number" tick={{ fontSize: 10 }} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={100} />
              <Tooltip formatter={(v) => formatCurrency(Number(v))} />
              <Bar dataKey="revenue" fill="#2563EB" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card p-4">
          <div className="mb-2 text-sm font-semibold text-gray-700">Revenue by Category</div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={byCategory}>
              <XAxis dataKey="category" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip formatter={(v) => formatCurrency(Number(v))} />
              <Bar dataKey="revenue" fill="#16A34A" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card p-4">
          <div className="mb-2 text-sm font-semibold text-gray-700">Staff Performance (Sales Volume)</div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={byStaff}>
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip formatter={(v) => formatCurrency(Number(v))} />
              <Bar dataKey="revenue" fill="#D97706" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
