// Vercel serverless function — sends a real OS-level push notification to every device subscribed for
// the target (a specific staff member, or every admin device). Called by the `notify_push_on_insert`
// Postgres trigger (see supabase/migrations/0060_push_notifications.sql) right after any row is
// inserted into `notifications`, so this fires for every notification source already in the app —
// nothing else needed to change per notification type.
//
// This is the one place that holds the VAPID private key, which must never reach the browser — hence
// a server function rather than sending straight from client code.
import webpush from "web-push";

// Public by design (Supabase's anon key + RLS is the security boundary, same key already ships in the
// client bundle) — safe to have here directly, unlike the VAPID private key and the push secret below.
const SUPABASE_URL = "https://egzcesgamwghmddxnent.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_TlkAKqE1YolICBKvRYs2FA_pIaHSTs2";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  // Only the database trigger (which knows this secret) may call this endpoint.
  const secret = req.headers["x-push-secret"];
  if (!secret || secret !== process.env.PUSH_SECRET) return res.status(401).json({ error: "unauthorized" });

  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.error("[send-push] VAPID keys not configured");
    return res.status(500).json({ error: "push not configured" });
  }
  webpush.setVapidDetails(VAPID_SUBJECT || "mailto:admin@example.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  const { staff_id, for_admin, title, body, link } = req.body || {};
  if (!title) return res.status(400).json({ error: "title is required" });

  const filter = for_admin ? "for_admin=eq.true" : `staff_id=eq.${staff_id}`;
  const listRes = await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?${filter}&select=*`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
  });
  const subs = await listRes.json();
  if (!Array.isArray(subs) || subs.length === 0) return res.status(200).json({ sent: 0 });

  // "Admin: <title>" / "Staff: <title>" — so on a lock screen showing pushes from both portals side
  // by side (the same way an Instagram notification is prefixed with which account it's for), it is
  // obvious at a glance which one this is, before even opening it.
  const payload = JSON.stringify({
    title: `${for_admin ? "Admin" : "Staff"}: ${title}`,
    body: body || "",
    link: link || (for_admin ? "/" : "/portal"),
  });

  let sent = 0;
  const dead = [];
  await Promise.all(
    subs.map(async (s) => {
      try {
        // TTL/urgency were left at web-push's defaults (no Urgency header, TTL effectively low). Android
        // can defer or silently drop a normal-priority push to a device that's idle/in Doze — FCM never
        // reports this back, so the sender sees success regardless. Explicit "high" urgency plus a real
        // TTL is what tells FCM/Android this must wake the device and be delivered promptly, not
        // deprioritized — this was reproducibly the difference between a push landing immediately vs.
        // never landing at all despite every prior send here reporting success.
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
          { TTL: 60 * 60, urgency: "high" }
        );
        sent++;
      } catch (err) {
        // 404/410 = the browser/OS says this subscription is gone for good — stop trying it again.
        if (err && (err.statusCode === 404 || err.statusCode === 410)) dead.push(s.id);
        else console.error("[send-push] delivery failed:", err && err.message);
      }
    })
  );

  if (dead.length > 0) {
    await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?id=in.(${dead.join(",")})`, {
      method: "DELETE",
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    }).catch(() => undefined);
  }

  return res.status(200).json({ sent, removed: dead.length });
}
