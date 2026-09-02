import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { StaffAuthProvider, useStaffAuth } from "./context/StaffAuthContext";
import { MobileLayout } from "./components/MobileLayout";
import { Login } from "./pages/Login";

const Home = lazy(() => import("./pages/Home").then((m) => ({ default: m.Home })));
const Billing = lazy(() => import("./pages/Billing").then((m) => ({ default: m.Billing })));
const StaffInventory = lazy(() => import("./pages/StaffInventory").then((m) => ({ default: m.StaffInventory })));
const ClientReports = lazy(() => import("./pages/ClientReports").then((m) => ({ default: m.ClientReports })));
const AttendancePage = lazy(() => import("./pages/Attendance").then((m) => ({ default: m.AttendancePage })));
const LeavePage = lazy(() => import("./pages/Leave").then((m) => ({ default: m.LeavePage })));
const TasksPage = lazy(() => import("./pages/Tasks").then((m) => ({ default: m.TasksPage })));
const ReviewsPage = lazy(() => import("./pages/Reviews").then((m) => ({ default: m.ReviewsPage })));
const ActivityPage = lazy(() => import("./pages/Activity").then((m) => ({ default: m.ActivityPage })));

function RouteFallback() {
  return (
    <div className="flex h-[60vh] items-center justify-center">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-brand-primary" />
    </div>
  );
}

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
        <Suspense fallback={<RouteFallback />}>
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
        </Suspense>
      </BrowserRouter>
    </StaffAuthProvider>
  );
}
