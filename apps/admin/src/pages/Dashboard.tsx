import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { IndianRupee, TrendingUp, Package, Wrench } from "lucide-react";
import { formatCurrency, formatDateTime, type Product, type Sale, type Staff, type Attendance, type Customer } from "@sai/shared";
import { supabase } from "../lib/supabase";
import { StatusPill } from "../components/StatusPill";

interface Metrics {
  todayRevenue: number;
  grossProfit: number;
  itemsInStock: number;
  openRepairs: number;
}

interface ActivityItem {
  id: string;
  icon: string;
  label: string;
  at: string;
}

export function Dashboard() {
  const [metrics, setMetrics] = useState<Metrics>({
    todayRevenue: 0,
    grossProfit: 0,
    itemsInStock: 0,
    openRepairs: 0,
  });
  const [recentSales, setRecentSales] = useState<Sale[]>([]);
  const [lowStock, setLowStock] = useState<Product[]>([]);
  const [staffStatus, setStaffStatus] = useState<(Staff & { attendance?: Attendance })[]>([]);
  const [birthdays, setBirthdays] = useState<Customer[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [newEnquiries, setNewEnquiries] = useState(0);

  useEffect(() => {
    load();
    // Keep the activity feed live: new sales, repair status changes, stock
    // edits, and website enquiries all show up here without a refresh.
    const channel = supabase
      .channel("dashboard-activity")
      .on("postgres_changes", { event: "*", schema: "public", table: "sales" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "repairs" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "products" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "enquiries" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function load() {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [{ data: todaySales }, { data: products }, { data: repairs }, { data: sales }, { data: staff }, { data: customers }] =
      await Promise.all([
        supabase.from("sales").select("*").gte("created_at", todayStart.toISOString()),
        supabase.from("products").select("*").order("stock_qty", { ascending: true }),
        supabase.from("repairs").select("id, status").neq("status", "collected"),
        supabase.from("sales").select("*").order("created_at", { ascending: false }).limit(8),
        supabase.from("staff").select("*").eq("is_active", true),
        supabase.from("customers").select("*"),
      ]);

    const revenue = (todaySales ?? []).reduce((s, r) => s + Number(r.total_amount), 0);
    const cost = (todaySales ?? []).reduce((s, r) => s + Number(r.purchase_total), 0);

    setMetrics({
      todayRevenue: revenue,
      grossProfit: revenue - cost,
      itemsInStock: (products ?? []).reduce((s, p) => s + p.stock_qty, 0),
      openRepairs: repairs?.length ?? 0,
    });

    setLowStock((products ?? []).filter((p) => p.stock_qty <= p.min_stock_alert).slice(0, 6));
    setRecentSales(sales ?? []);

    if (staff && staff.length) {
      const dayStart = todayStart.toISOString();
      const { data: att } = await supabase
        .from("attendance")
        .select("*")
        .gte("clock_in", dayStart)
        .in(
          "staff_id",
          staff.map((s) => s.id)
        );
      setStaffStatus(
        staff.map((s) => ({ ...s, attendance: att?.find((a) => a.staff_id === s.id) }))
      );
    }

    const todayMonthDay = `${String(new Date().getMonth() + 1).padStart(2, "0")}-${String(
      new Date().getDate()
    ).padStart(2, "0")}`;
    setBirthdays(
      (customers ?? []).filter((c) => c.birthday && c.birthday.slice(5) === todayMonthDay)
    );

    const [{ data: recentRepairs }, { data: recentProducts }, { data: recentEnquiries }, { count: newEnqCount }] =
      await Promise.all([
        supabase.from("repairs").select("*").order("received_at", { ascending: false }).limit(5),
        supabase.from("products").select("*").order("updated_at", { ascending: false }).limit(5),
        supabase.from("enquiries").select("*").order("created_at", { ascending: false }).limit(5),
        supabase.from("enquiries").select("id", { count: "exact", head: true }).eq("status", "new"),
      ]);
    setNewEnquiries(newEnqCount ?? 0);

    const feed: ActivityItem[] = [
      ...(sales ?? []).map((s) => ({
        id: `sale-${s.id}`,
        icon: "🧾",
        label: `New ${s.sale_type} sale — ${s.invoice_number} (${formatCurrency(s.total_amount)})`,
        at: s.created_at,
      })),
      ...(recentRepairs ?? []).map((r) => ({
        id: `repair-${r.id}`,
        icon: "🔧",
        label: `Repair ${r.repair_number} — ${r.device_name} (${r.status.replace("_", " ")})`,
        at: r.completed_at ?? r.received_at,
      })),
      ...(recentProducts ?? []).map((p) => ({
        id: `product-${p.id}`,
        icon: "📦",
        label: `Stock updated — ${p.name} (${p.stock_qty} left)`,
        at: p.updated_at,
      })),
      ...(recentEnquiries ?? []).map((e) => ({
        id: `enquiry-${e.id}`,
        icon: "💬",
        label: `New enquiry — ${e.name} (${e.phone})`,
        at: e.created_at,
      })),
    ]
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, 8);
    setActivity(feed);
  }

  const cards = [
    {
      label: "Today's Revenue",
      value: formatCurrency(metrics.todayRevenue),
      icon: IndianRupee,
      iconBg: "bg-emerald-50 text-emerald-600",
      accent: "before:bg-brand-revenue",
    },
    {
      label: "Gross Profit",
      value: formatCurrency(metrics.grossProfit),
      icon: TrendingUp,
      iconBg: "bg-indigo-50 text-indigo-600",
      accent: "before:bg-brand-profit",
    },
    {
      label: "Items in Stock",
      value: metrics.itemsInStock.toLocaleString("en-IN"),
      icon: Package,
      iconBg: "bg-sky-50 text-sky-600",
      accent: "before:bg-brand-stock",
    },
    {
      label: "Open Repairs",
      value: metrics.openRepairs.toString(),
      icon: Wrench,
      iconBg: "bg-amber-50 text-amber-600",
      accent: "before:bg-brand-repair",
    },
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-4 gap-4">
        {cards.map((c) => (
          <div
            key={c.label}
            className={`card relative overflow-hidden p-4 pl-5 transition-shadow hover:shadow-cardHover before:absolute before:inset-y-0 before:left-0 before:w-1 ${c.accent}`}
          >
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
        ))}
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="card col-span-2 p-4">
          <div className="mb-3 text-sm font-semibold text-gray-700">Recent Sales</div>
          <table className="table-base">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Type</th>
                <th>GST</th>
                <th className="text-right">Amount</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {recentSales.map((s) => (
                <tr key={s.id}>
                  <td className="font-medium">{s.invoice_number}</td>
                  <td>
                    <StatusPill status={s.sale_type} />
                  </td>
                  <td>{s.gst_applicable ? <StatusPill status="paid" label="GST" /> : "-"}</td>
                  <td className="text-right">{formatCurrency(s.total_amount)}</td>
                  <td className="text-gray-500">{formatDateTime(s.created_at)}</td>
                </tr>
              ))}
              {recentSales.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-gray-400">
                    No sales yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="space-y-4">
          <div className="card p-4">
            <div className="mb-3 text-sm font-semibold text-gray-700">Low Stock Alerts</div>
            <ul className="space-y-1.5">
              {lowStock.map((p) => (
                <li key={p.id} className="flex justify-between text-sm">
                  <span className="text-gray-700">{p.name}</span>
                  <span className="pill-danger">{p.stock_qty} left</span>
                </li>
              ))}
              {lowStock.length === 0 && <p className="text-sm text-gray-400">All stocked up</p>}
            </ul>
          </div>

          <div className="card p-4">
            <div className="mb-3 text-sm font-semibold text-gray-700">Staff Clock-in Status</div>
            <ul className="space-y-1.5">
              {staffStatus.map((s) => (
                <li key={s.id} className="flex items-center justify-between text-sm">
                  <span className="text-gray-700">{s.name}</span>
                  {s.attendance ? (
                    s.attendance.clock_out ? (
                      <StatusPill status="overdue" label="Clocked out" />
                    ) : (
                      <StatusPill status="active" label={`In · ${formatDateTime(s.attendance.clock_in).split(",")[1]}`} />
                    )
                  ) : (
                    <StatusPill status="neutral" label="Not in" />
                  )}
                </li>
              ))}
            </ul>
          </div>

          <div className="card p-4">
            <div className="mb-3 text-sm font-semibold text-gray-700">Birthdays Today</div>
            <ul className="space-y-1.5">
              {birthdays.map((c) => (
                <li key={c.id} className="text-sm text-gray-700">
                  🎂 {c.name} {c.phone ? `· ${c.phone}` : ""}
                </li>
              ))}
              {birthdays.length === 0 && <p className="text-sm text-gray-400">None today</p>}
            </ul>
          </div>

          {newEnquiries > 0 && (
            <Link to="/enquiries" className="card block p-4 hover:border-brand-primary">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-700">Website Enquiries</span>
                <span className="pill-danger">{newEnquiries} new</span>
              </div>
              <p className="mt-1 text-xs text-gray-400">Click to view & respond</p>
            </Link>
          )}
        </div>
      </div>

      <div className="card p-4">
        <div className="mb-3 text-sm font-semibold text-gray-700">Recent Activity</div>
        <ul className="space-y-2">
          {activity.map((a) => (
            <li key={a.id} className="flex items-center justify-between text-sm">
              <span className="text-gray-700">
                <span className="mr-2">{a.icon}</span>
                {a.label}
              </span>
              <span className="shrink-0 text-xs text-gray-400">{formatDateTime(a.at)}</span>
            </li>
          ))}
          {activity.length === 0 && <p className="text-sm text-gray-400">Nothing yet</p>}
        </ul>
      </div>
    </div>
  );
}
