import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { Check, X, Plus, PartyPopper } from "lucide-react";

interface Staff {
  id: string;
  name: string;
  phone: string | null;
  date_of_birth: string | null;
}

interface AttendanceRow {
  id: string;
  staff_id: string;
  clock_in: string;
  clock_out: string | null;
  clock_in_lat: number | null;
  clock_in_lng: number | null;
}

interface LeaveRow {
  id: string;
  staff_id: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  reason: string | null;
  status: string;
  created_at: string;
}

interface TaskRow {
  id: string;
  staff_id: string;
  title: string;
  description: string | null;
  status: string;
  due_date: string | null;
}

const TABS = ["Attendance", "Leave", "Tasks"] as const;
type Tab = (typeof TABS)[number];

export function StaffPortal() {
  const [searchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const initialTab: Tab = TABS.includes(tabParam as Tab) ? (tabParam as Tab) : "Attendance";
  const [tab, setTab] = useState<Tab>(initialTab);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRow[]>([]);
  const [leave, setLeave] = useState<LeaveRow[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [taskForm, setTaskForm] = useState({ staff_id: "", title: "", description: "", due_date: "" });
  const [wishedIds, setWishedIds] = useState<string[]>([]);

  useEffect(() => {
    load();
    // This page never re-fetched on its own — a staff member clocking in,
    // filing a leave request, or completing a task only showed up here
    // after leaving the page and coming back. Live-refresh on every table
    // this view reads from.
    const channel = supabase
      .channel("staff-portal-oversight-page")
      .on("postgres_changes", { event: "*", schema: "public", table: "attendance" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "leave_requests" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "staff_tasks" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "staff" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function load() {
    const [{ data: s }, { data: a }, { data: l }, { data: t }] = await Promise.all([
      supabase.from("staff").select("id, name, phone, date_of_birth").order("name"),
      supabase.from("attendance").select("*").order("clock_in", { ascending: false }).limit(100),
      supabase.from("leave_requests").select("*").order("created_at", { ascending: false }),
      supabase.from("staff_tasks").select("*").order("created_at", { ascending: false }),
    ]);
    setStaff((s as Staff[]) ?? []);
    // Remember who Admin has already wished today, so "Wished ✓" survives leaving the page
    // and a second click can't send the same wish again.
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const { data: wishes } = await supabase
      .from("notifications")
      .select("staff_id")
      .eq("type", "birthday_wish")
      .is("related_id", null)
      .gte("created_at", dayStart.toISOString());
    setWishedIds(((wishes as { staff_id: string }[]) ?? []).map((w) => w.staff_id));
    setAttendance((a as AttendanceRow[]) ?? []);
    setLeave((l as LeaveRow[]) ?? []);
    setTasks((t as TaskRow[]) ?? []);
  }

  function staffName(id: string) {
    return staff.find((s) => s.id === id)?.name ?? "Unknown";
  }

  const todaysBirthdays = staff.filter((s) => {
    if (!s.date_of_birth) return false;
    // date_of_birth is a plain "YYYY-MM-DD" — compare the text, not a Date (which shifts by timezone).
    const [, m, d] = s.date_of_birth.split("-").map(Number);
    const now = new Date();
    return m === now.getMonth() + 1 && d === now.getDate();
  });

  async function wishBirthday(s: Staff) {
    if (wishedIds.includes(s.id)) return;
    setWishedIds((prev) => [...prev, s.id]);
    await supabase.from("notifications").insert({
      staff_id: s.id,
      type: "birthday_wish",
      title: "Happy Birthday! 🎂",
      body: "Admin wished you a happy birthday!",
    });
  }

  async function reviewLeave(id: string, status: "approved" | "rejected") {
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from("leave_requests").update({ status, reviewed_by: user?.id, reviewed_at: new Date().toISOString() }).eq("id", id);
    load();
  }

  async function assignTask() {
    if (!taskForm.staff_id || !taskForm.title.trim()) return;
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from("staff_tasks").insert({
      staff_id: taskForm.staff_id,
      title: taskForm.title.trim(),
      description: taskForm.description.trim() || null,
      due_date: taskForm.due_date || null,
      assigned_by: user?.id,
    });
    setTaskForm({ staff_id: "", title: "", description: "", due_date: "" });
    setShowTaskForm(false);
    load();
  }

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-gray-800">Staff Portal Oversight</h1>

      {todaysBirthdays.length > 0 && (
        <div className="card flex flex-wrap items-center justify-between gap-2 border-gold/40 bg-gold/5 p-3">
          <div className="flex items-center gap-2 text-sm">
            <PartyPopper size={16} className="text-gold" />
            <span className="font-medium text-gray-700">
              Today's Birthday: {todaysBirthdays.map((s) => s.name).join(", ")}
            </span>
          </div>
          <div className="flex gap-1.5">
            {todaysBirthdays.map((s) => (
              <button
                key={s.id}
                disabled={wishedIds.includes(s.id)}
                onClick={() => wishBirthday(s)}
                className="rounded-lg bg-gold/15 px-2.5 py-1 text-xs font-semibold text-goldDim disabled:opacity-50"
              >
                {wishedIds.includes(s.id) ? "Wished ✓" : `Wish ${s.name.split(" ")[0]}`}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-1 rounded-md bg-gray-100 p-1 w-fit">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded px-4 py-1.5 text-sm font-medium transition-colors ${
              tab === t ? "bg-white text-brand-primary shadow-sm" : "text-gray-500"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Attendance" && (
        <div className="card overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Staff</th>
                <th>Date</th>
                <th>Clock In</th>
                <th>Clock Out</th>
                <th>Location</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {attendance.map((a) => (
                <tr key={a.id}>
                  <td className="font-medium">{staffName(a.staff_id)}</td>
                  <td>{new Date(a.clock_in).toLocaleDateString("en-IN")}</td>
                  <td>{new Date(a.clock_in).toLocaleTimeString("en-IN")}</td>
                  <td>{a.clock_out ? new Date(a.clock_out).toLocaleTimeString("en-IN") : "—"}</td>
                  <td>
                    {a.clock_in_lat != null && a.clock_in_lng != null ? (
                      <a
                        className="text-brand-primary underline"
                        href={`https://www.google.com/maps?q=${a.clock_in_lat},${a.clock_in_lng}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        View on map
                      </a>
                    ) : (
                      <span className="text-gray-400">Not captured</span>
                    )}
                  </td>
                  <td>
                    <span className={a.clock_out ? "pill-info" : "pill-success"}>
                      {a.clock_out ? "Checked out" : "Present"}
                    </span>
                  </td>
                </tr>
              ))}
              {attendance.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-gray-400">No attendance records yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === "Leave" && (
        <div className="card overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Staff</th>
                <th>Type</th>
                <th>Dates</th>
                <th>Reason</th>
                <th>Status</th>
                <th className="text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {leave.map((l) => (
                <tr key={l.id}>
                  <td className="font-medium">{staffName(l.staff_id)}</td>
                  <td className="capitalize">{l.leave_type}</td>
                  <td>
                    {new Date(l.start_date).toLocaleDateString("en-IN")} – {new Date(l.end_date).toLocaleDateString("en-IN")}
                  </td>
                  <td className="max-w-xs truncate">{l.reason ?? "-"}</td>
                  <td className="capitalize">{l.status}</td>
                  <td className="text-right">
                    {l.status === "pending" && (
                      <div className="flex justify-end gap-1">
                        <button className="btn-secondary !px-2 !py-1 text-xs" onClick={() => reviewLeave(l.id, "approved")}>
                          <Check size={13} />
                        </button>
                        <button className="btn-ghost !px-2 !py-1 text-xs text-brand-danger" onClick={() => reviewLeave(l.id, "rejected")}>
                          <X size={13} />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {leave.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-gray-400">No leave requests yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === "Tasks" && (
        <div className="space-y-3">
          <button className="btn-primary flex items-center gap-1.5 text-sm" onClick={() => setShowTaskForm(true)}>
            <Plus size={14} /> Assign Task
          </button>
          <div className="card overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Staff</th>
                  <th>Title</th>
                  <th>Status</th>
                  <th>Due</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((t) => (
                  <tr key={t.id}>
                    <td className="font-medium">{staffName(t.staff_id)}</td>
                    <td>{t.title}</td>
                    <td className="capitalize">{t.status.replace("_", " ")}</td>
                    <td>{t.due_date ? new Date(t.due_date).toLocaleDateString("en-IN") : "-"}</td>
                  </tr>
                ))}
                {tasks.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-gray-400">No tasks assigned yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showTaskForm && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4">
          <div className="card w-full max-w-md space-y-3 p-5">
            <h2 className="text-sm font-semibold text-gray-800">Assign Task</h2>
            <select className="input w-full" value={taskForm.staff_id} onChange={(e) => setTaskForm({ ...taskForm, staff_id: e.target.value })}>
              <option value="">Select staff...</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <input className="input w-full" placeholder="Task title" value={taskForm.title} onChange={(e) => setTaskForm({ ...taskForm, title: e.target.value })} />
            <textarea className="input w-full" placeholder="Description (optional)" value={taskForm.description} onChange={(e) => setTaskForm({ ...taskForm, description: e.target.value })} />
            <input type="date" className="input w-full" value={taskForm.due_date} onChange={(e) => setTaskForm({ ...taskForm, due_date: e.target.value })} />
            <div className="flex justify-end gap-2 pt-2">
              <button className="btn-ghost" onClick={() => setShowTaskForm(false)}>Cancel</button>
              <button className="btn-primary" onClick={assignTask}>Assign</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
