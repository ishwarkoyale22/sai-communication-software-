import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { IndianRupee, Package, Wrench, ShoppingBag, Receipt, TrendingUp, Boxes, AlertTriangle, Trophy, Target, Save } from "lucide-react";
import { formatCurrency, formatDateTime, computePaymentSplit } from "@sai/shared";
import { supabase } from "../lib/supabase";
import { StatusPill } from "../components/StatusPill";

type Period = "day" | "week" | "month" | "year";

interface SaleRow {
  id: string;
  final_amount: number;
  payment_method: string | null;
  staff_id: string | null;
  created_at: string;
}
interface SaleItemRow {
  sale_id: string;
  inventory_id: string | null;
  item_name: string;
  quantity: number;
  total_price: number;
}
interface BundleLine {
  sale_id: string;
  quantity: number;
  unit_price: number | null;
  unit_cost: number | null;
}
interface InventoryRow {
  id: string;
  name: string;
  category: string | null;
  price: number;
  cost_price: number | null;
  stock: number;
  created_at: string;
}
interface FinanceRow {
  id: string;
  finance_amount: number;
  finance_date: string;
}
interface RepairRow {
  id: string;
  status: string;
  technician_id: string | null;
  received_at: string;
  completed_at: string | null;
}
interface StaffLite {
  id: string;
  name: string;
}
interface SalesTarget {
  period: "daily" | "weekly" | "monthly";
  target_amount: number;
}

interface RecentOrder {
  id: string;
  order_number: string;
  customer_name: string;
  total_amount: number;
  order_status: string;
  created_at: string;
}

// Must match the live `repairs_status_check` constraint (see Repairs.tsx —
// verified directly against the database, not guessed): received/in_repair/
// waiting_parts/completed/delivered/cancelled. "Open" excludes the three
// closed-out states (completed, delivered, cancelled).
const REPAIR_STATUS_LABEL: Record<string, string> = {
  received: "Received",
  in_repair: "In Progress",
  waiting_parts: "Waiting for Parts",
  completed: "Completed",
  delivered: "Delivered",
  cancelled: "Cancelled",
};
const OPEN_REPAIR_STATUSES = ["received", "in_repair", "waiting_parts"];
const REPAIR_STATUS_TILE: Record<string, string> = {
  received: "card-blue",
  in_repair: "card-amber",
  waiting_parts: "card-red",
};

function periodStart(period: "day" | "week" | "month" | "year"): Date {
  const d = new Date();
  if (period === "day") {
    d.setHours(0, 0, 0, 0);
  } else if (period === "week") {
    const day = d.getDay(); // 0 = Sunday
    d.setDate(d.getDate() - day);
    d.setHours(0, 0, 0, 0);
  } else if (period === "month") {
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
  } else {
    d.setMonth(0, 1);
    d.setHours(0, 0, 0, 0);
  }
  return d;
}

export function Dashboard() {
  const [period, setPeriod] = useState<Period>("day");
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [saleItems, setSaleItems] = useState<SaleItemRow[]>([]);
  const [inventory, setInventory] = useState<InventoryRow[]>([]);
  const [bundleLines, setBundleLines] = useState<BundleLine[]>([]);
  const [financeTransactions, setFinanceTransactions] = useState<FinanceRow[]>([]);
  const [pendingRepairEnquiries, setPendingRepairEnquiries] = useState(0);
  const [pendingWebsiteOrders, setPendingWebsiteOrders] = useState(0);
  const [recentOrders, setRecentOrders] = useState<RecentOrder[]>([]);
  const [repairs, setRepairs] = useState<RepairRow[]>([]);
  const [staff, setStaff] = useState<StaffLite[]>([]);
  const [targets, setTargets] = useState<Record<string, number>>({ daily: 0, weekly: 0, monthly: 0 });
  const [targetDrafts, setTargetDrafts] = useState<Record<string, string>>({});
  const [savingTarget, setSavingTarget] = useState<string | null>(null);
  const [deadStockDays, setDeadStockDays] = useState(60);
  // Only the very first load shows a skeleton — realtime-triggered reloads
  // after that happen quietly so the page doesn't re-flash every time any
  // shopper anywhere places an order.
  const [initialLoading, setInitialLoading] = useState(true);

  useEffect(() => {
    load();
    const channel = supabase
      .channel("dashboard-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "sales" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "sales_items" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "website_orders" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "repair_enquiries" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "repairs" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "inventory" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "finance_transactions" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "sales_targets" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function load() {
    // Pull a superset (last 366 days) once and slice client-side per period,
    // rather than re-querying on every toggle — the row count for a single
    // shop's sales history is small enough that this stays fast.
    const yearAgo = new Date();
    yearAgo.setFullYear(yearAgo.getFullYear() - 1);

    const [
      { data: allSales },
      { data: items },
      { data: inv },
      { data: financeRows },
      { count: pendingRepairEnq },
      { count: pendingOrders },
      { data: orders },
      { data: repairRows },
      { data: staffRows },
      { data: targetRows },
      { data: hamperRows },
      { data: giftRows },
    ] = await Promise.all([
      supabase.from("sales").select("id, final_amount, payment_method, staff_id, created_at").gte("created_at", yearAgo.toISOString()),
      supabase.from("sales_items").select("sale_id, inventory_id, item_name, quantity, total_price"),
      supabase.from("inventory").select("id, name, category, price, cost_price, stock, created_at").eq("is_active", true),
      supabase.from("finance_transactions").select("id, finance_amount, finance_date").gte("finance_date", yearAgo.toISOString().slice(0, 10)),
      supabase.from("repair_enquiries").select("id", { count: "exact", head: true }).eq("status", "pending"),
      supabase.from("website_orders").select("id", { count: "exact", head: true }).eq("order_status", "pending"),
      supabase.from("website_orders").select("id, order_number, customer_name, total_amount, order_status, created_at").order("created_at", { ascending: false }).limit(5),
      supabase.from("repairs").select("id, status, technician_id, received_at, completed_at"),
      supabase.from("staff").select("id, name").eq("is_active", true),
      supabase.from("sales_targets").select("period, target_amount"),
      supabase.from("hamper_sales").select("sale_id, quantity, unit_price, unit_cost"),
      supabase.from("gift_sales").select("sale_id, quantity, unit_price, unit_cost"),
    ]);
    setBundleLines([...((hamperRows as BundleLine[]) ?? []), ...((giftRows as BundleLine[]) ?? [])]);

    setSales((allSales as SaleRow[]) ?? []);
    setSaleItems((items as SaleItemRow[]) ?? []);
    setInventory((inv as InventoryRow[]) ?? []);
    setFinanceTransactions((financeRows as FinanceRow[]) ?? []);
    setPendingRepairEnquiries(pendingRepairEnq ?? 0);
    setPendingWebsiteOrders(pendingOrders ?? 0);
    setRecentOrders((orders as RecentOrder[]) ?? []);
    setRepairs((repairRows as RepairRow[]) ?? []);
    setStaff((staffRows as StaffLite[]) ?? []);
    const targetMap: Record<string, number> = { daily: 0, weekly: 0, monthly: 0 };
    for (const t of (targetRows as SalesTarget[]) ?? []) targetMap[t.period] = Number(t.target_amount) || 0;
    setTargets(targetMap);
    setInitialLoading(false);
  }

  const staffById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const s of staff) map[s.id] = s.name;
    return map;
  }, [staff]);

  const inventoryById = useMemo(() => {
    const map: Record<string, InventoryRow> = {};
    for (const i of inventory) map[i.id] = i;
    return map;
  }, [inventory]);

  const periodSales = useMemo(() => {
    const start = periodStart(period).toISOString();
    return sales.filter((s) => s.created_at >= start);
  }, [sales, period]);

  const periodSaleIds = useMemo(() => new Set(periodSales.map((s) => s.id)), [periodSales]);
  const periodItems = useMemo(() => saleItems.filter((i) => periodSaleIds.has(i.sale_id)), [saleItems, periodSaleIds]);

  const totalRevenue = useMemo(() => periodSales.reduce((s, r) => s + Number(r.final_amount ?? 0), 0), [periodSales]);
  const invoiceCount = periodSales.length;

  const grossProfit = useMemo(() => {
    let profit = 0;
    for (const item of periodItems) {
      const inv = item.inventory_id ? inventoryById[item.inventory_id] : null;
      if (!inv || inv.cost_price == null) continue; // no cost recorded — excluded, not assumed zero
      profit += item.total_price - inv.cost_price * item.quantity;
    }
    // Gift hampers and gifts aren't inventory lines — their profit is price minus the cost recorded at sale time.
    for (const b of bundleLines) {
      if (!periodSaleIds.has(b.sale_id)) continue;
      profit += (Number(b.unit_price ?? 0) - Number(b.unit_cost ?? 0)) * b.quantity;
    }
    return profit;
  }, [periodItems, inventoryById, bundleLines, periodSaleIds]);

  // finance_date is a plain `date` column (no time component) — compare as
  // a date-only string against the period boundary rather than mixing it
  // with periodStart's full ISO timestamp, which would wrongly exclude a
  // finance sale dated exactly on the boundary day (a bare "2026-09-17"
  // sorts before "2026-09-17T00:00:00.000Z" lexicographically).
  const periodFinanceTotal = useMemo(() => {
    const start = periodStart(period).toISOString().slice(0, 10);
    return financeTransactions
      .filter((f) => f.finance_date >= start)
      .reduce((sum, f) => sum + Number(f.finance_amount ?? 0), 0);
  }, [financeTransactions, period]);

  const paymentSplit = useMemo(
    () => computePaymentSplit(periodSales.map((s) => ({ amount: s.final_amount, paymentMethod: s.payment_method })), periodFinanceTotal),
    [periodSales, periodFinanceTotal]
  );

  const topProducts = useMemo(() => {
    const byName: Record<string, { name: string; qty: number; revenue: number }> = {};
    for (const i of periodItems) {
      byName[i.item_name] = byName[i.item_name] ?? { name: i.item_name, qty: 0, revenue: 0 };
      byName[i.item_name].qty += i.quantity;
      byName[i.item_name].revenue += i.total_price;
    }
    return Object.values(byName).sort((a, b) => b.revenue - a.revenue).slice(0, 5);
  }, [periodItems]);

  const liveStockValue = useMemo(() => inventory.reduce((s, i) => s + i.price * i.stock, 0), [inventory]);
  const lowStock = useMemo(() => inventory.filter((i) => i.stock < 5).sort((a, b) => a.stock - b.stock), [inventory]);

  // "High-demand" = a low-stock item that has actually sold in the current
  // period — distinguishes a popular model running out from a slow mover
  // that just happens to be low.
  const soldQtyByInventoryId = useMemo(() => {
    const map: Record<string, number> = {};
    for (const i of periodItems) {
      if (!i.inventory_id) continue;
      map[i.inventory_id] = (map[i.inventory_id] ?? 0) + i.quantity;
    }
    return map;
  }, [periodItems]);
  const highDemandLowStock = useMemo(
    () => lowStock.filter((i) => (soldQtyByInventoryId[i.id] ?? 0) > 0),
    [lowStock, soldQtyByInventoryId]
  );

  // Dead Stock Monitoring — items with no sale within the last N days.
  // "Last sold" is derived from sales_items joined to sales.created_at
  // (both already loaded, last 366 days) rather than a stored column, since
  // no such column exists on inventory. An item that has never sold at all
  // only counts as dead stock once it's also been in the catalog longer
  // than the threshold — a brand-new listing isn't "dead" on day one.
  const lastSoldAtByInventoryId = useMemo(() => {
    const salesById: Record<string, string> = {};
    for (const s of sales) salesById[s.id] = s.created_at;
    const map: Record<string, string> = {};
    for (const item of saleItems) {
      if (!item.inventory_id) continue;
      const soldAt = salesById[item.sale_id];
      if (!soldAt) continue;
      if (!map[item.inventory_id] || soldAt > map[item.inventory_id]) map[item.inventory_id] = soldAt;
    }
    return map;
  }, [sales, saleItems]);

  const deadStock = useMemo(() => {
    const cutoff = Date.now() - deadStockDays * 86400000;
    return inventory
      .filter((i) => i.stock > 0)
      .map((i) => {
        const lastSoldAt = lastSoldAtByInventoryId[i.id];
        const referenceDate = lastSoldAt ?? i.created_at;
        return { ...i, lastSoldAt: lastSoldAt ?? null, daysSince: Math.floor((Date.now() - new Date(referenceDate).getTime()) / 86400000) };
      })
      .filter((i) => new Date(i.lastSoldAt ?? i.created_at).getTime() < cutoff)
      .sort((a, b) => b.daysSince - a.daysSince);
  }, [inventory, lastSoldAtByInventoryId, deadStockDays]);

  // Service & Repair Metrics
  const repairFunnel = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of OPEN_REPAIR_STATUSES) counts[s] = 0;
    for (const r of repairs) {
      if (OPEN_REPAIR_STATUSES.includes(r.status)) counts[r.status] = (counts[r.status] ?? 0) + 1;
    }
    return counts;
  }, [repairs]);

  const technicianEfficiency = useMemo(() => {
    const map: Record<string, { name: string; completed: number; pending: number }> = {};
    for (const r of repairs) {
      if (!r.technician_id) continue;
      const name = staffById[r.technician_id] ?? "Unknown";
      map[r.technician_id] = map[r.technician_id] ?? { name, completed: 0, pending: 0 };
      if (r.status === "completed") map[r.technician_id].completed += 1;
      else map[r.technician_id].pending += 1;
    }
    return Object.values(map).sort((a, b) => b.completed - a.completed);
  }, [repairs, staffById]);

  // Staff Accountability — today's sales only, regardless of the period
  // toggle above (a "today leaderboard" stays meaningful even while
  // viewing Month/Year revenue elsewhere on the page).
  const todaySales = useMemo(() => {
    const start = periodStart("day").toISOString();
    return sales.filter((s) => s.created_at >= start);
  }, [sales]);

  const salesLeaderboard = useMemo(() => {
    const map: Record<string, { name: string; revenue: number; count: number }> = {};
    for (const s of todaySales) {
      const key = s.staff_id ?? "unassigned";
      const name = s.staff_id ? staffById[s.staff_id] ?? "Unknown" : "Unassigned";
      map[key] = map[key] ?? { name, revenue: 0, count: 0 };
      map[key].revenue += Number(s.final_amount ?? 0);
      map[key].count += 1;
    }
    return Object.values(map).sort((a, b) => b.revenue - a.revenue);
  }, [todaySales, staffById]);

  // Target Progress — independent of the period toggle: always compares
  // today/this-week/this-month revenue against their own saved target.
  const dayRevenue = useMemo(() => sales.filter((s) => s.created_at >= periodStart("day").toISOString()).reduce((s, r) => s + Number(r.final_amount ?? 0), 0), [sales]);
  const weekRevenue = useMemo(() => sales.filter((s) => s.created_at >= periodStart("week").toISOString()).reduce((s, r) => s + Number(r.final_amount ?? 0), 0), [sales]);
  const monthRevenue = useMemo(() => sales.filter((s) => s.created_at >= periodStart("month").toISOString()).reduce((s, r) => s + Number(r.final_amount ?? 0), 0), [sales]);

  const targetRows: { key: "daily" | "weekly" | "monthly"; label: string; revenue: number }[] = [
    { key: "daily", label: "Daily", revenue: dayRevenue },
    { key: "weekly", label: "Weekly", revenue: weekRevenue },
    { key: "monthly", label: "Monthly", revenue: monthRevenue },
  ];

  async function saveTarget(periodKey: "daily" | "weekly" | "monthly") {
    const raw = targetDrafts[periodKey];
    const amount = Number(raw);
    if (!Number.isFinite(amount) || amount < 0) return;
    setSavingTarget(periodKey);
    await supabase.from("sales_targets").upsert({ period: periodKey, target_amount: amount }, { onConflict: "period" });
    setTargets((prev) => ({ ...prev, [periodKey]: amount }));
    setTargetDrafts((prev) => ({ ...prev, [periodKey]: "" }));
    setSavingTarget(null);
  }

  // Per-stat accent — each KPI gets its own hue (the theme already defines
  // these as brand.revenue/profit/stock/repair; they just weren't wired up
  // to anything yet) instead of every card reading as the same flat white
  // tile with a gray-on-gray icon.
  const cards = [
    { label: "Total Revenue", value: formatCurrency(totalRevenue), icon: IndianRupee, accent: "revenue" as const, bar: "from-[#C9975A] to-[#E3B87D]" },
    { label: "Gross Profit", value: formatCurrency(grossProfit), icon: TrendingUp, accent: "success" as const, bar: "from-brand-success to-emerald-400" },
    { label: "Invoice Count", value: invoiceCount.toString(), icon: Receipt, accent: "primary" as const, to: "/sales", bar: "from-brand-primary to-blue-400" },
    { label: "Live Stock Value", value: formatCurrency(liveStockValue), icon: Boxes, accent: "stock" as const, to: "/inventory", bar: "from-[#1F3A8A] to-[#4F6BC7]" },
  ];

  const secondaryCards = [
    { label: "Pending Repair Enquiries", value: pendingRepairEnquiries.toString(), icon: Wrench, accent: "repair" as const, to: "/repair-enquiries" },
    { label: "Pending Website Orders", value: pendingWebsiteOrders.toString(), icon: ShoppingBag, accent: "primary" as const, to: "/web-orders" },
    { label: "Low Stock Products", value: lowStock.length.toString(), icon: Package, accent: "danger" as const, to: "/inventory" },
  ];

  const ACCENT_CLASSES: Record<string, { chip: string; icon: string }> = {
    revenue: { chip: "bg-[#C9975A]/12", icon: "text-[#C9975A]" },
    success: { chip: "bg-brand-success/12", icon: "text-brand-success" },
    primary: { chip: "bg-brand-primary/12", icon: "text-brand-primary" },
    stock: { chip: "bg-[#1F3A8A]/12", icon: "text-[#1F3A8A]" },
    repair: { chip: "bg-[#C9975A]/12", icon: "text-[#C9975A]" },
    danger: { chip: "bg-brand-danger/12", icon: "text-brand-danger" },
  };

  const PERIODS: { key: Period; label: string }[] = [
    { key: "day", label: "Day" },
    { key: "week", label: "Week" },
    { key: "month", label: "Month" },
    { key: "year", label: "Year" },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold text-gray-800">Dashboard</h1>
        <div className="flex rounded-lg border border-border bg-card p-0.5">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                period === p.key ? "bg-brand-primary text-white" : "text-gray-500 hover:text-gray-800"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {initialLoading
          ? Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="card relative overflow-hidden p-4 pl-5">
                <div className="h-3 w-20 animate-pulse rounded bg-accent" />
                <div className="mt-2.5 h-6 w-24 animate-pulse rounded bg-accent" />
              </div>
            ))
          : cards.map((c) => {
              const a = ACCENT_CLASSES[c.accent];
              const Card = (
                <div className="card relative overflow-hidden p-4 pl-5 transition-shadow hover:shadow-cardHover">
                  <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${c.bar}`} />
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-xs font-medium text-gray-500">{c.label}</div>
                      <div className="mt-1 font-serif text-2xl font-semibold text-gray-800">{c.value}</div>
                    </div>
                    <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${a.chip} ${a.icon}`}>
                      <c.icon size={17} strokeWidth={1.75} />
                    </div>
                  </div>
                </div>
              );
              return c.to ? <Link key={c.label} to={c.to}>{Card}</Link> : <div key={c.label}>{Card}</div>;
            })}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="card p-4">
          <div className="mb-3 flex items-center gap-2 font-serif text-sm font-semibold text-gray-700">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-brand-primary/12 text-brand-primary">
              <IndianRupee size={13} strokeWidth={2} />
            </span>
            Payment Mode Split
          </div>
          <ul className="space-y-2">
            {(Object.entries(paymentSplit.byMode) as [string, number][])
              .filter(([mode]) => mode !== "Other" || paymentSplit.byMode.Other > 0)
              .map(([mode, amount]) => (
                <li key={mode} className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">{mode}</span>
                  <span className="font-medium text-gray-800">{formatCurrency(amount)}</span>
                </li>
              ))}
          </ul>
        </div>

        <div className="card p-4">
          <div className="mb-3 flex items-center gap-2 font-serif text-sm font-semibold text-gray-700">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[#C9975A]/12 text-[#C9975A]">
              <Trophy size={13} strokeWidth={2} />
            </span>
            Top Selling Products
          </div>
          <table className="table-base">
            <thead>
              <tr>
                <th>Product</th>
                <th className="text-right">Qty</th>
                <th className="text-right">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {topProducts.map((p) => (
                <tr key={p.name}>
                  <td className="truncate max-w-[140px]">{p.name}</td>
                  <td className="text-right">{p.qty}</td>
                  <td className="text-right">{formatCurrency(p.revenue)}</td>
                </tr>
              ))}
              {topProducts.length === 0 && (
                <tr>
                  <td colSpan={3} className="py-4 text-center text-gray-400">No sales in this period</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="card-gold p-4">
          <div className="mb-3 flex items-center gap-2 font-serif text-sm font-semibold text-gray-700">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-brand-success/12 text-brand-success">
              <Boxes size={13} strokeWidth={2} />
            </span>
            Inventory Health
          </div>
          <div className="mb-3 flex items-center justify-between text-sm">
            <span className="text-gray-600">Live stock value</span>
            <span className="font-medium text-gray-800">{formatCurrency(liveStockValue)}</span>
          </div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Low stock ({lowStock.length})
          </div>
          <ul className="space-y-1.5">
            {lowStock.slice(0, 6).map((p) => (
              <li key={p.id} className="flex items-center justify-between text-sm">
                <span className="truncate text-gray-700">{p.name}</span>
                <span className="flex items-center gap-1.5">
                  {highDemandLowStock.some((h) => h.id === p.id) && (
                    <span className="pill-warning text-[10px]">high demand</span>
                  )}
                  <span className="pill-danger">{p.stock} left</span>
                </span>
              </li>
            ))}
            {lowStock.length === 0 && <p className="text-sm text-gray-400">All stocked up</p>}
          </ul>
        </div>
      </div>

      {/* Dead Stock Monitoring */}
      <div className="card p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-serif text-sm font-semibold text-gray-700">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-amber-500/12 text-amber-500">
              <AlertTriangle size={13} strokeWidth={2} />
            </span>
            Dead Stock Monitoring
          </div>
          <div className="flex rounded-lg border border-border bg-page p-0.5">
            {[60, 90].map((d) => (
              <button
                key={d}
                onClick={() => setDeadStockDays(d)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  deadStockDays === d ? "bg-brand-primary text-white" : "text-gray-500 hover:text-gray-800"
                }`}
              >
                {d}+ days
              </button>
            ))}
          </div>
        </div>
        <p className="mt-1 text-xs text-gray-500">
          Items with no sale in the last {deadStockDays} days — worth a clearance discount to free up shelf space.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Product</th>
                <th>Category</th>
                <th className="text-right">Stock</th>
                <th className="text-right">Value Tied Up</th>
                <th className="text-right">Days Since Last Sale</th>
              </tr>
            </thead>
            <tbody>
              {deadStock.slice(0, 10).map((p) => (
                <tr key={p.id}>
                  <td className="font-medium">{p.name}</td>
                  <td className="text-gray-500">{p.category ?? "-"}</td>
                  <td className="text-right">{p.stock}</td>
                  <td className="text-right">{formatCurrency(p.price * p.stock)}</td>
                  <td className="text-right">
                    <span className="pill-warning">{p.lastSoldAt ? `${p.daysSince}d` : "Never sold"}</span>
                  </td>
                </tr>
              ))}
              {deadStock.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-4 text-center text-gray-400">No dead stock — everything's moving.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Service & Repair Metrics */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card p-4">
          <div className="mb-3 flex items-center gap-2 font-serif text-sm font-semibold text-gray-700">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-brand-primary/12 text-brand-primary">
              <Wrench size={13} strokeWidth={2} />
            </span>
            Job Card Funnel
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {OPEN_REPAIR_STATUSES.map((s) => (
              <div key={s} className={`${REPAIR_STATUS_TILE[s]} p-2.5 text-center`}>
                <div className="font-serif text-xl font-semibold text-gray-800">{repairFunnel[s] ?? 0}</div>
                <div className="mt-0.5 text-[10px] uppercase tracking-wide text-gray-500">{REPAIR_STATUS_LABEL[s]}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="card-gold p-4">
          <div className="mb-3 flex items-center gap-2 font-serif text-sm font-semibold text-gray-700">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-gold/12 text-gold">
              <Wrench size={13} strokeWidth={2} />
            </span>
            Technician Efficiency
          </div>
          <table className="table-base">
            <thead>
              <tr>
                <th>Technician</th>
                <th className="text-right">Completed</th>
                <th className="text-right">Pending</th>
              </tr>
            </thead>
            <tbody>
              {technicianEfficiency.map((t) => (
                <tr key={t.name}>
                  <td className="font-medium">{t.name}</td>
                  <td className="text-right text-brand-success">{t.completed}</td>
                  <td className="text-right text-brand-warning">{t.pending}</td>
                </tr>
              ))}
              {technicianEfficiency.length === 0 && (
                <tr>
                  <td colSpan={3} className="py-4 text-center text-gray-400">No repairs assigned to any technician yet</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Staff Accountability & Goals */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card p-4">
          <div className="mb-3 flex items-center gap-2 font-serif text-sm font-semibold text-gray-700">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-gold/12 text-gold">
              <Trophy size={13} strokeWidth={2} />
            </span>
            Salesman Leaderboard — Today
          </div>
          <ul className="space-y-2">
            {salesLeaderboard.map((s, i) => (
              <li key={s.name} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2">
                  <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${i === 0 ? "bg-gold text-white" : "bg-gray-100 text-gray-500"}`}>
                    {i + 1}
                  </span>
                  <span className="text-gray-700">{s.name}</span>
                </span>
                <span className="text-gray-500">{s.count} sale{s.count === 1 ? "" : "s"} · <span className="font-medium text-gray-800">{formatCurrency(s.revenue)}</span></span>
              </li>
            ))}
            {salesLeaderboard.length === 0 && <p className="text-sm text-gray-400">No sales recorded today yet.</p>}
          </ul>
        </div>

        <div className="card-blue p-4">
          <div className="mb-3 flex items-center gap-2 font-serif text-sm font-semibold text-gray-700">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-brand-primary/12 text-brand-primary">
              <Target size={13} strokeWidth={2} />
            </span>
            Target Progress
          </div>
          <div className="space-y-3">
            {targetRows.map((t) => {
              const target = targets[t.key] ?? 0;
              const pct = target > 0 ? Math.min(100, Math.round((t.revenue / target) * 100)) : 0;
              return (
                <div key={t.key}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="font-medium text-gray-600">{t.label}</span>
                    <span className="text-gray-500">
                      {formatCurrency(t.revenue)} / {target > 0 ? formatCurrency(target) : "no target set"}
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
                    <div
                      className={`h-full rounded-full ${pct >= 100 ? "bg-brand-success" : "bg-brand-primary"}`}
                      style={{ width: `${target > 0 ? pct : 0}%` }}
                    />
                  </div>
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <input
                      type="number"
                      className="input !w-32 !py-1 text-xs"
                      placeholder={`Set ${t.label.toLowerCase()} target`}
                      value={targetDrafts[t.key] ?? ""}
                      onChange={(e) => setTargetDrafts((prev) => ({ ...prev, [t.key]: e.target.value }))}
                    />
                    <button
                      className="btn-ghost !px-2 !py-1 text-xs"
                      disabled={savingTarget === t.key || !targetDrafts[t.key]}
                      onClick={() => saveTarget(t.key)}
                    >
                      <Save size={12} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="card p-4 lg:col-span-3">
          <div className="mb-3 flex items-center gap-2 font-serif text-sm font-semibold text-gray-700">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-brand-primary/12 text-brand-primary">
              <ShoppingBag size={13} strokeWidth={2} />
            </span>
            Recent Website Orders
          </div>
          <div className="overflow-x-auto">
            <table className="table-base min-w-[560px]">
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
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {secondaryCards.map((c) => {
          const a = ACCENT_CLASSES[c.accent];
          const tile = c.accent === "repair" ? "card-gold" : c.accent === "primary" ? "card-blue" : "card";
          return (
            <Link key={c.label} to={c.to} className={`${tile} flex items-center gap-3 p-3 transition-shadow hover:shadow-cardHover`}>
              <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${a.chip} ${a.icon}`}>
                <c.icon size={16} strokeWidth={1.75} />
              </div>
              <span className="flex-1 text-sm text-gray-600">{c.label}</span>
              <span className="font-serif text-lg font-semibold text-gray-800">{c.value}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
