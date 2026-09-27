// Service worker for the Sai Communication admin/staff PWA.
//
// Strategy:
//  - Navigations (HTML): network-first, falling back to the cached shell when offline. This keeps a signed-in
//    staff member's session/app code current instead of ever serving a stale login screen.
//  - Hashed build assets (/assets/...): cache-first — their filename changes whenever the content does, so a
//    cached copy is always correct and this saves a network round trip on every load.
//  - The brand logo/icon files: cache-first too. They rarely change and a flaky mobile connection failing
//    to fetch them (leaving a blank circle in the header) is a real, recurring complaint — once one of
//    these has loaded successfully a single time, it is guaranteed to show on every load after that.
//  - Everything else (API calls, fonts): network passthrough, no caching — this app's data must always
//    be live (stock, sales, notifications), never served stale from a cache.
//
// __BUILD_ID__ is replaced with a fresh value on every build (see scripts/stamp-sw.mjs), so this file's
// bytes differ on every deploy even when no line here changed by hand. That is what makes the browser
// notice there is a new service worker at all: Chrome only re-checks sw.js occasionally and compares it
// byte-for-byte to decide whether anything changed — an unchanged sw.js means Chrome never installs the
// new one, so a tab can keep running OLD app code against an OLD cache indefinitely, well past the point
// a new version has actually deployed. A fresh CACHE_NAME every build guarantees Chrome always sees a
// change, runs through install → activate (dropping every older cache), and fires `controllerchange` —
// which main.tsx uses to reload that tab onto the new code automatically.
const CACHE_NAME = "sai-admin-shell-__BUILD_ID__";
const BRAND_ASSETS = ["/logo-mark.png", "/logo.png", "/favicon-192.png", "/favicon-32.png", "/apple-touch-icon.png"];
const SHELL_URLS = ["/", "/manifest.webmanifest", ...BRAND_ASSETS];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // never cache writes
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // leave Supabase/API/CDN calls alone

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put("/", copy));
          return res;
        })
        .catch(() => caches.match("/"))
    );
    return;
  }

  if (url.pathname.startsWith("/assets/") || BRAND_ASSETS.includes(url.pathname)) {
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        return res;
      }))
    );
  }
  // everything else: default network behaviour (no respondWith)
});

// Real OS-level push notifications (lock screen / notification shade), sent by api/send-push.js.
self.addEventListener("push", (event) => {
  let data = { title: "Sai Communication", body: "", link: "/" };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    /* not JSON — keep the defaults */
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/logo.png",
      badge: "/favicon-192.png",
      data: { link: data.link },
      tag: data.link, // a second notification for the same page replaces the first instead of stacking
      renotify: true, // ...but still alert (sound/vibrate/wake the lock screen) on that replacement —
      // without this, the Notification API's default for a tag replacement is a SILENT update, which is
      // why only the very first push for a given link ever lit up the lock screen and every push after it
      // (the vast majority in practice — the same staff member getting a second task, a third, etc., all
      // sharing the "/portal/tasks" tag) just swapped the tray entry with nothing shown on a locked phone.
      vibrate: [300, 100, 300, 100, 300], // Active vibration pattern — signals Android to treat this as an Alerting / High-Priority notification
      requireInteraction: true,           // Keeps the notification visible until user interacts with it
    })
  );
});

// Tapping the notification focuses an already-open tab on that page, or opens a new one.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = event.notification.data?.link || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (new URL(client.url).origin === self.location.origin) {
          client.navigate(link);
          return client.focus();
        }
      }
      return self.clients.openWindow(link);
    })
  );
});
