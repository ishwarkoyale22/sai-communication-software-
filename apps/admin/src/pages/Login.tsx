import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useStaffAuth } from "../staff/context/StaffAuthContext";
import { AlertCircle, CheckCircle, ShieldCheck, UserRound } from "lucide-react";

export function Login() {
  const { session, signIn } = useAuth();
  const { staff, loginWithPin } = useStaffAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"admin" | "staff">("admin");

  // Admin (email/password)
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Staff (phone/PIN)
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // If already authenticated, redirect to the panel matching the role —
  // this is also what enforces "staff can never land on the admin panel":
  // an admin Supabase session redirects to "/", a staff session token
  // redirects to "/portal", and neither branch ever crosses into the other.
  useEffect(() => {
    if (session) {
      navigate("/", { replace: true });
    } else if (staff) {
      navigate("/portal", { replace: true });
    }
  }, [session, staff, navigate]);

  async function handleAdminSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);
    const res = await signIn(email.trim(), password);
    setLoading(false);

    if (res.error) {
      setError(res.error);
    } else {
      setSuccess("Signed in successfully! Redirecting...");
      navigate("/", { replace: true });
    }
  }

  async function handleStaffSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const cleanPhone = phone.trim();
    if (!cleanPhone || pin.length !== 4) {
      setError("Enter your phone number and 4-digit PIN.");
      return;
    }

    setLoading(true);
    try {
      // Goes through the real, server-verified session flow (issues a
      // staff_sessions token and clocks the staff member in) — not a
      // client-fabricated "session" written straight to localStorage,
      // which is what this used to do before Admin and Staff shared an app.
      const res = await loginWithPin(cleanPhone, pin);
      if (res.error) {
        setError(res.error);
        return;
      }
      setSuccess("Signed in! Redirecting to Staff Portal...");
      navigate("/portal", { replace: true });
    } catch (err: any) {
      setError(err?.message || "Failed to sign in. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-page px-4">
      <div className="card w-full max-w-sm p-6 shadow-lg border border-border">
        <div className="text-center mb-5">
          <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-brand-primary/10 text-brand-primary">
            {mode === "admin" ? <ShieldCheck size={22} /> : <UserRound size={22} />}
          </div>
          <h1 className="text-lg font-bold text-gray-800">Sai Communication</h1>
          <p className="text-xs text-gray-500">
            {mode === "admin" ? "Retail ERP Admin Portal" : "Staff Portal Login"}
          </p>
        </div>

        <div className="mb-5 grid grid-cols-2 gap-1 rounded-md bg-gray-100 p-1">
          <button
            type="button"
            onClick={() => {
              setMode("admin");
              setError(null);
              setSuccess(null);
            }}
            className={`rounded py-1.5 text-xs font-medium transition-colors ${
              mode === "admin" ? "bg-white text-brand-primary shadow-sm" : "text-gray-500"
            }`}
          >
            Admin Login
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("staff");
              setError(null);
              setSuccess(null);
            }}
            className={`rounded py-1.5 text-xs font-medium transition-colors ${
              mode === "staff" ? "bg-white text-brand-primary shadow-sm" : "text-gray-500"
            }`}
          >
            Staff Login
          </button>
        </div>

        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-md bg-red-50 p-3 text-xs text-brand-danger border border-red-200">
            <AlertCircle size={15} className="shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div className="mb-4 flex items-center gap-2 rounded-md bg-emerald-50 p-3 text-xs text-emerald-700 border border-emerald-200">
            <CheckCircle size={15} className="shrink-0" />
            <span>{success}</span>
          </div>
        )}

        {mode === "admin" ? (
          <form onSubmit={handleAdminSubmit} className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Email Address</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input w-full"
                placeholder="owner@yourshop.com"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Password</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input w-full"
                placeholder="••••••••"
              />
            </div>

            <button type="submit" disabled={loading} className="btn-primary w-full py-2.5 font-medium mt-2 shadow-sm">
              {loading ? "Signing in..." : "Sign in"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleStaffSubmit} className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Phone Number</label>
              <input
                type="tel"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="input w-full font-mono"
                placeholder="10-digit number"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">4-Digit PIN</label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={4}
                required
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                className="input w-full text-center font-mono tracking-[0.5em]"
                placeholder="••••"
              />
            </div>

            <button type="submit" disabled={loading} className="btn-primary w-full py-2.5 font-medium mt-2 shadow-sm">
              {loading ? "Signing in..." : "Clock In / Sign in"}
            </button>
          </form>
        )}

        {mode === "admin" && (
          <div className="mt-4 text-center">
            <Link to="/forgot-password" className="text-xs text-gray-500 hover:text-brand-primary transition-colors">
              Forgot password?
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
