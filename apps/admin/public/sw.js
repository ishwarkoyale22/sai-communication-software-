// Service worker for the Sai Communication admin/staff PWA.
//
// Strategy:
//  - Navigations (HTML): network-first, falling back to the cached shell when offline. This keeps a signed-in
//    staff member's session/app code current instead of ever serving a stale login screen.
//  - Hashed build assets (/assets/...): cache-first — their filename changes whenever the content does, so a
//    cached copy is always correct and this saves a network round trip on every load.
//  - Everything else (API calls, images, fonts): network passthrough, no caching — this app's data must always
//    be live (stock, sales, notifications), never served stale from a cache.
//
// Bumping CACHE_NAME (done by publish.mjs on every deploy) forces old caches to be dropped on activate, so a
// deploy is never stuck behind a stale cached shell.
const CACHE_NAME = "sai-admin-shell-v1";
const SHELL_URLS = ["/", "/manifest.webmanifest"];

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

  if (url.pathname.startsWith("/assets/")) {
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
