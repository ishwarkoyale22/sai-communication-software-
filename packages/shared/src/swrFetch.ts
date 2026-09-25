/**
 * Stale-while-revalidate fetch for PostgREST reads.
 *
 * Problem: every admin page fetched its data from scratch on each visit, so going
 * Inventory → Sales → Inventory showed a spinner again each time.
 *
 * How it works:
 *  - Only GET requests to /rest/v1/ are cached (mutations and RPC POSTs never are).
 *  - A GET issued right after a page change (markNavigation) that we've already seen
 *    is answered instantly from memory while a fresh copy is fetched in the
 *    background. If the fresh copy differs, "sai-data-refreshed" is dispatched so the
 *    layout can re-render the page with it.
 *  - Reads issued any other time (realtime reloads, button clicks) always hit the
 *    network, so live updates are never served stale.
 *  - Any write (POST/PATCH/PUT/DELETE) to the REST API, and sign-out, clears the cache.
 */
type Entry = { body: string; status: number; statusText: string; headers: [string, string][]; ts: number };

const cache = new Map<string, Entry>();

// ---- Persistence (IndexedDB) -------------------------------------------------
// So the FIRST visit to a page after a reload / next morning is also instant: last
// session's data is shown immediately and refreshed quietly. Wiped on sign-out.
const DB_NAME = "sai-read-cache";
const STORE = "entries";
const MAX_PERSIST_AGE_MS = 7 * 24 * 60 * 60 * 1000;
let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

let hydrated: Promise<void> | null = null;
function hydrate(): Promise<void> {
  if (hydrated) return hydrated;
  hydrated = (async () => {
    const db = await openDb();
    if (!db) return;
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE, "readonly");
        const cur = tx.objectStore(STORE).openCursor();
        cur.onsuccess = () => {
          const c = cur.result;
          if (!c) return resolve();
          const e = c.value as Entry;
          if (Date.now() - e.ts < MAX_PERSIST_AGE_MS && !cache.has(c.key as string)) cache.set(c.key as string, e);
          c.continue();
        };
        cur.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  })();
  return hydrated;
}

async function persist(key: string, e: Entry) {
  const db = await openDb();
  if (!db) return;
  try {
    db.transaction(STORE, "readwrite").objectStore(STORE).put(e, key);
  } catch {
    /* quota or private mode: the in-memory cache still works */
  }
}

async function wipePersisted() {
  const db = await openDb();
  if (!db) return;
  try {
    db.transaction(STORE, "readwrite").objectStore(STORE).clear();
  } catch {
    /* ignore */
  }
}
const inflight = new Map<string, Promise<Entry | null>>();
const MAX_AGE_MS = 10 * 60 * 1000;
const NAV_WINDOW_MS = 2000;
let navAt = Date.now(); // the initial page load counts as a navigation

export function markNavigation() {
  navAt = Date.now();
}

export function clearFetchCache() {
  cache.clear();
}

/** Sign-out: forget everything, including what was saved on this device. */
export function wipeFetchCache() {
  cache.clear();
  wipePersisted();
}

const isRest = (url: string) => url.includes("/rest/v1/");

// Key by WHO is asking (JWT "sub"), not the raw token: the token is re-issued hourly and
// would otherwise empty the cache every time.
function keyFor(url: string, headers: Headers) {
  const auth = headers.get("authorization") ?? "";
  let who = "anon";
  try {
    const payload = auth.split(".")[1];
    if (payload) who = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))).sub ?? "anon";
  } catch {
    /* not a JWT (publishable key) */
  }
  return `${who}|${url}`;
}

function toResponse(e: Entry) {
  return new Response(e.body, { status: e.status, statusText: e.statusText, headers: e.headers });
}

async function fetchAndStore(key: string, input: RequestInfo | URL, init?: RequestInit): Promise<Entry | null> {
  const existing = inflight.get(key);
  if (existing) return existing;
  const p = (async () => {
    try {
      const res = await fetch(input, init);
      if (!res.ok) return null;
      const entry: Entry = {
        body: await res.text(),
        status: res.status,
        statusText: res.statusText,
        headers: [...res.headers.entries()],
        ts: Date.now(),
      };
      return entry;
    } catch {
      return null;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

export const swrFetch: typeof fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const method = (init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET")).toUpperCase();

  if (!isRest(url)) return fetch(input, init);

  if (method === "HEAD") return fetch(input, init); // count-only reads: not cached, not a write

  // Staff portal reads are POSTed RPC calls named staff_get_* (read-only). Treat them like GETs,
  // keyed by their arguments (which include the session token).
  const isReadRpc = method === "POST" && /\/rest\/v1\/rpc\/staff_get_/.test(url) && typeof init?.body === "string";

  if (method !== "GET" && !isReadRpc) {
    const res = await fetch(input, init);
    wipeFetchCache(); // any write makes every cached read potentially stale
    return res;
  }

  const headers = new Headers(init?.headers ?? (typeof input === "object" && "headers" in input ? input.headers : undefined));
  const key = keyFor(url, headers) + (isReadRpc ? `|${init!.body as string}` : "");
  await Promise.race([hydrate(), new Promise((r) => setTimeout(r, 400))]);
  const hit = cache.get(key);
  const fromNavigation = Date.now() - navAt < NAV_WINDOW_MS;

  if (hit && fromNavigation && Date.now() - hit.ts < MAX_AGE_MS) {
    // Serve instantly, refresh quietly.
    fetchAndStore(key, input, init).then((fresh) => {
      if (!fresh) return;
      const changed = fresh.body !== hit.body;
      cache.set(key, fresh);
      persist(key, fresh);
      if (changed && typeof window !== "undefined") window.dispatchEvent(new CustomEvent("sai-data-refreshed"));
    });
    return toResponse(hit);
  }

  const fresh = await fetchAndStore(key, input, init);
  if (fresh) {
    cache.set(key, fresh);
    persist(key, fresh);
    return toResponse(fresh);
  }
  return fetch(input, init); // error responses / network failures: behave exactly as before
};
