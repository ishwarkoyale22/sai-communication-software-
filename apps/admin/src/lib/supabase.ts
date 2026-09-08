import { createSupabaseClient } from "@sai/shared";

const SUPABASE_URL =
  (import.meta.env.VITE_SUPABASE_URL as string) ||
  "https://egzcesgamwghmddxnent.supabase.co";

const SUPABASE_ANON_KEY =
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string) ||
  "sb_publishable_TlkAKqE1YolICBKvRYs2FA_pIaHSTs2";

export const supabase = createSupabaseClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Defaults below are the shop's real details, transcribed directly from an
// actual printed Tax Invoice (not placeholders) — so the GST Tax Invoice
// prints correctly out of the box even before any VITE_SHOP_* env var is
// configured. Every field is still overridable via its env var.
export const SHOP = {
  name: (import.meta.env.VITE_SHOP_NAME as string) || "Sai Communication SC",
  address:
    (import.meta.env.VITE_SHOP_ADDRESS as string) ||
    "Shop No.30, P L Khandge Plaza, Talegaon Chakan Road, Talegaon Station, Tal-Maval",
  phone: (import.meta.env.VITE_SHOP_PHONE as string) || "9822662266",
  gstNumber: (import.meta.env.VITE_SHOP_GSTIN as string) || "27APCPG901SL1ZS",
  email: (import.meta.env.VITE_SHOP_EMAIL as string) || "saicommunication2266@gmail.com",
  // Used on the GST Tax Invoice's "State: <code>-<name>" line — 27 is
  // Maharashtra's actual GST state code, matching this shop's real
  // Talegaon (Maharashtra) address, not a placeholder.
  state: (import.meta.env.VITE_SHOP_STATE as string) || "27-Maharashtra",
};

