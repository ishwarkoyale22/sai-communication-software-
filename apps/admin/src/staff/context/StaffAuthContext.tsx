import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Attendance } from "@sai/shared";
import { supabase, getGeolocation } from "../lib/supabase";

const STAFF_KEY = "sai_staff_session";
const TOKEN_KEY = "sai_staff_token";

export interface StaffLite {
  id: string;
  name: string;
  role: string;
  phone: string;
}

interface StaffAuthState {
  staff: StaffLite | null;
  token: string | null;
  openAttendance: Attendance | null;
  loading: boolean;
  loginWithPin: (phone: string, pin: string) => Promise<{ error?: string }>;
  clockOut: () => Promise<void>;
  signOut: () => void;
  refreshAttendance: () => Promise<void>;
}

const Ctx = createContext<StaffAuthState | null>(null);

export function StaffAuthProvider({ children }: { children: ReactNode }) {
  const [staff, setStaff] = useState<StaffLite | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [openAttendance, setOpenAttendance] = useState<Attendance | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const savedStaff = localStorage.getItem(STAFF_KEY);
    const savedToken = localStorage.getItem(TOKEN_KEY);
    if (savedStaff && savedToken) {
      try {
        const parsed: StaffLite = JSON.parse(savedStaff);
        if (parsed?.id) {
          setStaff(parsed);
          setToken(savedToken);
          refreshAttendanceFor(savedToken);
        }
      } catch {
        localStorage.removeItem(STAFF_KEY);
        localStorage.removeItem(TOKEN_KEY);
      }
    }
    setLoading(false);
  }, []);

  async function refreshAttendanceFor(tok: string) {
    const { data } = await supabase.rpc("staff_get_attendance", { p_token: tok });
    const open = (data as Attendance[] | null)?.find((a) => !a.clock_out) ?? null;
    setOpenAttendance(open);
  }

  async function refreshAttendance() {
    if (token) await refreshAttendanceFor(token);
  }

  async function loginWithPin(phone: string, pin: string) {
    const cleanPhone = phone.trim();
    const cleanPin = pin.trim();

    if (!cleanPhone || cleanPin.length !== 4) {
      return { error: "Please enter your 10-digit phone number and 4-digit PIN." };
    }

    try {
      // issue_staff_session re-verifies phone+PIN itself (never trusts the
      // client) and returns a server-issued session token — every
      // subsequent staff action RPC is gated by this token, not by any
      // frontend-only check.
      const { data: result, error: rpcErr } = await supabase.rpc("issue_staff_session", {
        p_phone: cleanPhone,
        p_pin: cleanPin,
      });

      if (rpcErr) {
        return { error: rpcErr.message };
      }
      if (!result?.success) {
        return { error: result?.error || "Invalid phone number or PIN. Please check with your store admin." };
      }

      const staffLite: StaffLite = result.staff;
      setStaff(staffLite);
      setToken(result.token);
      localStorage.setItem(STAFF_KEY, JSON.stringify(staffLite));
      localStorage.setItem(TOKEN_KEY, result.token);

      try {
        const { lat, lng } = await getGeolocation();
        await supabase.rpc("staff_clock_in", { p_token: result.token, p_lat: lat, p_lng: lng });
      } catch {
        // Geolocation denied/unavailable — clock in without coordinates.
        await supabase.rpc("staff_clock_in", { p_token: result.token });
      }

      await refreshAttendanceFor(result.token);
      return {};
    } catch (err: any) {
      return { error: err?.message || "Failed to sign in. Please try again." };
    }
  }

  async function clockOut() {
    if (!token) return;
    try {
      const { lat, lng } = await getGeolocation();
      await supabase.rpc("staff_clock_out", { p_token: token, p_lat: lat, p_lng: lng });
    } catch {
      await supabase.rpc("staff_clock_out", { p_token: token });
    }
    setOpenAttendance(null);
  }

  function signOut() {
    localStorage.removeItem(STAFF_KEY);
    localStorage.removeItem(TOKEN_KEY);
    setStaff(null);
    setToken(null);
    setOpenAttendance(null);
  }

  return (
    <Ctx.Provider value={{ staff, token, openAttendance, loading, loginWithPin, clockOut, signOut, refreshAttendance }}>
      {children}
    </Ctx.Provider>
  );
}

export function useStaffAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useStaffAuth must be used within StaffAuthProvider");
  return ctx;
}
