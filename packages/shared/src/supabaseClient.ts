import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * One Supabase client factory shared by all three apps (admin / staff / web).
 * Each app supplies its own env vars (Vite: import.meta.env.*, Next.js:
 * process.env.NEXT_PUBLIC_*) and calls this once at startup.
 */
export function createSupabaseClient(url: string, anonKey: string): SupabaseClient {
  if (!url || !anonKey) {
    throw new Error(
      "Missing Supabase URL/anon key. Set them in your app's .env file (see .env.example)."
    );
  }
  return createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
  });
}
