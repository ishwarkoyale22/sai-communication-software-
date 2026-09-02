import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Clock, LogOut, Users, FileText, ListChecks, CalendarClock, Star, History, CalendarDays } from "lucide-react";
import { useStaffAuth } from "../context/StaffAuthContext";
import { supabase } from "../lib/supabase";

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good Morning";
  if (h < 17) return "Good Afternoon";
  return "Good Evening";
}

function workedHours(clockIn: string, asOf: number) {
  const ms = asOf - new Date(clockIn).getTime();
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

const STATS = [
  { key: "clients" as const, label: "Clients", icon: Users, color: "text-gold" },
  { key: "reports" as const, label: "Reports", icon: FileText, color: "text-brand-primary" },
  { key: "pendingTasks" as const, label: "Pending Tasks", icon: ListChecks, color: "text-gold" },
  { key: "followUps" as const, label: "Follow-ups", icon: CalendarClock, color: "text-brand-primary" },
];

const LINKS = [
  { to: "/portal/clients", label: "Clients", icon: Users },
  { to: "/portal/reports", label: "Reports", icon: FileText },
  { to: "/portal/tasks", label: "Tasks", icon: ListChecks },
  { to: "/portal/follow-ups", label: "Follow-ups", icon: CalendarClock },
  { to: "/portal/leave", label: "Leave", icon: CalendarDays },
  { to: "/portal/reviews", label: "Reviews", icon: Star },
];

export function Home() {
  const { staff, token, openAttendance, clockOut } = useStaffAuth();
  const [counts, setCounts] = useState({ clients: 0, reports: 0, pendingTasks: 0, followUps: 0 });
  const [activity, setActivity] = useState<{ id: string; action: string; created_at: string }[]>([]);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!openAttendance) return;
    const t = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(t);
  }, [openAttendance]);

  useEffect(() => {
    if (!token) return;
    (async () => {
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
    })();
  }, [token]);

  return (
    <div className="space-y-4">
      {/* Shift card — gold-glow graphite band, echoing the admin sidebar's
          medallion motif instead of a flat white strip. */}
      <div className="relative overflow-hidden rounded-2xl bg-sidebar p-4 text-white">
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: "radial-gradient(260px circle at 8% 0%, rgba(201,151,90,0.22), transparent 70%)" }}
        />
        <div className="relative text-xs font-medium text-white/60">
          {greeting()}, {staff?.name}
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
        {STATS.map((s) => (
          <div key={s.key} className="card p-3">
            <div className="flex items-start justify-between">
              <div>
                <div className="font-serif text-2xl font-semibold text-gray-800">{counts[s.key]}</div>
                <div className="text-xs text-gray-500">{s.label}</div>
              </div>
              <div className={`flex h-8 w-8 items-center justify-center rounded-lg border border-border ${s.color}`}>
                <s.icon size={15} strokeWidth={1.75} />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-3">
        {LINKS.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            className="card flex flex-col items-center justify-center gap-2 p-3 transition-all hover:-translate-y-0.5 hover:border-gold hover:shadow-cardHover"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-brand-primary">
              <Icon size={17} strokeWidth={1.75} />
            </div>
            <span className="text-center text-[11px] font-medium text-gray-700">{label}</span>
          </Link>
        ))}
      </div>

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
                <span className="text-gray-400">{new Date(a.created_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
