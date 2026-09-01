import { createSupabaseClient } from "@sai/shared";

const SUPABASE_URL =
  (import.meta.env.VITE_SUPABASE_URL as string) ||
  "https://egzcesgamwghmddxnent.supabase.co";

const SUPABASE_ANON_KEY =
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string) ||
  "sb_publishable_TlkAKqE1YolICBKvRYs2FA_pIaHSTs2";

export const supabase = createSupabaseClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export const SHOP = {
  name: (import.meta.env.VITE_SHOP_NAME as string) || "Sai Communication",
  address: (import.meta.env.VITE_SHOP_ADDRESS as string) || "",
  phone: (import.meta.env.VITE_SHOP_PHONE as string) || "",
  gstNumber: import.meta.env.VITE_SHOP_GSTIN as string | undefined,
};

