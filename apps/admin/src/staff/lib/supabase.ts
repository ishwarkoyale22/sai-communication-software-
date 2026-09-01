// Staff-portal pages import from "../lib/supabase" (same relative path they
// used as a standalone app) — this re-exports the ONE shared Supabase
// client from apps/admin/src/lib/supabase.ts so staff and admin code never
// hold two separate client instances, plus the geolocation helper that
// only the staff attendance flow needs.
export { supabase } from "../../lib/supabase";

export function getGeolocation(): Promise<{ lat: number | null; lng: number | null }> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve({ lat: null, lng: null });
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve({ lat: null, lng: null }),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  });
}
