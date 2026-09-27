import { useState } from "react";
import { Download, Smartphone } from "lucide-react";
import { useInstallPrompt } from "../lib/useInstallPrompt";
import { InstallHintToast } from "./InstallHintToast";

/**
 * The one prominent "Download App" call-out on the Home page. Same underlying install state as the
 * header button (useInstallPrompt) — hides itself the moment the app is actually installed.
 */
export function InstallAppCard() {
  const { installed, install } = useInstallPrompt();
  const [showHint, setShowHint] = useState(false);

  if (installed) return null;

  async function handleClick() {
    const outcome = await install();
    if (outcome === "unavailable") setShowHint(true);
  }

  return (
    <>
      <div className="relative flex items-center justify-between gap-3 overflow-hidden rounded-2xl bg-sidebar p-4 text-white">
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: "radial-gradient(260px circle at 90% 0%, rgba(201,151,90,0.22), transparent 70%)" }}
        />
        <div className="relative flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10">
            <Smartphone size={19} />
          </span>
          <div>
            <div className="font-serif text-sm font-semibold">Get the app</div>
            <div className="text-xs text-white/60">Faster, works offline, no browser tabs to hunt for.</div>
          </div>
        </div>
        <button
          onClick={handleClick}
          className="relative flex shrink-0 items-center gap-1.5 rounded-lg bg-gradient-to-br from-gold to-goldDim px-3 py-2 text-xs font-semibold text-white shadow-sm"
        >
          <Download size={14} />
          Download App
        </button>
      </div>

      {showHint && <InstallHintToast onDone={() => setShowHint(false)} />}
    </>
  );
}
