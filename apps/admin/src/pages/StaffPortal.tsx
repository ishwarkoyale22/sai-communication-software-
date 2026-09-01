import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { Check, X, Plus } from "lucide-react";

interface Staff {
  id: string;
  name: string;
  phone: string | null;
}

interface AttendanceRow {
  id: string;
  staff_id: string;
  clock_in: string;
  clock_out: string | null;
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
  const [tab, setTab] = useState<Tab>("Attendance");
  const [staff, setStaff] = useState<Staff[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRow[]>([]);
  const [leave, setLeave] = useState<LeaveRow[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [taskForm, setTaskForm] = useState({ staff_id: "", title: "", description: "", due_date: "" });

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const [{ data: s }, { data: a }, { data: l }, { data: t }] = await Promise.all([
      supabase.from("staff").select("id, name, phone").order("name"),
      supabase.from("attendance").select("*").order("clock_in", { ascending: false }).limit(100),
      supabase.from("leave_requests").select("*").order("created_at", { ascending: false }),
      supabase.from("staff_tasks").select("*").order("created_at", { ascending: false }),
    ]);
    setStaff((s as Staff[]) ?? []);
    setAttendance((a as AttendanceRow[]) ?? []);
    setLeave((l as LeaveRow[]) ?? []);
    setTasks((t as TaskRow[]) ?? []);
  }

  function staffName(id: string) {
    return staff.find((s) => s.id === id)?.name ?? "Unknown";
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
                <th>Clock In</th>
                <th>Clock Out</th>
              </tr>
            </thead>
            <tbody>
              {attendance.map((a) => (
                <tr key={a.id}>
                  <td className="font-medium">{staffName(a.staff_id)}</td>
                  <td>{new Date(a.clock_in).toLocaleString("en-IN")}</td>
                  <td>{a.clock_out ? new Date(a.clock_out).toLocaleString("en-IN") : "—"}</td>
                </tr>
              ))}
              {attendance.length === 0 && (
                <tr>
                  <td colSpan={3} className="py-8 text-center text-gray-400">No attendance records yet.</td>
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
