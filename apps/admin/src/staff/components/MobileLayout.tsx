import { NavLink, Outlet } from "react-router-dom";
import { Home, Clock, ListChecks, Bell, LogOut } from "lucide-react";
import { useStaffAuth } from "../context/StaffAuthContext";

export function MobileLayout() {
  const { staff, signOut } = useStaffAuth();
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
        <main className="flex-1 overflow-y-auto bg-page p-4 pb-20">
          <Outlet />
        </main>
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
                `flex flex-1 flex-col items-center justify-center gap-0.5 text-xs transition-colors ${
                  isActive ? "text-gold" : "text-gray-400 hover:text-gray-600"
                }`
              }
            >
              <Icon size={20} />
              {label}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}
