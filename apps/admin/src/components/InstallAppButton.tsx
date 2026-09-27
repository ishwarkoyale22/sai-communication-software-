import { useState } from "react";
import { Download } from "lucide-react";
import { useInstallPrompt } from "../lib/useInstallPrompt";
import { InstallHintToast } from "./InstallHintToast";

/**
 * The one "Download App" button — shown in the header on every page. One tap: if the browser has a
 * real install prompt ready, it opens immediately, no dialog of ours in the way. Otherwise a single-
 * line hint appears for a few seconds (see InstallHintToast); there is no other UI in between.
 */
export function InstallAppButton() {
  const { canPromptNatively, installed, install } = useInstallPrompt();
  const [showHint, setShowHint] = useState(false);

  if (installed) return null;

  async function handleClick() {
    const outcome = await install();
    if (outcome === "unavailable") setShowHint(true);
  }

  return (
    <>
      <button
        onClick={handleClick}
        className="flex items-center gap-1.5 rounded-lg border border-brand-primary/30 bg-brand-primary/5 px-2.5 py-1.5 text-xs font-semibold text-brand-primary transition-colors hover:bg-brand-primary/10"
        title="Download / install this app"
      >
        <Download size={13} />
        <span className="hidden sm:inline">{canPromptNatively ? "Install App" : "Download App"}</span>
      </button>

      {showHint && <InstallHintToast onDone={() => setShowHint(false)} />}
    </>
  );
}
