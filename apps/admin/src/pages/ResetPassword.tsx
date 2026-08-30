import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

/**
 * Landing page for the password-reset link Supabase sends in email.
 *
 * How this works, all client-side (no server, no service-role key):
 *   1. User clicks the emailed link, which lands here with the recovery
 *      access_token in the URL fragment.
 *   2. supabase-js parses that fragment automatically and fires an
 *      onAuthStateChange event with type "PASSWORD_RECOVERY", which briefly
 *      grants a "recovery" session — the only thing that session can do is
 *      call updateUser({ password }).
 *   3. We collect a new password, call supabase.auth.updateUser({ password }),
 *      then sign out and send the user back to /login to sign in fresh.
 *
 * The password never leaves the user's browser except in the single POST
 * to Supabase Auth. Claude Code never sees it.
 */
export function ResetPassword() {
  const navigate = useNavigate();
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [initialError, setInitialError] = useState<string | null>(null);

  useEffect(() => {
    // Two paths for the recovery session to become available:
    //   - the onAuthStateChange PASSWORD_RECOVERY event (fired when the token
    //     in the URL fragment is parsed)
    //   - getSession(), for the case where we hit this page after the event
    //     already fired (e.g. navigating away and back)
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setRecoveryReady(true);
      }
    });

    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setRecoveryReady(true);
    });

    // If the URL contains an error (e.g. expired/invalid recovery link),
    // Supabase puts it in the fragment as ?error=...&error_description=...
    const hash = window.location.hash.replace(/^#/, "");
    const params = new URLSearchParams(hash);
    const err = params.get("error_description") ?? params.get("error");
    if (err) setInitialError(err.replace(/\+/g, " "));

    return () => sub.subscription.unsubscribe();
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }

    // Sign out of the recovery session so the user has to log in fresh with
    // the new password — this proves the reset actually worked.
    await supabase.auth.signOut();
    setDone(true);
    setTimeout(() => navigate("/login", { replace: true }), 2500);
  }

  return (
    <div className="flex h-screen items-center justify-center bg-page">
      <div className="card w-80 p-6">
        <h1 className="mb-1 text-lg font-semibold text-gray-800">Sai Communication</h1>
        <p className="mb-5 text-sm text-gray-500">Set a new password</p>

        {done ? (
          <>
            <p className="mb-4 text-sm text-brand-success">
              Password updated. Redirecting you to sign in…
            </p>
            <Link to="/login" className="btn-primary block w-full text-center">
              Go to sign in
            </Link>
          </>
        ) : initialError ? (
          <>
            <p className="mb-3 text-sm text-brand-danger">{initialError}</p>
            <p className="mb-4 text-xs text-gray-500">
              The reset link may have expired or already been used. Request a new one.
            </p>
            <Link to="/forgot-password" className="btn-primary block w-full text-center">
              Request new link
            </Link>
          </>
        ) : !recoveryReady ? (
          <p className="text-sm text-gray-500">
            Waiting for the reset link to be verified… If this doesn't clear in a few seconds,
            the link may have expired. <Link to="/forgot-password" className="text-brand-primary hover:underline">Request a new one</Link>.
          </p>
        ) : (
          <form onSubmit={handleSubmit}>
            <label className="mb-1 block text-xs font-medium text-gray-600">New password</label>
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mb-3 w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm outline-none focus:border-brand-primary"
              autoFocus
            />

            <label className="mb-1 block text-xs font-medium text-gray-600">Confirm new password</label>
            <input
              type="password"
              required
              minLength={8}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="mb-4 w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm outline-none focus:border-brand-primary"
            />

            {error && <p className="mb-3 text-xs text-brand-danger">{error}</p>}

            <button type="submit" disabled={loading} className="btn-primary w-full">
              {loading ? "Updating…" : "Update password"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
