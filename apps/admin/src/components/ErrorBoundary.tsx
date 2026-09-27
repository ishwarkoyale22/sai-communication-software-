import { Component, type ErrorInfo, type ReactNode } from "react";

// After a new deploy, an already-open tab's in-memory chunk map points at hashed filenames the CDN no
// longer serves — the next lazy import() for a page nobody has visited yet 404s. That throw used to
// unmount the whole app with no error boundary anywhere to catch it, leaving a blank white screen that
// only a manual reload fixed. This detects that specific shape of failure and reloads once automatically
// (guarded against a reload loop) instead of making the person notice anything went wrong.
const RELOAD_GUARD_KEY = "sai_chunk_reload_at";
const RELOAD_COOLDOWN_MS = 10000;

function isChunkLoadError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /dynamically imported module|Failed to fetch|Loading chunk|Importing a module script failed/i.test(msg);
}

function reloadOnce() {
  const last = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) || 0);
  if (Date.now() - last < RELOAD_COOLDOWN_MS) return; // already just tried this — avoid a loop
  sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
  window.location.reload();
}

// Vite's own signal for this exact failure — fires before React even gets a chance to throw, so this
// catches it earlier and more reliably than the error boundary below for the common "stale chunk after
// a deploy" case. The class component stays as the general-purpose safety net for any other crash.
window.addEventListener("vite:preloadError", (event) => {
  event.preventDefault();
  reloadOnce();
});

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (isChunkLoadError(error)) {
      reloadOnce();
      return;
    }
    console.error("[app] unhandled render error:", error, info.componentStack);
  }

  render() {
    if (this.state.error && !isChunkLoadError(this.state.error)) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-page p-6 text-center">
          <img src="/logo-mark.png" alt="Sai Communication" className="h-14 w-14 rounded-full shadow-sm" />
          <div>
            <h1 className="font-serif text-lg font-semibold text-gray-800">Something went wrong</h1>
            <p className="mt-1 max-w-xs text-sm text-gray-500">
              This page hit an unexpected error. Reloading usually fixes it — your data is safe.
            </p>
          </div>
          <button
            className="btn-primary"
            onClick={() => {
              sessionStorage.removeItem(RELOAD_GUARD_KEY);
              window.location.reload();
            }}
          >
            Reload
          </button>
        </div>
      );
    }
    // A chunk-load error reloads itself above; render nothing while that happens instead of a flash of blank content.
    if (this.state.error) return null;
    return this.props.children;
  }
}
