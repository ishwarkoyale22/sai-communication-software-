import { useEffect, useState } from "react";
import { BellRing, BellPlus } from "lucide-react";
import { enablePushNotifications, isPushSubscribed, pushSupported, type PushTarget } from "../lib/pushNotifications";

/**
 * One tap to turn on real, OS-level push notifications (lock screen / notification shade) for this
 * device — for a specific staff member, or for the shared admin portal. Hides itself once this exact
 * device is already subscribed, and hides entirely on a browser that can't do push at all (this is the
 * one thing that must be a real tap: browsers refuse to even ask for permission without one).
 */
export function EnableNotificationsButton({ target }: { target: PushTarget }) {
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    isPushSubscribed().then(setSubscribed);
  }, []);

  if (!pushSupported() || subscribed === null || subscribed) return null;

  async function handleClick() {
    setBusy(true);
    setMessage(null);
    const res = await enablePushNotifications(target);
    setBusy(false);
    if (res.ok) {
      setSubscribed(true);
    } else {
      setMessage(res.reason);
    }
  }

  return (
    <div className="relative">
      <button
        onClick={handleClick}
        disabled={busy}
        className="flex items-center gap-1.5 rounded-lg border border-brand-primary/30 bg-brand-primary/5 px-2.5 py-1.5 text-xs font-semibold text-brand-primary transition-colors hover:bg-brand-primary/10 disabled:opacity-60"
        title="Turn on notifications for this device"
      >
        {busy ? <BellRing size={13} className="animate-pulse" /> : <BellPlus size={13} />}
        <span className="hidden sm:inline">Notifications</span>
      </button>
      {message && (
        <div className="absolute right-0 top-full z-50 mt-1 w-56 rounded-md border border-border bg-white p-2 text-[11px] text-gray-600 shadow-lg">
          {message}
        </div>
      )}
    </div>
  );
}
