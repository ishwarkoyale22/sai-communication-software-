import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { AlertCircle, CheckCircle, ShieldCheck } from "lucide-react";

export function Login() {
  const { session, signIn } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // If already authenticated, redirect to dashboard
  useEffect(() => {
    if (session) {
      navigate("/", { replace: true });
    }
  }, [session, navigate]);

  async function handleSubmit(e: FormEvent) {
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

  return (
    <div className="flex min-h-screen items-center justify-center bg-page px-4">
      <div className="card w-full max-w-sm p-6 shadow-lg border border-border">
        <div className="text-center mb-5">
          <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-brand-primary/10 text-brand-primary">
            <ShieldCheck size={22} />
          </div>
          <h1 className="text-lg font-bold text-gray-800">Sai Communication</h1>
          <p className="text-xs text-gray-500">Retail ERP Admin Portal</p>
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

        <form onSubmit={handleSubmit} className="space-y-3">
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

          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full py-2.5 font-medium mt-2 shadow-sm"
          >
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>

        <div className="mt-4 text-center">
          <Link
            to="/forgot-password"
            className="text-xs text-gray-500 hover:text-brand-primary transition-colors"
          >
            Forgot password?
          </Link>
        </div>
      </div>
    </div>
  );
}
