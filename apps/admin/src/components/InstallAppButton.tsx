import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "sai_pwa_install_dismissed";

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as any).standalone === true;
}
function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

/**
 * Small "Install App" affordance shown in the admin and staff headers.
 *
 * Chrome/Edge/Android fire `beforeinstallprompt` when the page qualifies (manifest + service worker
 * present) — we hold onto that event and trigger it from our own button, since the browser's native
 * install icon is easy to miss and varies by browser. iOS Safari never fires that event (no native
 * install API), so there we show the manual "Share → Add to Home Screen" steps instead.
 *
 * Hidden entirely once the app is already running installed (standalone display mode), or after the
 * person dismisses it once (remembered on this device only — it can show again after 30 days, in case
 * it was dismissed by accident).
 */
export function InstallAppButton() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosHelp, setShowIosHelp] = useState(false);
  const [installed, setInstalled] = useState(isStandalone);

  useEffect(() => {
    if (installed) return;
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [installed]);

  const dismissedAt = Number(localStorage.getItem(DISMISS_KEY) || 0);
  const recentlyDismissed = dismissedAt && Date.now() - dismissedAt < 30 * 24 * 60 * 60 * 1000;

  if (installed || recentlyDismissed) return null;
  // Only show once we actually have something to do: a real install prompt, or iOS's manual steps.
  if (!deferred && !isIos()) return null;

  async function install() {
    if (deferred) {
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      if (outcome === "accepted") setInstalled(true);
      setDeferred(null);
    } else if (isIos()) {
      setShowIosHelp(true);
    }
  }

  function dismiss(e: React.MouseEvent) {
    e.stopPropagation();
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setDeferred(null);
    setShowIosHelp(false);
  }

  return (
    <>
      <button
        onClick={install}
        className="flex items-center gap-1.5 rounded-lg border border-brand-primary/30 bg-brand-primary/5 px-2.5 py-1.5 text-xs font-semibold text-brand-primary transition-colors hover:bg-brand-primary/10"
        title="Install this app on your device"
      >
        <Download size={13} />
        <span className="hidden sm:inline">Install App</span>
      </button>

      {showIosHelp && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/40 p-4 sm:items-center" onClick={() => setShowIosHelp(false)}>
          <div className="w-full max-w-xs rounded-2xl bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-serif text-sm font-semibold text-gray-800">Install on iPhone / iPad</h3>
              <button onClick={dismiss} aria-label="Close"><X size={16} className="text-gray-400" /></button>
            </div>
            <ol className="list-inside list-decimal space-y-1.5 text-sm text-gray-600">
              <li>
                Tap the <b>Share</b> button in Safari's toolbar.
              </li>
              <li>
                Scroll down and tap <b>Add to Home Screen</b>.
              </li>
              <li>Tap <b>Add</b> — the app icon appears on your Home Screen.</li>
            </ol>
            <p className="mt-2 text-[11px] text-gray-400">This only works in Safari, not other iPhone browsers.</p>
          </div>
        </div>
      )}
    </>
  );
}
