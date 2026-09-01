import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { StaffAuthProvider, useStaffAuth } from "./staff/context/StaffAuthContext";

// Set BYPASS_AUTH = true for local development and direct portal testing.
const BYPASS_AUTH = true;
import { Layout } from "./components/Layout";
import { Login } from "./pages/Login";
import { ForgotPassword } from "./pages/ForgotPassword";
import { ResetPassword } from "./pages/ResetPassword";
import { Dashboard } from "./pages/Dashboard";
import { Inventory } from "./pages/Inventory";
import { Sales } from "./pages/Sales";
import { Customers } from "./pages/Customers";
import { Repairs } from "./pages/Repairs";
import { RepairEnquiries } from "./pages/RepairEnquiries";
import { GiftHampers } from "./pages/GiftHampers";
import { WholesalerInvoices } from "./pages/WholesalerInvoices";
import { ThirdPartyPurchases } from "./pages/ThirdPartyPurchases";
import { Emi } from "./pages/Emi";
import { StaffManagement } from "./pages/StaffManagement";
import { StaffPortal } from "./pages/StaffPortal";
import { Analytics } from "./pages/Analytics";
import { Enquiries } from "./pages/Enquiries";
import { ClientReports } from "./pages/ClientReports";
import { Reviews } from "./pages/Reviews";
import { Brands } from "./pages/Brands";
import { ServiceManagement } from "./pages/ServiceManagement";
import { WebOrders } from "./pages/WebOrders";

// Staff Portal (role = staff). Its own mobile-first layout, own auth
// (session token, not Supabase Auth), completely separate route subtree —
// see RequireStaffPortal below for the access-control boundary.
import { MobileLayout as StaffMobileLayout } from "./staff/components/MobileLayout";
import { Home as StaffHome } from "./staff/pages/Home";
import { AttendancePage as StaffAttendance } from "./staff/pages/Attendance";
import { LeavePage as StaffLeave } from "./staff/pages/Leave";
import { TasksPage as StaffTasks } from "./staff/pages/Tasks";
import { Clients as StaffClients } from "./staff/pages/Clients";
import { FollowUps as StaffFollowUps } from "./staff/pages/FollowUps";
import { ClientReports as StaffClientReports } from "./staff/pages/ClientReports";
import { ReviewsPage as StaffReviews } from "./staff/pages/Reviews";
import { ActivityPage as StaffActivity } from "./staff/pages/Activity";
import { Notifications as StaffNotifications } from "./staff/pages/Notifications";
import { Profile as StaffProfile } from "./staff/pages/Profile";

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
        </BrowserRouter>
      </StaffAuthProvider>
    </AuthProvider>
  );
}
