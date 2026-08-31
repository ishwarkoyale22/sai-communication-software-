import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";

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
import { Analytics } from "./pages/Analytics";
import { Enquiries } from "./pages/Enquiries";
import { ClientReports } from "./pages/ClientReports";
import { Reviews } from "./pages/Reviews";
import { Brands } from "./pages/Brands";
import { ServiceManagement } from "./pages/ServiceManagement";
import { WebOrders } from "./pages/WebOrders";

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

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          {/* /reset-password is intentionally OUTSIDE RequireAdmin — the
              recovery link needs to open regardless of session state. */}
          <Route path="/reset-password" element={<ResetPassword />} />
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
            <Route path="/analytics" element={<Analytics />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
