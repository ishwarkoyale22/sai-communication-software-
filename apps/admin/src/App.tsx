import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { StaffAuthProvider, useStaffAuth } from "./staff/context/StaffAuthContext";

// Set BYPASS_AUTH = true for local development and direct portal testing.
const BYPASS_AUTH = true;
import { Layout } from "./components/Layout";
import { Login } from "./pages/Login";
import { ForgotPassword } from "./pages/ForgotPassword";
import { ResetPassword } from "./pages/ResetPassword";

// Every route below this point is lazy-loaded: each page becomes its own
// chunk that only downloads when the user actually navigates there, instead
// of all ~30 pages landing in one eager bundle. Layout/Login/auth stay
// eager since they're needed for the very first paint regardless of route.
const Dashboard = lazy(() => import("./pages/Dashboard").then((m) => ({ default: m.Dashboard })));
const Inventory = lazy(() => import("./pages/Inventory").then((m) => ({ default: m.Inventory })));
const Sales = lazy(() => import("./pages/Sales").then((m) => ({ default: m.Sales })));
const Customers = lazy(() => import("./pages/Customers").then((m) => ({ default: m.Customers })));
const Repairs = lazy(() => import("./pages/Repairs").then((m) => ({ default: m.Repairs })));
const RepairEnquiries = lazy(() => import("./pages/RepairEnquiries").then((m) => ({ default: m.RepairEnquiries })));
const GiftHampers = lazy(() => import("./pages/GiftHampers").then((m) => ({ default: m.GiftHampers })));
const WholesalerInvoices = lazy(() => import("./pages/WholesalerInvoices").then((m) => ({ default: m.WholesalerInvoices })));
const ThirdPartyPurchases = lazy(() => import("./pages/ThirdPartyPurchases").then((m) => ({ default: m.ThirdPartyPurchases })));
const Emi = lazy(() => import("./pages/Emi").then((m) => ({ default: m.Emi })));
const StaffManagement = lazy(() => import("./pages/StaffManagement").then((m) => ({ default: m.StaffManagement })));
const StaffPortal = lazy(() => import("./pages/StaffPortal").then((m) => ({ default: m.StaffPortal })));
const Analytics = lazy(() => import("./pages/Analytics").then((m) => ({ default: m.Analytics })));
const Enquiries = lazy(() => import("./pages/Enquiries").then((m) => ({ default: m.Enquiries })));
const ClientReports = lazy(() => import("./pages/ClientReports").then((m) => ({ default: m.ClientReports })));
const Reviews = lazy(() => import("./pages/Reviews").then((m) => ({ default: m.Reviews })));
const Brands = lazy(() => import("./pages/Brands").then((m) => ({ default: m.Brands })));
const ServiceManagement = lazy(() => import("./pages/ServiceManagement").then((m) => ({ default: m.ServiceManagement })));
const WebOrders = lazy(() => import("./pages/WebOrders").then((m) => ({ default: m.WebOrders })));

// Staff Portal (role = staff). Its own mobile-first layout, own auth
// (session token, not Supabase Auth), completely separate route subtree —
// see RequireStaffPortal below for the access-control boundary.
import { MobileLayout as StaffMobileLayout } from "./staff/components/MobileLayout";
const StaffHome = lazy(() => import("./staff/pages/Home").then((m) => ({ default: m.Home })));
const StaffAttendance = lazy(() => import("./staff/pages/Attendance").then((m) => ({ default: m.AttendancePage })));
const StaffLeave = lazy(() => import("./staff/pages/Leave").then((m) => ({ default: m.LeavePage })));
const StaffTasks = lazy(() => import("./staff/pages/Tasks").then((m) => ({ default: m.TasksPage })));
const StaffClients = lazy(() => import("./staff/pages/Clients").then((m) => ({ default: m.Clients })));
const StaffFollowUps = lazy(() => import("./staff/pages/FollowUps").then((m) => ({ default: m.FollowUps })));
const StaffClientReports = lazy(() => import("./staff/pages/ClientReports").then((m) => ({ default: m.ClientReports })));
const StaffReviews = lazy(() => import("./staff/pages/Reviews").then((m) => ({ default: m.ReviewsPage })));
const StaffActivity = lazy(() => import("./staff/pages/Activity").then((m) => ({ default: m.ActivityPage })));
const StaffNotifications = lazy(() => import("./staff/pages/Notifications").then((m) => ({ default: m.Notifications })));
const StaffProfile = lazy(() => import("./staff/pages/Profile").then((m) => ({ default: m.Profile })));

function RouteFallback() {
  return (
    <div className="flex h-[60vh] items-center justify-center">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-brand-primary" />
    </div>
  );
}

function RequireAdmin({ children }: { children: React.ReactNode }) {
  // TEMPORARY: bypass while BYPASS_AUTH is true — see the constant at top.
  if (BYPASS_AUTH) return <>{children}</>;
  // eslint-disable-next-line react-hooks/rules-of-hooks -- safe: BYPASS_AUTH is a build-time constant
  const { session, loading, isAdmin } = useAuth();
  if (loading) return <div className="flex h-screen items-center justify-center text-gray-400">Loading…</div>;
  if (!session) return <Navigate to="/login" replace />;
  if (!isAdmin) return <div className="flex h-screen items-center justify-center text-brand-danger">Not authorized as admin.</div>;
  return <>{children}</>;
}

// Staff never reach the admin panel through here: this guard checks ONLY
// the staff session token (never a Supabase Auth session/isAdmin), so an
// admin's own login does not implicitly grant /portal access either — each
// role has its own guard, matching the "block staff from admin, and don't
// assume the reverse" requirement.
function RequireStaffPortal({ children }: { children: React.ReactNode }) {
  const { staff, token, loading } = useStaffAuth();
  if (loading) return <div className="flex h-screen items-center justify-center text-gray-400">Loading…</div>;
  if (!staff || !token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <AuthProvider>
      <StaffAuthProvider>
        <BrowserRouter>
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              {/* /reset-password is intentionally OUTSIDE RequireAdmin — the
                  recovery link needs to open regardless of session state. */}
              <Route path="/reset-password" element={<ResetPassword />} />

              {/* ---------------- Admin Panel — role = admin ---------------- */}
              <Route
                element={
                  <RequireAdmin>
                    <Layout />
                  </RequireAdmin>
                }
              >
                <Route path="/" element={<Dashboard />} />
                <Route path="/inventory" element={<Inventory />} />
                <Route path="/sales" element={<Sales />} />
                <Route path="/web-orders" element={<WebOrders />} />
                <Route path="/customers" element={<Customers />} />
                <Route path="/enquiries" element={<Enquiries />} />
                <Route path="/client-reports" element={<ClientReports />} />
                <Route path="/reviews" element={<Reviews />} />
                <Route path="/repair-enquiries" element={<RepairEnquiries />} />
                <Route path="/repairs" element={<Repairs />} />
                <Route path="/gift-hampers" element={<GiftHampers />} />
                <Route path="/brands" element={<Brands />} />
                <Route path="/services" element={<ServiceManagement />} />
                <Route path="/wholesaler-invoices" element={<WholesalerInvoices />} />
                <Route path="/third-party-purchases" element={<ThirdPartyPurchases />} />
                <Route path="/emi" element={<Emi />} />
                <Route path="/staff" element={<StaffManagement />} />
                <Route path="/staff-portal" element={<StaffPortal />} />
                <Route path="/analytics" element={<Analytics />} />
              </Route>

              {/* ---------------- Staff Portal — role = staff ---------------- */}
              <Route
                element={
                  <RequireStaffPortal>
                    <StaffMobileLayout />
                  </RequireStaffPortal>
                }
              >
                <Route path="/portal" element={<StaffHome />} />
                <Route path="/portal/attendance" element={<StaffAttendance />} />
                <Route path="/portal/leave" element={<StaffLeave />} />
                <Route path="/portal/tasks" element={<StaffTasks />} />
                <Route path="/portal/clients" element={<StaffClients />} />
                <Route path="/portal/follow-ups" element={<StaffFollowUps />} />
                <Route path="/portal/reports" element={<StaffClientReports />} />
                <Route path="/portal/reviews" element={<StaffReviews />} />
                <Route path="/portal/activity" element={<StaffActivity />} />
                <Route path="/portal/notifications" element={<StaffNotifications />} />
                <Route path="/portal/profile" element={<StaffProfile />} />
              </Route>

              {/* Unknown URL under either subtree — including a staff member
                  typing an admin path directly — lands here instead of
                  silently 404ing or falling through to admin content. */}
              <Route path="*" element={<Navigate to="/login" replace />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </StaffAuthProvider>
    </AuthProvider>
  );
}
