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
      <div className="card p-4">
        <div className="text-xs font-medium text-gray-500">
          {greeting()}, {staff?.name}
        </div>
        <div className="mt-2 flex items-center justify-between">
          <div className={`flex items-center gap-1.5 text-sm font-medium ${openAttendance ? "text-brand-success" : "text-gray-400"}`}>
            <Clock size={15} />
            {openAttendance ? `Working hours: ${workedHours(openAttendance.clock_in, now)}` : "Not clocked in"}
          </div>
          {openAttendance ? (
            <button onClick={() => clockOut()} className="flex items-center gap-1 rounded-md bg-brand-danger/10 px-3 py-1.5 text-xs font-medium text-brand-danger">
              <LogOut size={13} /> Check Out
            </button>
          ) : (
            <Link to="/portal/attendance" className="rounded-md bg-brand-primary/10 px-3 py-1.5 text-xs font-medium text-brand-primary">
              Check In
            </Link>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="card p-3">
          <div className="text-2xl font-semibold text-gray-800">{counts.clients}</div>
          <div className="text-xs text-gray-500">Clients</div>
        </div>
        <div className="card p-3">
          <div className="text-2xl font-semibold text-gray-800">{counts.reports}</div>
          <div className="text-xs text-gray-500">Reports</div>
        </div>
        <div className="card p-3">
          <div className="text-2xl font-semibold text-gray-800">{counts.pendingTasks}</div>
          <div className="text-xs text-gray-500">Pending Tasks</div>
        </div>
        <div className="card p-3">
          <div className="text-2xl font-semibold text-gray-800">{counts.followUps}</div>
          <div className="text-xs text-gray-500">Follow-ups</div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {LINKS.map(({ to, label, icon: Icon }) => (
          <Link key={to} to={to} className="card flex flex-col items-center justify-center gap-1.5 p-3">
            <Icon className="text-brand-primary" size={20} />
            <span className="text-center text-[11px] font-medium">{label}</span>
          </Link>
        ))}
      </div>

      <div className="card p-4">
        <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-gray-700">
          <History size={15} /> Recent Activity
        </h3>
        {activity.length === 0 ? (
          <div className="text-xs text-gray-400">No recent activity.</div>
        ) : (
          <ul className="space-y-1.5">
            {activity.map((a) => (
              <li key={a.id} className="flex items-center justify-between text-xs">
                <span className="text-gray-600">{a.action.replace(/_/g, " ")}</span>
                <span className="text-gray-400">{new Date(a.created_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
