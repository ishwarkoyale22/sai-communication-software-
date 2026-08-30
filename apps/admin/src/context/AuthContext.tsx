import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";

interface AuthState {
  session: Session | null;
  loading: boolean;
  isAdmin: boolean;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session) {
        checkAdmin(data.session.user.id);
      } else {
        setLoading(false);
      }
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      if (newSession) {
        checkAdmin(newSession.user.id);
      } else {
        setIsAdmin(false);
        setLoading(false);
      }
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  async function checkAdmin(userId: string) {
    // Admin status is decided ONLY by profiles.role — no email-pattern
    // guessing, no auto-granting on missing/error. A prior version of this
    // function granted admin to any account whose email didn't end in
    // "@staff.internal" (including on network errors), which made every
    // non-staff login an admin login. That was a real security hole; this
    // is the correct, minimal check.
    const { data } = await supabase.from("profiles").select("role").eq("id", userId).maybeSingle();
    setIsAdmin(data?.role === "admin");
    setLoading(false);
  }

  async function signIn(email: string, password: string) {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) {
        return { error: error.message };
      }
      if (data.user) {
        await checkAdmin(data.user.id);
      }
      return {};
    } catch (err: any) {
      return { error: err?.message || "An unexpected error occurred during sign in." };
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    setSession(null);
    setIsAdmin(false);
    // Hard redirect to /login rather than relying on React state: the
    // checkAdmin() logic can otherwise re-flip isAdmin back to true for any
    // non-staff email, which made sign-out appear to do nothing. A full
    // navigation guarantees a clean, unauthenticated app state.
    window.location.href = "/login";
  }

  return (
    <AuthContext.Provider value={{ session, loading, isAdmin, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
