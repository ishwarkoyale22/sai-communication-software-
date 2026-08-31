import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { StaffAuthProvider, useStaffAuth } from "./context/StaffAuthContext";
import { MobileLayout } from "./components/MobileLayout";
import { Login } from "./pages/Login";
import { Home } from "./pages/Home";
import { Billing } from "./pages/Billing";
import { StaffInventory } from "./pages/StaffInventory";
import { ClientReports } from "./pages/ClientReports";

function RequireStaff({ children }: { children: React.ReactNode }) {
  const { session, staff, loading } = useStaffAuth();
  if (loading) return <div className="flex h-screen items-center justify-center text-gray-400">Loading…</div>;
  if (!session || !staff) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <StaffAuthProvider>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
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
          </Route>
        </Routes>
      </BrowserRouter>
    </StaffAuthProvider>
  );
}
