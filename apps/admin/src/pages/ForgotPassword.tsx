import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";

export function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    // The reset link Supabase sends must land back at /reset-password on this
    // exact origin — so the Admin Portal's own JS picks up the recovery token
    // and lets the user set a new password client-side (no server involved).
    const redirectTo = `${window.location.origin}/reset-password`;
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });

    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    // Supabase intentionally responds success even if the email doesn't exist,
    // to avoid leaking which accounts are registered. So we always show the
    // same "check your inbox" message.
    setSent(true);
  }

  return (
    <div className="flex h-screen items-center justify-center bg-page">
      <div className="card w-80 p-6">
        <h1 className="mb-1 text-lg font-semibold text-gray-800">Sai Communication</h1>
        <p className="mb-5 text-sm text-gray-500">Reset admin password</p>

        {sent ? (
          <>
            <p className="mb-4 text-sm text-gray-700">
              If an account exists for <span className="font-medium">{email}</span>, a password
              reset link has been sent. Open the email on this device and click the link — it
              will bring you back here to set a new password.
            </p>
            <Link to="/login" className="btn-secondary block w-full text-center">
              Back to sign in
            </Link>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <label className="mb-1 block text-xs font-medium text-gray-600">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mb-4 w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm outline-none focus:border-brand-primary"
              placeholder="owner@yourshop.com"
              autoFocus
            />

            {error && <p className="mb-3 text-xs text-brand-danger">{error}</p>}

            <button type="submit" disabled={loading} className="btn-primary w-full">
              {loading ? "Sending…" : "Send reset link"}
            </button>

            <Link to="/login" className="mt-3 block text-center text-xs text-gray-500 hover:text-brand-primary">
              Back to sign in
            </Link>
          </form>
        )}
      </div>
    </div>
  );
}
