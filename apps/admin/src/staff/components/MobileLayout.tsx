import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { markNavigation } from "@sai/shared";
import { Home, Clock, ListChecks, Bell, LogOut } from "lucide-react";
import { useStaffAuth } from "../context/StaffAuthContext";
import { SmoothScroll } from "../../components/SmoothScroll";

export function MobileLayout() {
  const { staff, signOut, unreadNotifications } = useStaffAuth();
  const location = useLocation();
  // Lets the data cache answer this page's reads instantly (see swrFetch in @sai/shared).
  const bumped = useRef(false);
  useEffect(() => {
    bumped.current = false;
    markNavigation();
  }, [location.pathname]);
  // Re-render the page once if the quiet background refresh found newer data
  // (not while typing or with a form sheet open).
  const [dataRev, setDataRev] = useState(0);
  useEffect(() => {
    const onRefreshed = () => {
      const el = document.activeElement;
      if ((el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) || document.querySelector("main .fixed")) return;
      if (bumped.current) return;
      bumped.current = true;
      setDataRev((n) => n + 1);
    };
    window.addEventListener("sai-data-refreshed", onRefreshed);
    return () => window.removeEventListener("sai-data-refreshed", onRefreshed);
  }, []);
  const mainRef = useRef<HTMLElement | null>(null);
  const mainContentRef = useRef<HTMLDivElement | null>(null);
  const firstName = staff?.name?.split(" ")[0] ?? "";
  const initials = staff?.name
    ? staff.name
        .split(" ")
        .map((p) => p[0])
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : "";

  return (
    // Full-bleed on an actual phone; on a tablet/laptop viewport (sm+) this
    // renders as a centered "app frame" instead of stretching mobile-only
    // UI edge-to-edge across a wide screen.
    <div className="bg-page sm:flex sm:min-h-screen sm:items-center sm:justify-center sm:bg-accent sm:p-6">
      <div className="relative flex h-screen w-full flex-col overflow-hidden bg-page sm:h-[min(860px,92vh)] sm:max-w-[420px] sm:rounded-2xl sm:border sm:border-border sm:shadow-cardHover">
        <header className="relative flex h-topbar shrink-0 items-center justify-between overflow-hidden border-b border-gold/25 bg-card px-4">
          <div
            className="pointer-events-none absolute inset-x-0 top-0 h-full opacity-70"
            style={{ background: "radial-gradient(220px circle at 12% 0%, rgba(201,151,90,0.14), transparent 70%)" }}
          />
          <div className="relative flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-gold to-goldDim font-serif text-xs font-bold text-white shadow-sm">
              {initials || <Clock size={14} />}
            </div>
            <span className="font-serif text-sm font-semibold text-gray-800">Hi, {firstName}</span>
          </div>
          <button
            onClick={() => signOut()}
            className="relative flex h-8 w-8 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-accent hover:text-brand-danger"
            aria-label="Sign out"
          >
            <LogOut size={15} />
          </button>
        </header>
        <main ref={mainRef} className="flex-1 overflow-y-auto bg-page p-4 pb-20">
          <div ref={mainContentRef}>
            <Outlet key={dataRev} />
          </div>
        </main>
        <SmoothScroll wrapperRef={mainRef} contentRef={mainContentRef} />
        <nav className="absolute inset-x-0 bottom-0 flex h-16 border-t border-border bg-card">
          {[
            { to: "/portal", label: "Home", icon: Home, end: true },
            { to: "/portal/attendance", label: "Attendance", icon: Clock },
            { to: "/portal/tasks", label: "Tasks", icon: ListChecks },
            { to: "/portal/notifications", label: "Alerts", icon: Bell },
          ].map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `relative flex flex-1 flex-col items-center justify-center gap-0.5 text-xs transition-colors ${
                  isActive ? "text-gold" : "text-gray-400 hover:text-gray-600"
                }`
              }
            >
              <span className="relative">
                <Icon size={20} />
                {label === "Alerts" && unreadNotifications > 0 && (
                  <span className="absolute -right-1.5 -top-1.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-brand-danger px-0.5 text-[9px] font-semibold text-white">
                    {unreadNotifications > 9 ? "9+" : unreadNotifications}
                  </span>
                )}
              </span>
              {label}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}
