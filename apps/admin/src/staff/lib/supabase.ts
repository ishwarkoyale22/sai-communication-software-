// Staff-portal pages import from "../lib/supabase" (same relative path they
// used as a standalone app) — this re-exports the ONE shared Supabase
// client from apps/admin/src/lib/supabase.ts so staff and admin code never
// hold two separate client instances, plus the geolocation helper that
// only the staff attendance flow needs.
export { supabase } from "../../lib/supabase";

// "granted" | "denied" | "prompt" — or null where the Permissions API is unavailable (older iOS Safari).
export async function locationPermissionState(): Promise<PermissionState | null> {
  try {
    if (!navigator.permissions?.query) return null;
    return (await navigator.permissions.query({ name: "geolocation" as PermissionName })).state;
  } catch {
    return null;
  }
}

export type GeoResult = { lat: number | null; lng: number | null; reason?: "unsupported" | "insecure" | "denied" | "denied-os" | "in-app" | "unavailable" | "timeout" };

function tryPosition(options: PositionOptions): Promise<GeoResult> {
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) =>
        resolve({
          lat: null,
          lng: null,
          reason: err.code === 1 ? "denied" : err.code === 3 ? "timeout" : "unavailable",
        }),
      options
    );
  });
}

// GPS-accurate first; if that stalls (indoors / weak GPS) fall back to the
// network-based position instead of failing the login, and say WHY on failure.
export async function getGeolocation(): Promise<GeoResult> {
  if (!navigator.geolocation) return { lat: null, lng: null, reason: "unsupported" };
  if (!window.isSecureContext) return { lat: null, lng: null, reason: "insecure" };
  // Once blocked, the browser never asks again, so don't wait on a call that can only fail.
  if ((await locationPermissionState()) === "denied") return { lat: null, lng: null, reason: "denied" };
  // In-app browsers (WhatsApp/Instagram/Facebook links, Android WebView) refuse location without any prompt.
  if (/FBAN|FBAV|Instagram|WhatsApp|Line\/|; wv\)|Snapchat|Telegram/i.test(navigator.userAgent)) return { lat: null, lng: null, reason: "in-app" };
  const before = await locationPermissionState();
  const precise = await tryPosition({ enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  // The site was still askable ("prompt") yet was refused instantly: the phone itself is blocking Chrome.
  if (precise.reason === "denied" && before === "prompt") return { ...precise, reason: "denied-os" };
  if (precise.lat != null || precise.reason === "denied") return precise;
  return tryPosition({ enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 });
}
