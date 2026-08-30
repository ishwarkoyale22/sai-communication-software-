import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ShoppingCart, Package, Wrench, LogOut } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useStaffAuth } from "../context/StaffAuthContext";

export function Home() {
  const { staff, openAttendance, clockOut } = useStaffAuth();
  const [todaySales, setTodaySales] = useState(0);

  useEffect(() => {
    if (!staff) return;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    supabase
      .from("sales")
      .select("id", { count: "exact", head: true })
      .eq("staff_id", staff.id)
      .gte("created_at", todayStart.toISOString())
      .then(({ count }) => setTodaySales(count ?? 0));
  }, [staff]);

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <div className="text-xs font-medium text-gray-500">Today's Sales</div>
        <div className="mt-1 text-3xl font-semibold text-gray-800">{todaySales}</div>
        {openAttendance && (
          <div className="mt-1 text-xs text-brand-success">
            Clocked in at {new Date(openAttendance.clock_in).toLocaleTimeString("en-IN")}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Link to="/billing" className="card flex flex-col items-center justify-center gap-2 p-6">
          <ShoppingCart className="text-brand-primary" size={28} />
          <span className="text-sm font-medium">New Sale</span>
        </Link>
        <Link to="/inventory" className="card flex flex-col items-center justify-center gap-2 p-6">
          <Package className="text-brand-primary" size={28} />
          <span className="text-sm font-medium">Check Stock</span>
        </Link>
        <div className="card flex flex-col items-center justify-center gap-2 p-6 opacity-50">
          <Wrench size={28} />
          <span className="text-sm font-medium">My Repairs</span>
        </div>
        <button
          onClick={() => clockOut()}
          disabled={!openAttendance}
          className="card flex flex-col items-center justify-center gap-2 p-6 disabled:opacity-40"
        >
          <LogOut className="text-brand-danger" size={28} />
          <span className="text-sm font-medium">Clock Out</span>
        </button>
      </div>
    </div>
  );
}
