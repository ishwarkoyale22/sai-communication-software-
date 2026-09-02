import { NavLink, Outlet } from "react-router-dom";
import { Home, ShoppingCart, Clock, ListChecks, LogOut } from "lucide-react";
import { useStaffAuth } from "../context/StaffAuthContext";

export function MobileLayout() {
  const { staff, signOut } = useStaffAuth();

  return (
    // Full-bleed on an actual phone; on a tablet/laptop viewport (sm+) this
    // renders as a centered "app frame" instead of stretching mobile-only
    // UI edge-to-edge across a wide screen.
    <div className="bg-page sm:flex sm:min-h-screen sm:items-center sm:justify-center sm:bg-accent sm:p-6">
      <div className="relative flex h-screen w-full flex-col overflow-hidden bg-page sm:h-[min(860px,92vh)] sm:max-w-[420px] sm:rounded-2xl sm:border sm:border-border sm:shadow-cardHover">
        <header className="flex h-topbar shrink-0 items-center justify-between border-b border-border bg-card px-4">
          <span className="font-serif text-sm font-semibold text-gray-800">Hi, {staff?.name?.split(" ")[0]}</span>
          <button onClick={() => signOut()} className="text-gray-400">
            <LogOut size={18} />
          </button>
        </header>
        <main className="flex-1 overflow-y-auto p-4 pb-20">
          <Outlet />
        </main>
        <nav className="absolute inset-x-0 bottom-0 flex h-16 border-t border-border bg-card">
          {[
            { to: "/", label: "Home", icon: Home },
            { to: "/attendance", label: "Attendance", icon: Clock },
            { to: "/tasks", label: "Tasks", icon: ListChecks },
            { to: "/billing", label: "New Sale", icon: ShoppingCart },
          ].map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                `flex flex-1 flex-col items-center justify-center gap-0.5 text-xs ${
                  isActive ? "text-brand-primary" : "text-gray-400"
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
