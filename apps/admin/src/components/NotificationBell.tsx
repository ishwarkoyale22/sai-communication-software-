import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell } from "lucide-react";
import { supabase } from "../lib/supabase";

interface AdminNotification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  is_read: boolean;
  created_at: string;
}

export function NotificationBell() {
  const [items, setItems] = useState<AdminNotification[]>([]);
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    load();
    const channel = supabase
      .channel("admin-notifications")
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: "for_admin=eq.true" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  async function load() {
    const { data } = await supabase
      .from("notifications")
      .select("id, type, title, body, link, is_read, created_at")
      .eq("for_admin", true)
      .order("created_at", { ascending: false })
      .limit(30);
    setItems((data as AdminNotification[]) ?? []);
  }

  const unreadCount = items.filter((n) => !n.is_read).length;

  async function openNotification(n: AdminNotification) {
    if (!n.is_read) {
      setItems((prev) => prev.map((i) => (i.id === n.id ? { ...i, is_read: true } : i)));
      await supabase.from("notifications").update({ is_read: true }).eq("id", n.id);
    }
    setOpen(false);
    if (n.link) navigate(n.link);
  }

  return (
    <div className="relative" ref={boxRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative flex h-8 w-8 items-center justify-center rounded-full text-gray-500 hover:bg-accent hover:text-brand-primary"
        aria-label="Notifications"
      >
        <Bell size={17} />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-danger px-1 text-[10px] font-semibold text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-10 z-50 max-h-96 w-80 overflow-y-auto rounded-lg border border-border bg-card shadow-cardHover">
          <div className="border-b border-border p-3 text-xs font-semibold uppercase text-gray-400">Notifications</div>
          {items.length === 0 ? (
            <div className="p-6 text-center text-sm text-gray-400">No notifications yet.</div>
          ) : (
            items.map((n) => (
              <button
                key={n.id}
                onClick={() => openNotification(n)}
                className={`flex w-full flex-col gap-0.5 border-b border-border p-3 text-left text-sm last:border-b-0 hover:bg-accent ${
                  !n.is_read ? "bg-brand-primary/5" : ""
                }`}
              >
                <div className="flex items-center gap-1.5">
                  {!n.is_read && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-primary" />}
                  <span className="truncate font-medium text-gray-800">{n.title}</span>
                </div>
                {n.body && <span className="truncate text-xs text-gray-500">{n.body}</span>}
                <span className="text-[11px] text-gray-400">{new Date(n.created_at).toLocaleString("en-IN")}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
