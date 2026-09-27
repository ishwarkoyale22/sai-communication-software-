import { supabase } from "./supabase";

// The VAPID *public* key — despite the name, this one is meant to be shipped to every browser (it is
// how the browser's push service knows which server is allowed to push to a subscription it creates).
// Only its private counterpart (held by api/send-push.js, via a Vercel environment variable) is secret.
//
// Rotated 2026-09-27: the original key baked into the app never had a matching VAPID_PRIVATE_KEY set on
// Vercel, so every push silently 401'd from day one (see api/send-push.js). This is the new key's public
// half; any subscription saved under the old key is now permanently unusable and must be recreated —
// see the mismatch check in enablePushNotifications() below, which does that automatically.
const VAPID_PUBLIC_KEY = "BNAmDdWtsVX7Ntu_xBdHmP1ltruwA1HipkXe2XSl4ni6KU5XH5x_uiQ30oCdGegHsrgQTiG0RtraV3zwc5ZkO-E";

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function uint8ArrayToUrlBase64(bytes: ArrayBuffer | null): string {
  if (!bytes) return "";
  let str = "";
  for (const b of new Uint8Array(bytes)) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
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
  // A subscription created under a since-rotated VAPID key can never be delivered to again — the push
  // service itself rejects it. Drop it and subscribe fresh under the current key instead of silently
  // keeping a dead subscription around.
  if (sub && uint8ArrayToUrlBase64(sub.options.applicationServerKey) !== VAPID_PUBLIC_KEY) {
    await sub.unsubscribe();
    sub = null;
  }
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
    const sub = await reg.pushManager.getSubscription();
    return !!sub && uint8ArrayToUrlBase64(sub.options.applicationServerKey) === VAPID_PUBLIC_KEY;
  } catch {
    return false;
  }
}
