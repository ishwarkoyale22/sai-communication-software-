import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, CheckCircle2, XCircle, AlertCircle, CalendarClock, Megaphone, ListChecks, PartyPopper, UserCheck } from "lucide-react";
import { useStaffAuth } from "../context/StaffAuthContext";
import { supabase } from "../lib/supabase";

type NotificationType =
  | "task_assigned"
  | "report_approved"
  | "report_rejected"
  | "changes_required"
  | "follow_up_reminder"
  | "announcement"
  | "birthday_wish"
  | "leave_approved"
  | "leave_rejected"
  | "account_approved";

interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  link: string | null;
  is_read: boolean;
  // Whether the thing this notification is about is still unresolved — independent of is_read. See
  // notification_is_open() (migration 0061/0063). Drives the highlighting below, not is_read, so a
  // task/repair/follow-up notification stays visibly "open" until actually done, not just until tapped.
  is_open: boolean;
  created_at: string;
}

const ICON: Record<NotificationType, typeof Bell> = {
  task_assigned: ListChecks,
  report_approved: CheckCircle2,
  report_rejected: XCircle,
  changes_required: AlertCircle,
  follow_up_reminder: CalendarClock,
  announcement: Megaphone,
  birthday_wish: PartyPopper,
  leave_approved: CheckCircle2,
  leave_rejected: XCircle,
  account_approved: UserCheck,
};

export function Notifications() {
  const { token, staff, refreshNotifications } = useStaffAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  async function load(quiet = false) {
    if (!token) return;
    if (!quiet) setLoading(true);
    const { data } = await supabase.rpc("staff_get_notifications", { p_token: token });
    setItems((data as Notification[]) || []);
    setLoading(false);
  }

  useEffect(() => {
    load();

    const channel = supabase
      .channel("staff-notifications-page-realtime")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `staff_id=eq.${staff?.id}` },
        () => {
          load(true);
        }
      )
      .subscribe();

    function onVisible() {
      if (document.visibilityState === "visible") {
        load(true);
      }
    }
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);

    return () => {
      supabase.removeChannel(channel);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, staff?.id]);

  async function openNotification(n: Notification) {
    if (!n.is_read) {
      setItems((prev) => prev.map((i) => (i.id === n.id ? { ...i, is_read: true } : i)));
      await supabase.rpc("staff_mark_notification_read", { p_token: token, p_notification_id: n.id });
      await refreshNotifications();
    }
    if (n.link) navigate(n.link);
  }

  if (loading) return <div className="text-center text-sm text-gray-400">Loading…</div>;

  if (items.length === 0) {
    return <div className="card p-6 text-center text-sm text-gray-400">No notifications yet.</div>;
  }

  return (
    <div className="space-y-2">
      {items.map((n) => {
        const Icon = ICON[n.type] ?? Bell;
        return (
          <button
            key={n.id}
            onClick={() => openNotification(n)}
            className={`card flex w-full items-start gap-3 p-3 text-left ${n.is_open ? "border-l-2 border-brand-primary" : ""}`}
          >
            <div className="mt-0.5 shrink-0 text-brand-primary">
              <Icon size={18} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium text-gray-800">{n.title}</span>
                {n.is_open && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-primary" />}
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
