import { useEffect, useState } from "react";
import { useStaffAuth } from "../context/StaffAuthContext";
import { supabase } from "../lib/supabase";

interface Task {
  id: string;
  title: string;
  description: string | null;
  status: "pending" | "in_progress" | "completed";
  due_date: string | null;
  created_at: string;
}

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-gray-100 text-gray-600",
  in_progress: "bg-amber-50 text-amber-700",
  completed: "bg-emerald-50 text-emerald-700",
};

export function TasksPage() {
  const { token } = useStaffAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, [token]);

  async function load() {
    if (!token) return;
    setLoading(true);
    const { data } = await supabase.rpc("staff_get_tasks", { p_token: token });
    setTasks((data as Task[]) ?? []);
    setLoading(false);
  }

  async function updateStatus(taskId: string, status: string) {
    if (!token) return;
    setUpdatingId(taskId);
    await supabase.rpc("staff_update_task_status", { p_token: token, p_task_id: taskId, p_status: status });
    await load();
    setUpdatingId(null);
  }

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-gray-800">My Tasks</h1>

      <div className="card divide-y divide-border">
        {loading ? (
          <div className="p-6 text-center text-sm text-gray-400">Loading…</div>
        ) : tasks.length === 0 ? (
          <div className="p-6 text-center text-sm text-gray-400">No tasks assigned to you yet.</div>
        ) : (
          tasks.map((t) => (
            <div key={t.id} className="space-y-1.5 p-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium text-gray-800">{t.title}</div>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${STATUS_STYLE[t.status]}`}>
                  {t.status.replace("_", " ")}
                </span>
              </div>
              {t.description && <p className="text-xs text-gray-600">{t.description}</p>}
              {t.due_date && <p className="text-xs text-gray-400">Due: {new Date(t.due_date).toLocaleDateString("en-IN")}</p>}
              <select
                className="input mt-1 !py-1 text-xs"
                value={t.status}
                disabled={updatingId === t.id}
                onChange={(e) => updateStatus(t.id, e.target.value)}
              >
                <option value="pending">Pending</option>
                <option value="in_progress">In Progress</option>
                <option value="completed">Completed</option>
              </select>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
