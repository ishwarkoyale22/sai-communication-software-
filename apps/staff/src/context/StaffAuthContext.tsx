import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import type { Staff, Attendance } from "@sai/shared";
import { supabase, getGeolocation } from "../lib/supabase";

const LOCAL_STORAGE_KEY = "sai_staff_session";

interface StaffAuthState {
  session: Session | null;
  staff: Staff | null;
  openAttendance: Attendance | null;
  loading: boolean;
  loginWithPin: (phone: string, pin: string) => Promise<{ error?: string }>;
  clockOut: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshAttendance: () => Promise<void>;
}

const Ctx = createContext<StaffAuthState | null>(null);

export function StaffAuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [staff, setStaff] = useState<Staff | null>(null);
  const [openAttendance, setOpenAttendance] = useState<Attendance | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 1. Check local cached staff session first
    const savedStaffStr = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (savedStaffStr) {
      try {
        const savedStaff: Staff = JSON.parse(savedStaffStr);
        if (savedStaff && savedStaff.id) {
          setStaff(savedStaff);
          refreshAttendanceFor(savedStaff.id);
        }
      } catch {
        localStorage.removeItem(LOCAL_STORAGE_KEY);
      }
    }

    // 2. Check Supabase Auth session
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session) {
        loadStaffFromAuth(data.session.user.id);
      } else if (!savedStaffStr) {
        setLoading(false);
      }
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_e, newSession) => {
      setSession(newSession);
      if (newSession) {
        loadStaffFromAuth(newSession.user.id);
      }
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  async function loadStaffFromAuth(userId: string) {
    try {
      const { data: profile } = await supabase.from("profiles").select("staff_id").eq("id", userId).maybeSingle();
      if (profile?.staff_id) {
        const { data: s } = await supabase.from("staff").select("*").eq("id", profile.staff_id).maybeSingle();
        if (s) {
          setStaff(s);
          localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(s));
          await refreshAttendanceFor(s.id);
        }
      }
    } finally {
      setLoading(false);
    }
  }

  async function refreshAttendanceFor(staffId: string) {
    try {
      const { data } = await supabase
        .from("attendance")
        .select("*")
        .eq("staff_id", staffId)
        .is("clock_out", null)
        .order("clock_in", { ascending: false })
        .limit(1)
        .maybeSingle();
      setOpenAttendance(data ?? null);
    } finally {
      setLoading(false);
    }
  }

  async function refreshAttendance() {
    if (staff) await refreshAttendanceFor(staff.id);
  }

  async function loginWithPin(phone: string, pin: string) {
    const cleanPhone = phone.trim();
    const cleanPin = pin.trim();

    if (!cleanPhone || cleanPin.length !== 4) {
      return { error: "Please enter your 10-digit phone number and 4-digit PIN." };
    }

    try {
      // 1. Validate phone+PIN via the staff_login RPC (SECURITY DEFINER —
      // checks credentials server-side without needing an anonymous SELECT
      // policy on `staff`; the table itself stays non-browsable).
      const { data: rpcRows } = await supabase.rpc("staff_login", {
        p_phone: cleanPhone,
        p_pin: cleanPin,
      });
      const rpcMatch = rpcRows?.[0] ?? null;
      // The RPC returns only the fields needed to authenticate (id, name,
      // role, phone, is_active) — fill the rest of the Staff shape with the
      // same placeholders the local-fallback path below already uses.
      const staffMatch: Staff | null = rpcMatch
        ? { ...rpcMatch, pin: cleanPin, auth_user_id: null, created_at: new Date().toISOString() }
        : null;

      if (staffMatch) {
        setStaff(staffMatch);
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(staffMatch));

        try {
          const { lat, lng } = await getGeolocation();
          await supabase.from("attendance").insert({
            staff_id: staffMatch.id,
            clock_in_lat: lat,
            clock_in_lng: lng,
          });
        } catch {
          /* ignore */
        }

        await refreshAttendanceFor(staffMatch.id);

        const email = `${cleanPhone}@staff.internal`;
        supabase.auth.signInWithPassword({ email, password: cleanPin }).catch(() => {});

        return {};
      }

      // 2. Check local synchronized staff list (for seamless local store fallback)
      try {
        const localListRaw = localStorage.getItem("sai_local_staff");
        if (localListRaw) {
          const localList: Staff[] = JSON.parse(localListRaw);
          const localMatch = localList.find(
            (s) => s.phone === cleanPhone && s.pin === cleanPin && s.is_active
          );
          if (localMatch) {
            setStaff(localMatch);
            localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(localMatch));
            try {
              const { lat, lng } = await getGeolocation();
              await supabase.from("attendance").insert({
                staff_id: localMatch.id,
                clock_in_lat: lat,
                clock_in_lng: lng,
              });
            } catch {
              /* ignore */
            }
            await refreshAttendanceFor(localMatch.id);
            return {};
          }
        }
      } catch {
        /* ignore */
      }

      // 2. Try Supabase Auth sign-in
      const email = `${cleanPhone}@staff.internal`;
      const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({
        email,
        password: cleanPin,
      });

      if (!authErr && authData.user) {
        await loadStaffFromAuth(authData.user.id);
        const { lat, lng } = await getGeolocation();
        const { data: prof } = await supabase.from("profiles").select("staff_id").eq("id", authData.user.id).single();
        if (prof?.staff_id) {
          await supabase.from("attendance").insert({
            staff_id: prof.staff_id,
            clock_in_lat: lat,
            clock_in_lng: lng,
          });
          await refreshAttendanceFor(prof.staff_id);
        }
        return {};
      }

      return { error: "Invalid phone number or PIN. Please check with your store admin." };
    } catch (err: any) {
      return { error: err?.message || "Failed to sign in. Please try again." };
    }
  }

  async function clockOut() {
    if (!openAttendance) return;
    const { lat, lng } = await getGeolocation();
    await supabase
      .from("attendance")
      .update({
        clock_out: new Date().toISOString(),
        clock_out_lat: lat,
        clock_out_lng: lng,
      })
      .eq("id", openAttendance.id);
    setOpenAttendance(null);
  }

  async function signOut() {
    localStorage.removeItem(LOCAL_STORAGE_KEY);
    setStaff(null);
    setOpenAttendance(null);
    await supabase.auth.signOut();
  }

  return (
    <Ctx.Provider
      value={{
        session,
        staff,
        openAttendance,
        loading,
        loginWithPin,
        clockOut,
        signOut,
        refreshAttendance,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useStaffAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useStaffAuth must be used within StaffAuthProvider");
  return ctx;
}
