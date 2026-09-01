import { NavLink, Outlet } from "react-router-dom";
import { Home, Clock, ListChecks, Bell } from "lucide-react";
import { useStaffAuth } from "../context/StaffAuthContext";

export function MobileLayout() {
  const { staff, signOut } = useStaffAuth();

  return (
    <div className="flex h-screen flex-col bg-page">
      <header className="flex h-topbar shrink-0 items-center justify-between border-b border-border bg-card px-4">
        <span className="text-sm font-semibold text-gray-800">Hi, {staff?.name?.split(" ")[0]}</span>
        <button onClick={() => signOut()} className="text-gray-400">
          Logout
        </button>
      </header>
      <main className="flex-1 overflow-y-auto p-4 pb-20">
        <Outlet />
      </main>
      <nav className="fixed bottom-0 left-0 right-0 flex h-16 border-t border-border bg-card">
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
  );
}
