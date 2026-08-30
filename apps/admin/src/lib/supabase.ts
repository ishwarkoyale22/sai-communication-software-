import { createSupabaseClient } from "@sai/shared";

export const supabase = createSupabaseClient(
  import.meta.env.VITE_SUPABASE_URL as string,
  import.meta.env.VITE_SUPABASE_ANON_KEY as string
);

export const SHOP = {
  name: (import.meta.env.VITE_SHOP_NAME as string) || "Sai Communication",
  address: (import.meta.env.VITE_SHOP_ADDRESS as string) || "",
  phone: (import.meta.env.VITE_SHOP_PHONE as string) || "",
  gstNumber: import.meta.env.VITE_SHOP_GSTIN as string | undefined,
};
