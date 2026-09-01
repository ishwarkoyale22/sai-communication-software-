import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { StaffAuthProvider, useStaffAuth } from "./context/StaffAuthContext";
import { MobileLayout } from "./components/MobileLayout";
import { Login } from "./pages/Login";
import { Home } from "./pages/Home";
import { Billing } from "./pages/Billing";
import { StaffInventory } from "./pages/StaffInventory";
import { ClientReports } from "./pages/ClientReports";
import { AttendancePage } from "./pages/Attendance";
import { LeavePage } from "./pages/Leave";
import { TasksPage } from "./pages/Tasks";
import { ReviewsPage } from "./pages/Reviews";
import { ActivityPage } from "./pages/Activity";

function RequireStaff({ children }: { children: React.ReactNode }) {
  const { staff, token, loading } = useStaffAuth();
  if (loading) return <div className="flex h-screen items-center justify-center text-gray-400">Loading…</div>;
  if (!staff || !token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <StaffAuthProvider>
      {/* Vite's `base` (and so BASE_URL) intentionally keeps its trailing
          slash for correct asset URLs, but React Router's `basename` must
          NOT have one — "/staff/" fails to match the real URL "/staff" and
          silently renders nothing. Strip it here, not in vite.config. */}
      <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, "")}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            element={
              <RequireStaff>
                <MobileLayout />
              </RequireStaff>
            }
          >
            <Route path="/" element={<Home />} />
            <Route path="/billing" element={<Billing />} />
            <Route path="/inventory" element={<StaffInventory />} />
            <Route path="/client-reports" element={<ClientReports />} />
            <Route path="/attendance" element={<AttendancePage />} />
            <Route path="/leave" element={<LeavePage />} />
            <Route path="/tasks" element={<TasksPage />} />
            <Route path="/reviews" element={<ReviewsPage />} />
            <Route path="/activity" element={<ActivityPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </StaffAuthProvider>
  );
}
