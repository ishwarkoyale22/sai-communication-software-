import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useStaffAuth } from "../staff/context/StaffAuthContext";
import { AlertCircle, CheckCircle } from "lucide-react";

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
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-page px-4 py-10">
      {/* Atmosphere — soft gold + deep-blue glows behind the card, echoing
          the sidebar's medallion glow so the login screen reads as part of
          the same brand instead of a bare form on a flat background. */}
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div
          className="absolute -left-32 -top-32 h-[420px] w-[420px] rounded-full opacity-50 blur-3xl"
          style={{ background: "radial-gradient(circle, rgba(201,151,90,0.35), transparent 70%)" }}
        />
        <div
          className="absolute -bottom-40 -right-32 h-[460px] w-[460px] rounded-full opacity-40 blur-3xl"
          style={{ background: "radial-gradient(circle, rgba(31,58,138,0.25), transparent 70%)" }}
        />
      </div>

      <div className="relative w-full max-w-sm">
        {/* Card — glass surface with a diagonal gloss sheen and a
            colour-tinted floating shadow instead of a flat white box.
            Gently hovers in place at rest, and lifts further with a
            brighter gold-tinted glow on mouse hover. */}
        <div
          className="group relative overflow-hidden rounded-3xl border border-white/60 bg-white/90 p-7 shadow-[0_30px_70px_-20px_rgba(31,58,138,0.35)] backdrop-blur-xl transition-[transform,box-shadow,border-color] duration-500 ease-out animate-card-float hover:-translate-y-2 hover:scale-[1.01] hover:border-gold/50 hover:shadow-[0_40px_90px_-16px_rgba(201,151,90,0.45)] before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-24 before:bg-gradient-to-b before:from-white/70 before:to-transparent before:content-['']"
        >
          <div className="relative mb-6 text-center">
            {/* Logo orb — the brand's own "S" medallion (same mark as the
                sidebar/footer), as a glossy gradient sphere with a highlight,
                in place of a generic icon. */}
            <div className="relative mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full border border-gold/40 bg-gradient-to-br from-gold via-gold to-goldDim shadow-[0_8px_20px_-6px_rgba(201,151,90,0.6)]">
              <div className="pointer-events-none absolute left-2 top-1.5 h-4 w-6 rounded-full bg-white/50 blur-[3px]" />
              <span className="relative font-serif text-2xl font-bold text-sidebar">S</span>
            </div>
            <h1 className="font-serif text-2xl font-semibold text-gray-900">Sai Communication</h1>
            <p className="mt-1 text-xs font-medium uppercase tracking-wider text-gold">
              {mode === "admin" ? "Retail ERP Admin Portal" : "Staff Portal Login"}
            </p>
          </div>

          {/* Segmented mode switch — glossy active pill with a lifted shadow */}
          <div className="relative mb-6 grid grid-cols-2 gap-1 rounded-full bg-accent p-1">
            <button
              type="button"
              onClick={() => {
                setMode("admin");
                setError(null);
                setSuccess(null);
              }}
              className={`relative rounded-full py-2 text-xs font-semibold transition-all duration-200 ${
                mode === "admin"
                  ? "bg-white text-brand-primary shadow-[0_4px_10px_-2px_rgba(31,58,138,0.25)]"
                  : "text-gray-500 hover:text-gray-700"
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
              className={`relative rounded-full py-2 text-xs font-semibold transition-all duration-200 ${
                mode === "staff"
                  ? "bg-white text-brand-primary shadow-[0_4px_10px_-2px_rgba(31,58,138,0.25)]"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              Staff Login
            </button>
          </div>

          {error && (
            <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-brand-danger">
              <AlertCircle size={15} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div className="mb-4 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700">
              <CheckCircle size={15} className="shrink-0" />
              <span>{success}</span>
            </div>
          )}

          {mode === "admin" ? (
            <form onSubmit={handleAdminSubmit} className="space-y-3.5">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-600">Email Address</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="input-glossy"
                  placeholder="owner@yourshop.com"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-600">Password</label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input-glossy"
                  placeholder="••••••••"
                />
              </div>

              <button type="submit" disabled={loading} className="btn-glossy mt-2">
                {loading && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />}
                {loading ? "Signing in..." : "Sign in"}
              </button>
            </form>
          ) : (
            <form onSubmit={handleStaffSubmit} className="space-y-3.5">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-600">Phone Number</label>
                <input
                  type="tel"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="input-glossy font-mono"
                  placeholder="10-digit number"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-600">4-Digit PIN</label>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  required
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  className="input-glossy text-center font-mono tracking-[0.5em]"
                  placeholder="••••"
                />
              </div>

              <button type="submit" disabled={loading} className="btn-glossy mt-2">
                {loading && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />}
                {loading ? "Signing in..." : "Clock In / Sign in"}
              </button>
            </form>
          )}

          {mode === "admin" && (
            <div className="mt-4 text-center">
              <Link to="/forgot-password" className="text-xs text-gray-500 transition-colors hover:text-brand-primary">
                Forgot password?
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
