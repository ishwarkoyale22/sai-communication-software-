import { Link } from "react-router-dom";
import { ShoppingCart, Package, FileText, Clock, CalendarDays, ListChecks, Star, History, LogOut } from "lucide-react";
import { useStaffAuth } from "../context/StaffAuthContext";

const TILES = [
  { to: "/attendance", label: "My Attendance", icon: Clock },
  { to: "/leave", label: "Leave", icon: CalendarDays },
  { to: "/tasks", label: "My Tasks", icon: ListChecks },
  { to: "/client-reports", label: "Client Reports", icon: FileText },
  { to: "/reviews", label: "Customer Reviews", icon: Star },
  { to: "/activity", label: "My Activity", icon: History },
  { to: "/billing", label: "New Sale", icon: ShoppingCart },
  { to: "/inventory", label: "Check Stock", icon: Package },
];

export function Home() {
  const { staff, openAttendance, clockOut } = useStaffAuth();

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <div className="text-xs font-medium text-gray-500">Welcome</div>
        <div className="mt-1 text-lg font-semibold text-gray-800">{staff?.name}</div>
        <div className="mt-1 flex items-center justify-between">
          <div className={`flex items-center gap-1.5 text-xs font-medium ${openAttendance ? "text-brand-success" : "text-gray-400"}`}>
            <Clock size={13} />
            {openAttendance
              ? `Clocked in at ${new Date(openAttendance.clock_in).toLocaleTimeString("en-IN")}`
              : "Not clocked in"}
          </div>
          {openAttendance && (
            <button onClick={() => clockOut()} className="flex items-center gap-1 text-xs font-medium text-brand-danger">
              <LogOut size={13} /> Clock Out
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {TILES.map(({ to, label, icon: Icon }) => (
          <Link key={to} to={to} className="card flex flex-col items-center justify-center gap-2 p-5">
            <Icon className="text-brand-primary" size={26} />
            <span className="text-center text-sm font-medium">{label}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
