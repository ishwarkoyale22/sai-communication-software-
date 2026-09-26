import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Attendance } from "@sai/shared";
import { supabase, getGeolocation } from "../lib/supabase";
import { wipeFetchCache } from "@sai/shared";

const STAFF_KEY = "sai_staff_session";
const TOKEN_KEY = "sai_staff_token";

// Which portal section a notification belongs to (for per-tile badges).
const TYPE_SECTION: Record<string, string> = {
  task_assigned: "/portal/tasks",
  follow_up_reminder: "/portal/follow-ups",
  leave_approved: "/portal/leave",
  leave_rejected: "/portal/leave",
  leave_submitted: "/portal/leave",
  report_approved: "/portal/reports",
  report_rejected: "/portal/reports",
  changes_required: "/portal/reports",
  enquiry_new: "/portal/enquiries",
  review_new: "/portal/reviews",
  repair_assigned: "/portal/repairs",
  repair_completed: "/portal/repairs",
  repair_request_new: "/portal/repairs",
  website_order_new: "/portal/orders",
  product_sold: "/portal/sales-history",
  finance_status_update: "/portal/finance-reports",
  finance_report_uploaded: "/portal/finance-reports",
  finance_application_new: "/portal/finance-reports",
};
function sectionFor(type: string, link: string | null): string | null {
  return TYPE_SECTION[type] ?? (link && link.startsWith("/portal/") ? link.split("?")[0] : null);
}

export interface StaffLite {
  id: string;
  name: string;
  role: string;
  phone: string;
}

/** Where a staff member lands after login — the 3 new role portals share the
 * one Staff Portal shell/layout, just with role-specific nav content, so this
 * only needs to pick a landing route, not a separate app. Anything outside
 * the 3 new roles (legacy 'staff'/'cashier' accounts) keeps the original
 * generic portal — no forced migration of existing accounts. */
export function portalPathForRole(role?: string | null): string {
  if (role === "technician") return "/portal/technician";
  if (role === "sales") return "/portal/sales";
  if (role === "receptionist") return "/portal/reception";
  return "/portal";
}

export interface BirthdayEntry {
  id: string;
  name: string;
  is_self: boolean;
  already_wished?: boolean;
}

interface StaffAuthState {
  staff: StaffLite | null;
  token: string | null;
  openAttendance: Attendance | null;
  todaysBirthdays: BirthdayEntry[];
  unreadNotifications: number;
  unreadBySection: Record<string, number>;
  loading: boolean;
  loginWithPin: (phone: string, pin: string, expectedRole?: string) => Promise<{ error?: string; staff?: StaffLite }>;
  updateStaffName: (name: string) => void;
  clockIn: () => Promise<{ error?: string }>;
  clockOut: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshAttendance: () => Promise<void>;
  sendBirthdayWish: (toStaffId: string) => Promise<void>;
  refreshNotifications: () => Promise<void>;
}

const Ctx = createContext<StaffAuthState | null>(null);

export function StaffAuthProvider({ children }: { children: ReactNode }) {
  const [staff, setStaff] = useState<StaffLite | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [openAttendance, setOpenAttendance] = useState<Attendance | null>(null);
  const [todaysBirthdays, setTodaysBirthdays] = useState<BirthdayEntry[]>([]);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [unreadBySection, setUnreadBySection] = useState<Record<string, number>>({});
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
          refreshBirthdaysFor(savedToken);
          refreshNotificationsFor(savedToken);
        }
      } catch {
        localStorage.removeItem(STAFF_KEY);
        localStorage.removeItem(TOKEN_KEY);
      }
    }
    setLoading(false);
  }, []);

  // Live badge updates — a task/leave-decision/report-status/birthday-wish
  // notification landing while the app is open should bump the badge right
  // away, not just after the next login or a manual page visit.
  useEffect(() => {
    if (!staff || !token) return;
    const channel = supabase
      .channel("staff-notifications-badge")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `staff_id=eq.${staff.id}` }, () =>
        refreshNotificationsFor(token)
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staff?.id, token]);

  // Keep the session honest and the badge/birthday banner current while the app stays open
  // (e.g. left open overnight: the birthday banner must roll over at midnight).
  useEffect(() => {
    if (!token) return;
    const timer = setInterval(() => {
      refreshNotificationsFor(token);
      refreshBirthdaysFor(token);
    }, 60000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function refreshAttendanceFor(tok: string) {
    const { data } = await supabase.rpc("staff_get_attendance", { p_token: tok });
    const open = (data as Attendance[] | null)?.find((a) => !a.clock_out) ?? null;
    setOpenAttendance(open);
  }

  async function refreshAttendance() {
    if (token) await refreshAttendanceFor(token);
  }

  async function refreshBirthdaysFor(tok: string) {
    const { data } = await supabase.rpc("staff_get_birthdays_today", { p_token: tok });
    setTodaysBirthdays((data as BirthdayEntry[]) ?? []);
  }

  async function sendBirthdayWish(toStaffId: string) {
    if (!token) return;
    // Mark as wished straight away (the server also refuses a second wish the same day).
    setTodaysBirthdays((prev) => prev.map((b) => (b.id === toStaffId ? { ...b, already_wished: true } : b)));
    const { error } = await supabase.rpc("staff_send_birthday_wish", { p_token: token, p_to_staff_id: toStaffId });
    if (error) setTodaysBirthdays((prev) => prev.map((b) => (b.id === toStaffId ? { ...b, already_wished: false } : b)));
  }


  // The server session ran out (or an admin deactivated the account). Without this the
  // portal stayed open showing empty lists while every action silently failed.
  function endExpiredSession() {
    wipeFetchCache();
    localStorage.removeItem(STAFF_KEY);
    localStorage.removeItem(TOKEN_KEY);
    setStaff(null);
    setToken(null);
    setOpenAttendance(null);
    setTodaysBirthdays([]);
    setUnreadNotifications(0);
  }

  async function refreshNotificationsFor(tok: string) {
    const { data, error } = await supabase.rpc("staff_get_notifications", { p_token: tok });
    if (error && /invalid or expired/i.test(error.message)) {
      endExpiredSession();
      return;
    }
    const unread = ((data as { is_read: boolean; type: string; link: string | null }[]) ?? []).filter((n) => !n.is_read);
    setUnreadNotifications(unread.length);
    const by: Record<string, number> = {};
    for (const n of unread) {
      const path = sectionFor(n.type, n.link);
      if (path) by[path] = (by[path] ?? 0) + 1;
    }
    setUnreadBySection(by);
  }

  async function refreshNotifications() {
    if (token) await refreshNotificationsFor(token);
  }

  async function loginWithPin(phone: string, pin: string, expectedRole?: string) {
    const cleanPhone = phone.trim();
    const cleanPin = pin.trim();

    if (!cleanPhone || cleanPin.length !== 4) {
      return { error: "Please enter your 10-digit phone number and 4-digit PIN." };
    }

    // Live location is mandatory: ask for it BEFORE anything else, so a staff
    // member who blocks it never gets a session at all.
    const { lat, lng, reason } = await getGeolocation();
    if (lat == null || lng == null) {
      const why: Record<string, string> = {
        denied: "Location permission is blocked. Tap the lock icon next to the address bar, set Location to Allow, then try again.",
        timeout: "Could not get your location in time. Turn on the phone's Location (GPS), move near a window or outdoors, then try again.",
        unavailable: "Your phone could not find its location. Turn on the phone's Location (GPS) in Settings, then try again.",
        insecure: "Location only works on a secure (https) page. Open the portal using its https address.",
        unsupported: "This browser does not support location. Please use Chrome or Safari.",
      };
      return { error: `Login blocked: ${why[reason ?? "unavailable"]}` };
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
      const portalRoles = ["technician", "sales", "receptionist"];
      if (expectedRole && portalRoles.includes(staffLite.role) && staffLite.role !== expectedRole) {
        return { error: "Login failed: this account is not registered for the selected role. Choose your own role and try again." };
      }
      setStaff(staffLite);
      setToken(result.token);
      localStorage.setItem(STAFF_KEY, JSON.stringify(staffLite));
      localStorage.setItem(TOKEN_KEY, result.token);

      await supabase.rpc("staff_clock_in", { p_token: result.token, p_lat: lat, p_lng: lng });

      await refreshAttendanceFor(result.token);
      await refreshBirthdaysFor(result.token);
      await refreshNotificationsFor(result.token);
      return { staff: staffLite };
    } catch (err: any) {
      return { error: err?.message || "Failed to sign in. Please try again." };
    }
  }

  // After the profile name is saved, refresh the header/greeting straight away.
  function updateStaffName(name: string) {
    setStaff((prev) => {
      if (!prev) return prev;
      const next = { ...prev, name };
      localStorage.setItem(STAFF_KEY, JSON.stringify(next));
      return next;
    });
  }

  // Re-check-in after a check-out (login clocks in automatically). Same rule as
  // login: live location is mandatory.
  async function clockIn(): Promise<{ error?: string }> {
    if (!token) return { error: "Please sign in again." };
    const { lat, lng } = await getGeolocation();
    if (lat == null || lng == null) {
      return { error: "Please turn on live location and tap Allow, then try again." };
    }
    const { data, error } = await supabase.rpc("staff_clock_in", { p_token: token, p_lat: lat, p_lng: lng });
    if (error) return { error: error.message };
    if (!data?.success && data?.error !== "Already clocked in.") return { error: data?.error || "Could not check in." };
    await refreshAttendanceFor(token);
    return {};
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

  async function signOut() {
    // Close today's attendance first so logging out also clocks the person out
    // (best effort, capped so a slow location prompt can't block the logout).
    if (token && openAttendance) {
      await Promise.race([
        supabase.rpc("staff_clock_out", { p_token: token }).then(() => undefined, () => undefined),
        new Promise((resolve) => setTimeout(resolve, 4000)),
      ]);
    }
    wipeFetchCache();
    localStorage.removeItem(STAFF_KEY);
    localStorage.removeItem(TOKEN_KEY);
    setStaff(null);
    setToken(null);
    setOpenAttendance(null);
    setTodaysBirthdays([]);
    setUnreadNotifications(0);
  }

  return (
    <Ctx.Provider
      value={{
        staff,
        token,
        openAttendance,
        todaysBirthdays,
        unreadNotifications,
        unreadBySection,
        loading,
        loginWithPin,
        updateStaffName,
        clockIn,
        clockOut,
        signOut,
        refreshAttendance,
        sendBirthdayWish,
        refreshNotifications,
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
