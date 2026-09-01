import { useEffect, useState } from "react";
import { useStaffAuth } from "../context/StaffAuthContext";
import { supabase } from "../lib/supabase";
import { CheckCircle2, Clock } from "lucide-react";

interface AttendanceRow {
  id: string;
  clock_in: string;
  clock_out: string | null;
}

export function AttendancePage() {
  const { token, openAttendance, clockOut } = useStaffAuth();
  const [history, setHistory] = useState<AttendanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    load();
  }, [token]);

  async function load() {
    if (!token) return;
    setLoading(true);
    const { data } = await supabase.rpc("staff_get_attendance", { p_token: token });
    setHistory((data as AttendanceRow[]) ?? []);
    setLoading(false);
  }

  async function handleClockOut() {
    setWorking(true);
    await clockOut();
    await load();
    setWorking(false);
  }

  function duration(row: AttendanceRow) {
    const end = row.clock_out ? new Date(row.clock_out) : new Date();
    const mins = (end.getTime() - new Date(row.clock_in).getTime()) / 60000;
    return `${Math.floor(mins / 60)}h ${Math.round(mins % 60)}m`;
  }

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-gray-800">My Attendance</h1>

      <div className="card flex items-center justify-between p-4">
        <div>
          <div className="flex items-center gap-1.5 text-sm font-medium text-gray-700">
            <Clock size={15} className={openAttendance ? "text-brand-success" : "text-gray-400"} />
            {openAttendance ? "Currently clocked in" : "Not clocked in"}
          </div>
          {openAttendance && (
            <p className="mt-0.5 text-xs text-gray-500">
              Since {new Date(openAttendance.clock_in).toLocaleTimeString("en-IN")}
            </p>
          )}
        </div>
        {openAttendance && (
          <button className="btn-primary text-sm" disabled={working} onClick={handleClockOut}>
            {working ? "Clocking out…" : "Clock Out"}
          </button>
        )}
      </div>

      <div className="card divide-y divide-border">
        <div className="p-3 text-xs font-semibold uppercase text-gray-400">History</div>
        {loading ? (
          <div className="p-6 text-center text-sm text-gray-400">Loading…</div>
        ) : history.length === 0 ? (
          <div className="p-6 text-center text-sm text-gray-400">No attendance recorded yet.</div>
        ) : (
          history.map((row) => (
            <div key={row.id} className="flex items-center justify-between p-3 text-sm">
              <div>
                <div className="font-medium text-gray-800">
                  {new Date(row.clock_in).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}
                </div>
                <div className="text-xs text-gray-500">
                  {new Date(row.clock_in).toLocaleTimeString("en-IN")} –{" "}
                  {row.clock_out ? new Date(row.clock_out).toLocaleTimeString("en-IN") : "—"}
                </div>
              </div>
              <div className="flex items-center gap-1.5 text-xs font-medium text-gray-600">
                {!row.clock_out && <CheckCircle2 size={13} className="text-brand-success" />}
                {duration(row)}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
