import { supabase } from "./supabase";

// The VAPID *public* key — despite the name, this one is meant to be shipped to every browser (it is
// how the browser's push service knows which server is allowed to push to a subscription it creates).
// Only its private counterpart (held by api/send-push.js, via a Vercel environment variable) is secret.
const VAPID_PUBLIC_KEY = "BA5cNj7Ft7XvhiNEeAeEcp78k7THZFCBzOI_Q1xjc-tEMO4lK6-k_EYa-BgvHK94o-id1TkrbrHvpkSU1CvM4eA";

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export function pushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export type PushPermission = "default" | "granted" | "denied" | "unsupported";

export function pushPermission(): PushPermission {
  if (!pushSupported()) return "unsupported";
  return Notification.permission;
}

/** Target one device belongs to — a staff account, or the shared admin portal. */
export type PushTarget = { staffId: string } | { forAdmin: true };

/**
 * Asks for notification permission (must be called from a real click — browsers refuse it otherwise)
 * and, once granted, registers this device with the browser's push service and saves the subscription
 * so the server can find it later. Safe to call again on a device that is already subscribed — it just
 * confirms the existing subscription is still saved.
 */
export async function enablePushNotifications(target: PushTarget): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!pushSupported()) return { ok: false, reason: "This browser does not support push notifications." };

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return { ok: false, reason: permission === "denied" ? "Notifications are blocked for this site." : "Permission was not granted." };
  }

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as unknown as BufferSource,
    });
  }

  const json = sub.toJSON();
  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      staff_id: "staffId" in target ? target.staffId : null,
      for_admin: "forAdmin" in target,
      endpoint: sub.endpoint,
      p256dh: json.keys?.p256dh ?? "",
      auth: json.keys?.auth ?? "",
      user_agent: navigator.userAgent,
    },
    { onConflict: "endpoint" }
  );
  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}

/** Whether THIS device already has an active push subscription (independent of Notification.permission,
 * which can be "granted" while the subscription itself was never created or was later revoked). */
export async function isPushSubscribed(): Promise<boolean> {
  if (!pushSupported() || Notification.permission !== "granted") return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    return !!(await reg.pushManager.getSubscription());
  } catch {
    return false;
  }
}
