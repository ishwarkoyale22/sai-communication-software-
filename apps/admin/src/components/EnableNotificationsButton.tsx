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
    isPushSubscribed(target).then(setSubscribed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!pushSupported() || subscribed === null || subscribed) return null;

  async function handleClick() {
    setBusy(true);
    setMessage(null);
    // enablePushNotifications() already catches its own errors and resolves with { ok: false }, but a
    // second safety net here means a stray future rejection still clears `busy` and shows something,
    // instead of leaving the button stuck spinning forever with no explanation.
    try {
      const res = await enablePushNotifications(target);
      if (res.ok) setSubscribed(true);
      else setMessage(res.reason);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not turn on notifications on this device.");
    } finally {
      setBusy(false);
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
