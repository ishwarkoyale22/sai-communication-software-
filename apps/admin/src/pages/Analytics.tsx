import { useEffect, useState } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, CartesianGrid } from "recharts";
import { formatCurrency, type Sale, type SaleItem, type Product, type Staff } from "@sai/shared";
import { supabase } from "../lib/supabase";

export function Analytics() {
  const [sales, setSales] = useState<Sale[]>([]);
  const [items, setItems] = useState<(SaleItem & { product?: Product })[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);

  useEffect(() => {
    (async () => {
      const [{ data: s }, { data: i }, { data: st }] = await Promise.all([
        supabase.from("sales").select("*").order("created_at"),
        supabase.from("sale_items").select("*, product:products(*)"),
        supabase.from("staff").select("*"),
      ]);
      setSales(s ?? []);
      setItems((i as any) ?? []);
      setStaff(st ?? []);
    })();
  }, []);

  const byDay = Object.values(
    sales.reduce<Record<string, { date: string; revenue: number }>>((acc, s) => {
      const day = s.created_at.slice(0, 10);
      acc[day] = acc[day] ?? { date: day, revenue: 0 };
      acc[day].revenue += Number(s.total_amount);
      return acc;
    }, {})
  );

  const byProduct = Object.values(
    items.reduce<Record<string, { name: string; revenue: number; qty: number }>>((acc, i) => {
      const name = i.product?.name ?? "Unknown";
      acc[name] = acc[name] ?? { name, revenue: 0, qty: 0 };
      acc[name].revenue += i.qty * i.unit_price;
      acc[name].qty += i.qty;
      return acc;
    }, {})
  )
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 8);

  const byCategory = Object.values(
    items.reduce<Record<string, { category: string; margin: number }>>((acc, i) => {
      const cat = i.product?.category ?? "Other";
      acc[cat] = acc[cat] ?? { category: cat, margin: 0 };
      acc[cat].margin += (i.unit_price - i.purchase_price) * i.qty;
      return acc;
    }, {})
  );

  const byStaff = Object.values(
    sales.reduce<Record<string, { name: string; revenue: number }>>((acc, s) => {
      const name = staff.find((st) => st.id === s.staff_id)?.name ?? "Unassigned";
      acc[name] = acc[name] ?? { name, revenue: 0 };
      acc[name].revenue += Number(s.total_amount);
      return acc;
    }, {})
  );

  return (
    <div className="space-y-5">
      <h1 className="text-lg font-semibold text-gray-800">Analytics</h1>
      <p className="rounded-md bg-amber-50 px-3 py-1.5 text-xs text-brand-warning">
        Phase 2 preview — live data, basic charts. Deeper forecasting/segmentation ships in Phase 2.
      </p>

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
          <div className="mb-2 text-sm font-semibold text-gray-700">Profit Margin by Category</div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={byCategory}>
              <XAxis dataKey="category" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip formatter={(v) => formatCurrency(Number(v))} />
              <Bar dataKey="margin" fill="#16A34A" radius={[4, 4, 0, 0]} />
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
