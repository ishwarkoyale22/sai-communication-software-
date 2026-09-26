import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { StaffAuthProvider, useStaffAuth } from "./staff/context/StaffAuthContext";

// Auth bypass must stay off outside of local, ad-hoc debugging — leaving it
// on is what let the whole Admin Portal render without ever signing in,
// while every write action still (correctly) checked for a real session
// and silently failed with "Your admin session has expired".
const BYPASS_AUTH = false;
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
const ImeiSearch = lazy(() => import("./pages/ImeiSearch").then((m) => ({ default: m.ImeiSearch })));
const Sales = lazy(() => import("./pages/Sales").then((m) => ({ default: m.Sales })));
const Customers = lazy(() => import("./pages/Customers").then((m) => ({ default: m.Customers })));
const Birthdays = lazy(() => import("./pages/Birthdays").then((m) => ({ default: m.Birthdays })));
const Repairs = lazy(() => import("./pages/Repairs").then((m) => ({ default: m.Repairs })));
const RepairEnquiries = lazy(() => import("./pages/RepairEnquiries").then((m) => ({ default: m.RepairEnquiries })));
const GiftHampers = lazy(() => import("./pages/GiftHampers").then((m) => ({ default: m.GiftHampers })));
const WholesalerInvoices = lazy(() => import("./pages/WholesalerInvoices").then((m) => ({ default: m.WholesalerInvoices })));
const ThirdPartyPurchases = lazy(() => import("./pages/ThirdPartyPurchases").then((m) => ({ default: m.ThirdPartyPurchases })));
const Finance = lazy(() => import("./pages/Finance").then((m) => ({ default: m.Finance })));
const Payments = lazy(() => import("./pages/Payments").then((m) => ({ default: m.Payments })));
const AllTransactions = lazy(() => import("./pages/AllTransactions").then((m) => ({ default: m.AllTransactions })));
const Offers = lazy(() => import("./pages/Offers").then((m) => ({ default: m.Offers })));
const ServiceFeedback = lazy(() => import("./pages/ServiceFeedback").then((m) => ({ default: m.ServiceFeedback })));
const FinancePartners = lazy(() => import("./pages/FinancePartners").then((m) => ({ default: m.FinancePartners })));
const Branches = lazy(() => import("./pages/Branches").then((m) => ({ default: m.Branches })));
const Suppliers = lazy(() => import("./pages/Suppliers").then((m) => ({ default: m.Suppliers })));
const Settings = lazy(() => import("./pages/Settings").then((m) => ({ default: m.Settings })));
const Gallery = lazy(() => import("./pages/Gallery").then((m) => ({ default: m.Gallery })));
const StaffManagement = lazy(() => import("./pages/StaffManagement").then((m) => ({ default: m.StaffManagement })));
const StaffPortal = lazy(() => import("./pages/StaffPortal").then((m) => ({ default: m.StaffPortal })));
const Analytics = lazy(() => import("./pages/Analytics").then((m) => ({ default: m.Analytics })));
const Enquiries = lazy(() => import("./pages/Enquiries").then((m) => ({ default: m.Enquiries })));
const ClientReports = lazy(() => import("./pages/ClientReports").then((m) => ({ default: m.ClientReports })));
const Reviews = lazy(() => import("./pages/Reviews").then((m) => ({ default: m.Reviews })));
const Brands = lazy(() => import("./pages/Brands").then((m) => ({ default: m.Brands })));
const ServiceManagement = lazy(() => import("./pages/ServiceManagement").then((m) => ({ default: m.ServiceManagement })));
const ReturnRequests = lazy(() => import("./pages/ReturnRequests").then((m) => ({ default: m.ReturnRequests })));
const WebOrders = lazy(() => import("./pages/WebOrders").then((m) => ({ default: m.WebOrders })));
const BackupRestore = lazy(() => import("./pages/BackupRestore").then((m) => ({ default: m.BackupRestore })));
const Gifts = lazy(() => import("./pages/Gifts").then((m) => ({ default: m.Gifts })));
const FinanceReports = lazy(() => import("./pages/FinanceReports").then((m) => ({ default: m.FinanceReports })));

// Staff Portal (role = staff). Its own mobile-first layout, own auth
// (session token, not Supabase Auth), completely separate route subtree —
// see RequireStaffPortal below for the access-control boundary.
import { MobileLayout as StaffMobileLayout } from "./staff/components/MobileLayout";
const StaffHome = lazy(() => import("./staff/pages/Home").then((m) => ({ default: m.Home })));
const StaffAttendance = lazy(() => import("./staff/pages/Attendance").then((m) => ({ default: m.AttendancePage })));
const StaffLeave = lazy(() => import("./staff/pages/Leave").then((m) => ({ default: m.LeavePage })));
const StaffTasks = lazy(() => import("./staff/pages/Tasks").then((m) => ({ default: m.TasksPage })));
const StaffRepairs = lazy(() => import("./staff/pages/Repairs").then((m) => ({ default: m.RepairsPage })));
const StaffClients = lazy(() => import("./staff/pages/Clients").then((m) => ({ default: m.Clients })));
const StaffFollowUps = lazy(() => import("./staff/pages/FollowUps").then((m) => ({ default: m.FollowUps })));
const StaffClientReports = lazy(() => import("./staff/pages/ClientReports").then((m) => ({ default: m.ClientReports })));
const StaffReviews = lazy(() => import("./staff/pages/Reviews").then((m) => ({ default: m.ReviewsPage })));
const StaffActivity = lazy(() => import("./staff/pages/Activity").then((m) => ({ default: m.ActivityPage })));
const StaffNotifications = lazy(() => import("./staff/pages/Notifications").then((m) => ({ default: m.Notifications })));
const StaffProfile = lazy(() => import("./staff/pages/Profile").then((m) => ({ default: m.Profile })));
const StaffFinanceReports = lazy(() => import("./staff/pages/FinanceReports").then((m) => ({ default: m.FinanceReports })));
// Role-portal additions (Sales / Receptionist) — Technician reuses StaffRepairs/StaffTasks/etc above.
const StaffProducts = lazy(() => import("./staff/pages/ProductsView").then((m) => ({ default: m.ProductsView })));
const StaffOffers = lazy(() => import("./staff/pages/OffersView").then((m) => ({ default: m.OffersView })));
const StaffGiftsCatalog = lazy(() => import("./staff/pages/GiftsCatalog").then((m) => ({ default: m.GiftsCatalog })));
const StaffOrders = lazy(() => import("./staff/pages/OrdersView").then((m) => ({ default: m.OrdersView })));
const StaffSalesHistory = lazy(() => import("./staff/pages/SalesHistory").then((m) => ({ default: m.SalesHistory })));
const StaffSalesTargets = lazy(() => import("./staff/pages/SalesTargets").then((m) => ({ default: m.SalesTargets })));
const StaffEnquiries = lazy(() => import("./staff/pages/Enquiries").then((m) => ({ default: m.Enquiries })));
const StaffRepairIntake = lazy(() => import("./staff/pages/RepairIntake").then((m) => ({ default: m.RepairIntake })));

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

// A Technician must not reach Sales-only screens (and vice versa) even by
// typing the URL directly — the Home page only ever links to same-role
// pages, this is the backstop. Legacy roles (staff/cashier/manager) never
// match any of the 3 new role-gated route groups, so they simply bounce
// back to the generic /portal, same as always.
function RequireStaffRole({ role, children }: { role: "technician" | "sales" | "receptionist" | ("technician" | "sales" | "receptionist")[]; children: React.ReactNode }) {
  const { staff } = useStaffAuth();
  const allowed = Array.isArray(role) ? role : [role];
  if (!staff || !allowed.includes(staff.role as any)) return <Navigate to="/portal" replace />;
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
                <Route path="/imei-search" element={<ImeiSearch />} />
                <Route path="/sales" element={<Sales />} />
                <Route path="/web-orders" element={<WebOrders />} />
                <Route path="/return-requests" element={<ReturnRequests />} />
                <Route path="/customers" element={<Customers />} />
                <Route path="/birthdays" element={<Birthdays />} />
                <Route path="/enquiries" element={<Enquiries />} />
                <Route path="/client-reports" element={<ClientReports />} />
                <Route path="/finance-reports" element={<FinanceReports />} />
                <Route path="/reviews" element={<Reviews />} />
                <Route path="/repair-enquiries" element={<RepairEnquiries />} />
                <Route path="/repairs" element={<Repairs />} />
                <Route path="/gift-hampers" element={<GiftHampers />} />
                <Route path="/gifts" element={<Gifts />} />
                <Route path="/brands" element={<Brands />} />
                <Route path="/services" element={<ServiceManagement />} />
                <Route path="/wholesaler-invoices" element={<WholesalerInvoices />} />
                <Route path="/third-party-purchases" element={<ThirdPartyPurchases />} />
                <Route path="/finance" element={<Finance />} />
                <Route path="/emi" element={<Navigate to="/finance" replace />} />
                <Route path="/payments" element={<Payments />} />
                <Route path="/all-transactions" element={<AllTransactions />} />
                <Route path="/offers" element={<Offers />} />
                <Route path="/service-feedback" element={<ServiceFeedback />} />
                <Route path="/finance-partners" element={<FinancePartners />} />
                <Route path="/branches" element={<Branches />} />
                <Route path="/suppliers" element={<Suppliers />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/backup" element={<BackupRestore />} />
                <Route path="/gallery" element={<Gallery />} />
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
                <Route path="/portal/technician" element={<StaffHome />} />
                <Route path="/portal/sales" element={<StaffHome />} />
                <Route path="/portal/reception" element={<StaffHome />} />
                <Route path="/portal/attendance" element={<StaffAttendance />} />
                <Route path="/portal/leave" element={<StaffLeave />} />
                <Route path="/portal/tasks" element={<StaffTasks />} />
                <Route path="/portal/repairs" element={<StaffRepairs />} />
                <Route path="/portal/clients" element={<StaffClients />} />
                <Route path="/portal/follow-ups" element={<StaffFollowUps />} />
                <Route path="/portal/reports" element={<StaffClientReports />} />
                <Route path="/portal/finance-reports" element={<StaffFinanceReports />} />
                <Route path="/portal/reviews" element={<StaffReviews />} />
                <Route path="/portal/activity" element={<StaffActivity />} />
                <Route path="/portal/notifications" element={<StaffNotifications />} />
                <Route path="/portal/profile" element={<StaffProfile />} />

                {/* Sales Person */}
                {/* New Sale was removed from the salesperson portal; keep old links/bookmarks working. */}
                <Route path="/portal/new-sale" element={<Navigate to="/portal" replace />} />
                <Route path="/portal/products" element={<RequireStaffRole role="sales"><StaffProducts /></RequireStaffRole>} />
                <Route path="/portal/offers" element={<RequireStaffRole role="sales"><StaffOffers /></RequireStaffRole>} />
                <Route path="/portal/gifts-catalog" element={<RequireStaffRole role="sales"><StaffGiftsCatalog /></RequireStaffRole>} />
                <Route path="/portal/orders" element={<RequireStaffRole role="sales"><StaffOrders /></RequireStaffRole>} />
                <Route path="/portal/sales-history" element={<RequireStaffRole role="sales"><StaffSalesHistory /></RequireStaffRole>} />
                <Route path="/portal/targets" element={<RequireStaffRole role="sales"><StaffSalesTargets /></RequireStaffRole>} />

                {/* Sales + Receptionist share Customer Enquiries */}
                <Route path="/portal/enquiries" element={<RequireStaffRole role={["sales", "receptionist"]}><StaffEnquiries /></RequireStaffRole>} />

                {/* Receptionist */}
                <Route path="/portal/repair-intake" element={<RequireStaffRole role="receptionist"><StaffRepairIntake /></RequireStaffRole>} />
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
