import { useEffect, useState } from "react";
import { Bell, CheckCircle2, XCircle, AlertCircle, CalendarClock, Megaphone, ListChecks } from "lucide-react";
import { useStaffAuth } from "../context/StaffAuthContext";
import { supabase } from "../lib/supabase";

interface Notification {
  id: string;
  type: "task_assigned" | "report_approved" | "report_rejected" | "changes_required" | "follow_up_reminder" | "announcement";
  title: string;
  body: string | null;
  is_read: boolean;
  created_at: string;
}

const ICON: Record<Notification["type"], typeof Bell> = {
  task_assigned: ListChecks,
  report_approved: CheckCircle2,
  report_rejected: XCircle,
  changes_required: AlertCircle,
  follow_up_reminder: CalendarClock,
  announcement: Megaphone,
};

export function Notifications() {
  const { token } = useStaffAuth();
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    if (!token) return;
    const { data } = await supabase.rpc("staff_get_notifications", { p_token: token });
    setItems((data as Notification[]) || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function markRead(id: string) {
    if (!token) return;
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
    await supabase.rpc("staff_mark_notification_read", { p_token: token, p_notification_id: id });
  }

  if (loading) return <div className="text-center text-sm text-gray-400">Loading…</div>;

  if (items.length === 0) {
    return <div className="card p-6 text-center text-sm text-gray-400">No notifications yet.</div>;
  }

  return (
    <div className="space-y-2">
      {items.map((n) => {
        const Icon = ICON[n.type];
        return (
          <button
            key={n.id}
            onClick={() => !n.is_read && markRead(n.id)}
            className={`card flex w-full items-start gap-3 p-3 text-left ${!n.is_read ? "border-l-2 border-brand-primary" : ""}`}
          >
            <div className="mt-0.5 shrink-0 text-brand-primary">
              <Icon size={18} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium text-gray-800">{n.title}</span>
                {!n.is_read && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-primary" />}
              </div>
              {n.body && <div className="mt-0.5 truncate text-xs text-gray-500">{n.body}</div>}
              <div className="mt-1 text-[11px] text-gray-400">{new Date(n.created_at).toLocaleString("en-IN")}</div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
