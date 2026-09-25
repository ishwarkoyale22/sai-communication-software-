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
const inflight = new Map<string, Promise<Entry | null>>();
const MAX_AGE_MS = 10 * 60 * 1000;
const NAV_WINDOW_MS = 2000;
let navAt = 0;

export function markNavigation() {
  navAt = Date.now();
}

export function clearFetchCache() {
  cache.clear();
}

const isRest = (url: string) => url.includes("/rest/v1/");

function keyFor(url: string, headers: Headers) {
  return `${headers.get("authorization") ?? ""}|${url}`;
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

  if (method !== "GET") {
    const res = await fetch(input, init);
    cache.clear(); // any write makes every cached read potentially stale
    return res;
  }

  const headers = new Headers(init?.headers ?? (typeof input === "object" && "headers" in input ? input.headers : undefined));
  const key = keyFor(url, headers);
  const hit = cache.get(key);
  const fromNavigation = Date.now() - navAt < NAV_WINDOW_MS;

  if (hit && fromNavigation && Date.now() - hit.ts < MAX_AGE_MS) {
    // Serve instantly, refresh quietly.
    fetchAndStore(key, input, init).then((fresh) => {
      if (!fresh) return;
      const changed = fresh.body !== hit.body;
      cache.set(key, fresh);
      if (changed && typeof window !== "undefined") window.dispatchEvent(new CustomEvent("sai-data-refreshed"));
    });
    return toResponse(hit);
  }

  const fresh = await fetchAndStore(key, input, init);
  if (fresh) {
    cache.set(key, fresh);
    return toResponse(fresh);
  }
  return fetch(input, init); // error responses / network failures: behave exactly as before
};
