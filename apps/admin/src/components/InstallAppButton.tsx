import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { useInstallPrompt } from "../lib/useInstallPrompt";
import { InstallHintToast } from "./InstallHintToast";

/**
 * The one "Download App" button — shown in the header on every page. One tap: if the browser has a
 * real install prompt ready, it opens immediately, no dialog of ours in the way. Otherwise a single-
 * line hint appears for a few seconds (see InstallHintToast); there is no other UI in between.
 */
export function InstallAppButton() {
  const { canPromptNatively, installed, installing, install } = useInstallPrompt();
  const [showHint, setShowHint] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (installed) return null;

  async function handleClick() {
    if (busy) return; // a stray double-tap must not call the native prompt twice
    setBusy(true);
    setError(null);
    const { outcome, message } = await install();
    setBusy(false);
    if (outcome === "unavailable") setShowHint(true);
    else if (outcome === "error") setError(message || "Could not open the install prompt.");
  }

  return (
    <div className="relative">
      <button
        onClick={handleClick}
        disabled={busy || installing}
        className="flex items-center gap-1.5 rounded-lg border border-brand-primary/30 bg-brand-primary/5 px-2.5 py-1.5 text-xs font-semibold text-brand-primary transition-colors hover:bg-brand-primary/10 disabled:opacity-70"
        title="Download / install this app"
      >
        {installing ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
        <span className="hidden sm:inline">{installing ? "Installing…" : canPromptNatively ? "Install App" : "Download App"}</span>
      </button>

      {error && (
        <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-md border border-red-200 bg-red-50 p-2 text-[11px] text-red-700 shadow-lg">
          {error}
        </div>
      )}
      {showHint && <InstallHintToast onDone={() => setShowHint(false)} />}
    </div>
  );
}
