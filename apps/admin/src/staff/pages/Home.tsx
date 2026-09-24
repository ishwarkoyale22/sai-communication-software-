import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Clock, LogOut, Users, FileText, ListChecks, CalendarClock, Star, History, CalendarDays, Wrench, Wallet,
  PartyPopper, X, ShoppingCart, Package, MessageSquareText, Tag, Gift, ShoppingBag, Receipt, Target, UserPlus,
} from "lucide-react";
import { useStaffAuth } from "../context/StaffAuthContext";
import { supabase } from "../lib/supabase";
import { dbTime } from "../lib/time";

const CONFETTI = ["🎉", "🎈", "🎂", "🎊", "🌸", "✨"];

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good Morning";
  if (h < 17) return "Good Afternoon";
  return "Good Evening";
}

function workedHours(clockIn: string, asOf: number) {
  const ms = Math.max(0, asOf - new Date(clockIn).getTime()); // never negative when this device clock lags the server
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

type LinkDef = { to: string; label: string; icon: typeof Users; tile: string; iconColor: string };

// Legacy roles (staff/cashier/manager, or unset) keep the exact original
// grid — no regression for accounts that predate the role split.
const LEGACY_LINKS: LinkDef[] = [
  { to: "/portal/clients", label: "Clients", icon: Users, tile: "card-gold", iconColor: "text-gold" },
  { to: "/portal/reports", label: "Reports", icon: FileText, tile: "card-blue", iconColor: "text-brand-primary" },
  { to: "/portal/tasks", label: "Tasks", icon: ListChecks, tile: "card-amber", iconColor: "text-amber-600" },
  { to: "/portal/repairs", label: "My Repairs", icon: Wrench, tile: "card-purple", iconColor: "text-purple-600" },
  { to: "/portal/follow-ups", label: "Follow-ups", icon: CalendarClock, tile: "card-blue", iconColor: "text-brand-primary" },
  { to: "/portal/leave", label: "Leave", icon: CalendarDays, tile: "card-green", iconColor: "text-brand-success" },
  { to: "/portal/reviews", label: "Reviews", icon: Star, tile: "card-gold", iconColor: "text-gold" },
  { to: "/portal/finance-reports", label: "Finance Reports", icon: Wallet, tile: "card-green", iconColor: "text-brand-success" },
];

const TECHNICIAN_LINKS: LinkDef[] = [
  { to: "/portal/repairs", label: "My Repairs", icon: Wrench, tile: "card-purple", iconColor: "text-purple-600" },
  { to: "/portal/tasks", label: "Tasks", icon: ListChecks, tile: "card-amber", iconColor: "text-amber-600" },
  { to: "/portal/leave", label: "Leave", icon: CalendarDays, tile: "card-green", iconColor: "text-brand-success" },
];

const SALES_LINKS: LinkDef[] = [
  { to: "/portal/new-sale", label: "New Sale", icon: ShoppingCart, tile: "card-gold", iconColor: "text-gold" },
  { to: "/portal/products", label: "Products", icon: Package, tile: "card-blue", iconColor: "text-brand-primary" },
  { to: "/portal/enquiries", label: "Enquiries", icon: MessageSquareText, tile: "card-amber", iconColor: "text-amber-600" },
  { to: "/portal/follow-ups", label: "Leads / Follow-ups", icon: CalendarClock, tile: "card-blue", iconColor: "text-brand-primary" },
  { to: "/portal/offers", label: "Offers", icon: Tag, tile: "card-purple", iconColor: "text-purple-600" },
  { to: "/portal/gifts-catalog", label: "Gifts", icon: Gift, tile: "card-gold", iconColor: "text-gold" },
  { to: "/portal/orders", label: "Orders", icon: ShoppingBag, tile: "card-blue", iconColor: "text-brand-primary" },
  { to: "/portal/sales-history", label: "Sales History", icon: Receipt, tile: "card-green", iconColor: "text-brand-success" },
  { to: "/portal/targets", label: "Performance", icon: Target, tile: "card-amber", iconColor: "text-amber-600" },
  { to: "/portal/tasks", label: "Tasks", icon: ListChecks, tile: "card-purple", iconColor: "text-purple-600" },
  { to: "/portal/leave", label: "Leave", icon: CalendarDays, tile: "card-green", iconColor: "text-brand-success" },
];

const RECEPTIONIST_LINKS: LinkDef[] = [
  { to: "/portal/clients", label: "Customers", icon: UserPlus, tile: "card-gold", iconColor: "text-gold" },
  { to: "/portal/enquiries", label: "Enquiries", icon: MessageSquareText, tile: "card-amber", iconColor: "text-amber-600" },
  { to: "/portal/repair-intake", label: "Repair Intake", icon: Wrench, tile: "card-purple", iconColor: "text-purple-600" },
  { to: "/portal/follow-ups", label: "Appointments", icon: CalendarClock, tile: "card-blue", iconColor: "text-brand-primary" },
  { to: "/portal/reviews", label: "Feedback", icon: Star, tile: "card-gold", iconColor: "text-gold" },
  { to: "/portal/tasks", label: "Tasks", icon: ListChecks, tile: "card-amber", iconColor: "text-amber-600" },
  { to: "/portal/leave", label: "Leave", icon: CalendarDays, tile: "card-green", iconColor: "text-brand-success" },
];

export function Home() {
  const { staff, token, openAttendance, clockOut, todaysBirthdays, sendBirthdayWish } = useStaffAuth();
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [activity, setActivity] = useState<{ id: string; action: string; created_at: string }[]>([]);
  const [now, setNow] = useState(Date.now());
  // The birthday popup shows once per person per day (remembered on this device),
  // not on every visit to Home.
  const celebrationKey = `sai_bday_seen_${staff?.id}_${new Date().toDateString()}`;
  const [showCelebration, setShowCelebration] = useState(() => {
    try { return !localStorage.getItem(celebrationKey); } catch { return true; }
  });
  function closeCelebration() {
    setShowCelebration(false);
    try { localStorage.setItem(celebrationKey, "1"); } catch { /* ignore */ }
  }

  const role = staff?.role;
  const links = role === "technician" ? TECHNICIAN_LINKS : role === "sales" ? SALES_LINKS : role === "receptionist" ? RECEPTIONIST_LINKS : LEGACY_LINKS;
  const portalLabel = role === "technician" ? "Technician Portal" : role === "sales" ? "Sales Portal" : role === "receptionist" ? "Reception Portal" : "Staff Portal";

  const ownBirthday = todaysBirthdays.some((b) => b.is_self);
  const otherBirthdays = todaysBirthdays.filter((b) => !b.is_self);

  async function wish(id: string) {
    await sendBirthdayWish(id);
  }

  useEffect(() => {
    if (!openAttendance) return;
    const t = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(t);
  }, [openAttendance]);

  useEffect(() => {
    if (!token) return;
    (async () => {
      if (role === "technician") {
        const { data } = await supabase.rpc("staff_get_repairs", { p_token: token });
        const rows = (data as { status: string }[]) ?? [];
        setCounts({
          openRepairs: rows.filter((r) => !["completed", "delivered", "cancelled"].includes(r.status)).length,
          pendingTasks: 0,
        });
      } else if (role === "sales") {
        const [sales, followUps, tasks] = await Promise.all([
          supabase.rpc("staff_get_my_sales", { p_token: token }),
          supabase.rpc("staff_get_followups", { p_token: token }),
          supabase.rpc("staff_get_tasks", { p_token: token }),
        ]);
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const salesRows = (sales.data as { final_amount: number; created_at: string }[]) ?? [];
        setCounts({
          todaySales: salesRows.filter((s) => dbTime(s.created_at).getTime() >= todayStart.getTime()).length,
          followUps: ((followUps.data as { status: string }[]) ?? []).filter((f) => f.status === "pending").length,
          pendingTasks: ((tasks.data as { status: string }[]) ?? []).filter((t) => t.status !== "completed").length,
        });
      } else if (role === "receptionist") {
        const [enquiries, followUps, tasks] = await Promise.all([
          supabase.rpc("staff_get_enquiries", { p_token: token }),
          supabase.rpc("staff_get_followups", { p_token: token }),
          supabase.rpc("staff_get_tasks", { p_token: token }),
        ]);
        setCounts({
          enquiries: (enquiries.data ?? []).length,
          followUps: ((followUps.data as { status: string }[]) ?? []).filter((f) => f.status === "pending").length,
          pendingTasks: ((tasks.data as { status: string }[]) ?? []).filter((t) => t.status !== "completed").length,
        });
      } else {
        const [clients, reports, tasks, followUps, act] = await Promise.all([
          supabase.rpc("staff_get_clients", { p_token: token, p_search: null }),
          supabase.rpc("staff_get_client_reports", { p_token: token }),
          supabase.rpc("staff_get_tasks", { p_token: token }),
          supabase.rpc("staff_get_followups", { p_token: token }),
          supabase.rpc("staff_get_activity", { p_token: token }),
        ]);
        setCounts({
          clients: (clients.data || []).length,
          reports: (reports.data || []).length,
          pendingTasks: ((tasks.data as { status: string }[]) || []).filter((t) => t.status !== "completed").length,
          followUps: ((followUps.data as { status: string }[]) || []).filter((f) => f.status === "pending").length,
        });
        setActivity(((act.data as { id: string; action: string; created_at: string }[]) || []).slice(0, 5));
      }
    })();
  }, [token, role]);

  const statTiles =
    role === "technician"
      ? [
          { key: "openRepairs", label: "Open Repairs", icon: Wrench, color: "text-purple-600", tile: "card-purple" },
          { key: "pendingTasks", label: "Pending Tasks", icon: ListChecks, color: "text-gold", tile: "card-amber" },
        ]
      : role === "sales"
        ? [
            { key: "todaySales", label: "Sales Today", icon: Receipt, color: "text-brand-success", tile: "card-green" },
            { key: "followUps", label: "Follow-ups", icon: CalendarClock, color: "text-brand-primary", tile: "card-blue" },
            { key: "pendingTasks", label: "Pending Tasks", icon: ListChecks, color: "text-gold", tile: "card-amber" },
          ]
        : role === "receptionist"
          ? [
              { key: "enquiries", label: "Enquiries", icon: MessageSquareText, color: "text-amber-600", tile: "card-amber" },
              { key: "followUps", label: "Appointments", icon: CalendarClock, color: "text-brand-primary", tile: "card-blue" },
              { key: "pendingTasks", label: "Pending Tasks", icon: ListChecks, color: "text-gold", tile: "card-amber" },
            ]
          : [
              { key: "clients", label: "Clients", icon: Users, color: "text-gold", tile: "card-gold" },
              { key: "reports", label: "Reports", icon: FileText, color: "text-brand-primary", tile: "card-blue" },
              { key: "pendingTasks", label: "Pending Tasks", icon: ListChecks, color: "text-gold", tile: "card-amber" },
              { key: "followUps", label: "Follow-ups", icon: CalendarClock, color: "text-brand-primary", tile: "card-blue" },
            ];

  return (
    <div className="space-y-4">
      {ownBirthday && showCelebration && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4">
          <div className="relative w-full max-w-xs overflow-hidden rounded-2xl bg-gradient-to-br from-gold via-gold to-goldDim p-6 text-center text-white shadow-xl">
            <button
              onClick={closeCelebration}
              className="absolute right-3 top-3 text-white/80 hover:text-white"
              aria-label="Close"
            >
              <X size={18} />
            </button>
            <div className="pointer-events-none absolute inset-0 overflow-hidden text-2xl opacity-80">
              {Array.from({ length: 18 }).map((_, i) => (
                <span
                  key={i}
                  className="absolute animate-bounce"
                  style={{
                    left: `${(i * 37) % 100}%`,
                    top: `${(i * 53) % 100}%`,
                    animationDelay: `${(i % 6) * 0.2}s`,
                    animationDuration: `${1.5 + (i % 3) * 0.4}s`,
                  }}
                >
                  {CONFETTI[i % CONFETTI.length]}
                </span>
              ))}
            </div>
            <div className="relative">
              <div className="text-4xl">🎉🎂🎉</div>
              <div className="mt-3 font-serif text-xl font-bold">Happy Birthday!</div>
              <div className="mt-1 text-sm text-white/90">Wishing you a wonderful day, {staff?.name?.split(" ")[0]}!</div>
            </div>
          </div>
        </div>
      )}

      {otherBirthdays.length > 0 && (
        <div className="card flex flex-wrap items-center justify-between gap-2 border-gold/40 bg-gold/5 p-3">
          <div className="flex items-center gap-2 text-sm">
            <PartyPopper size={16} className="text-gold" />
            <span className="font-medium text-gray-700">
              Today's Birthday: {otherBirthdays.map((b) => b.name).join(", ")}
            </span>
          </div>
          <div className="flex gap-1.5">
            {otherBirthdays.map((b) => (
              <button
                key={b.id}
                disabled={!!b.already_wished}
                onClick={() => wish(b.id)}
                className="whitespace-nowrap rounded-lg bg-gold/15 px-2.5 py-1 text-xs font-semibold text-goldDim disabled:opacity-50"
              >
                {b.already_wished ? "Wished ✓" : `Wish ${b.name.split(" ")[0]}`}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Shift card — gold-glow graphite band, echoing the admin sidebar's
          medallion motif instead of a flat white strip. */}
      <div className="relative overflow-hidden rounded-2xl bg-sidebar p-4 text-white">
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: "radial-gradient(260px circle at 8% 0%, rgba(201,151,90,0.22), transparent 70%)" }}
        />
        <div className="relative text-xs font-medium text-white/60">
          {portalLabel} · {greeting()}, {staff?.name}
        </div>
        <div className="relative mt-2 flex items-center justify-between">
          <div className={`flex items-center gap-1.5 text-sm font-semibold ${openAttendance ? "text-emerald-400" : "text-white/40"}`}>
            <Clock size={15} />
            {openAttendance ? `Working hours: ${workedHours(openAttendance.clock_in, now)}` : "Not clocked in"}
          </div>
          {openAttendance ? (
            <button
              onClick={() => clockOut()}
              className="flex items-center gap-1 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/15"
            >
              <LogOut size={13} /> Check Out
            </button>
          ) : (
            <Link
              to="/portal/attendance"
              className="rounded-lg bg-gradient-to-br from-gold to-goldDim px-3 py-1.5 text-xs font-semibold text-white shadow-sm"
            >
              Check In
            </Link>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {statTiles.map((s) => (
          <div key={s.key} className={`${s.tile} p-3`}>
            <div className="flex items-start justify-between">
              <div>
                <div className="font-serif text-2xl font-semibold text-gray-800">{counts[s.key] ?? 0}</div>
                <div className="text-xs text-gray-500">{s.label}</div>
              </div>
              <div className={`flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-white/60 ${s.color}`}>
                <s.icon size={15} strokeWidth={1.75} />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-3">
        {links.map(({ to, label, icon: Icon, tile, iconColor }) => (
          <Link
            key={to}
            to={to}
            className={`${tile} flex flex-col items-center justify-center gap-2 p-3 transition-all hover:-translate-y-0.5 hover:shadow-cardHover`}
          >
            <div className={`flex h-9 w-9 items-center justify-center rounded-full bg-white/70 ${iconColor}`}>
              <Icon size={17} strokeWidth={1.75} />
            </div>
            <span className="text-center text-[11px] font-medium text-gray-700">{label}</span>
          </Link>
        ))}
      </div>

      {role !== "technician" && role !== "sales" && role !== "receptionist" && (
        <div className="card p-4">
          <h3 className="mb-2 flex items-center gap-1.5 font-serif text-sm font-semibold text-gray-700">
            <History size={15} className="text-gold" /> Recent Activity
          </h3>
          {activity.length === 0 ? (
            <div className="text-xs text-gray-400">No recent activity.</div>
          ) : (
            <ul className="divide-y divide-border">
              {activity.map((a) => (
                <li key={a.id} className="flex items-center justify-between py-1.5 text-xs first:pt-0 last:pb-0">
                  <span className="flex items-center gap-2 capitalize text-gray-600">
                    <span className="h-1.5 w-1.5 rounded-full bg-gold" />
                    {a.action.replace(/_/g, " ")}
                  </span>
                  <span className="text-gray-400">{dbTime(a.created_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
