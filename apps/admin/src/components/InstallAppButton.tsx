import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as any).standalone === true;
}
function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}
function isAndroid() {
  return /android/i.test(navigator.userAgent);
}

type HelpKind = "ios" | "android" | "desktop";

const HELP_STEPS: Record<HelpKind, { title: string; steps: string[]; note: string }> = {
  ios: {
    title: "Install on iPhone / iPad",
    steps: ["Tap the Share button in Safari's toolbar.", "Scroll down and tap Add to Home Screen.", "Tap Add — the app icon appears on your Home Screen."],
    note: "This only works in Safari, not other iPhone browsers.",
  },
  android: {
    title: "Install on Android",
    steps: [
      "Tap the ⋮ menu in the top-right of your browser.",
      "Tap Install app (or Add to Home screen).",
      "Confirm — the app icon appears on your Home Screen.",
    ],
    note: "In Chrome this menu option only appears after the page has fully loaded once.",
  },
  desktop: {
    title: "Install on this computer",
    steps: [
      "Look for an install icon (a monitor with a down-arrow) at the right edge of the address bar.",
      "If you don't see it, open the browser menu (⋮) and look for Install Sai Communication… or Apps → Install this site as an app.",
    ],
    note: "Works in Chrome and Edge; other browsers don't support installing sites as apps.",
  },
};

/**
 * "Install App" affordance shown in the admin and staff headers.
 *
 * Chrome/Edge/Android fire `beforeinstallprompt` when the page qualifies (manifest + service worker
 * present, and the browser's own engagement heuristics are met) — when that has fired, our button
 * triggers that real native prompt directly. Until then — or on a browser that never fires it, like
 * iOS Safari or desktop Firefox — the button instead shows manual steps for that platform, so the
 * option is always visible and always does something, rather than silently disappearing while
 * waiting on a browser signal the person has no way to see.
 *
 * Stays visible on every visit until the app is actually installed (standalone display mode) — closing
 * the help dialog only closes that dialog, it does not hide the button.
 */
export function InstallAppButton() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [helpKind, setHelpKind] = useState<HelpKind | null>(null);
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

  if (installed) return null;

  async function install() {
    if (deferred) {
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      if (outcome === "accepted") setInstalled(true);
      setDeferred(null);
    } else {
      setHelpKind(isIos() ? "ios" : isAndroid() ? "android" : "desktop");
    }
  }

  const help = helpKind ? HELP_STEPS[helpKind] : null;

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

      {help && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/40 p-4 sm:items-center" onClick={() => setHelpKind(null)}>
          <div className="w-full max-w-xs rounded-2xl bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-serif text-sm font-semibold text-gray-800">{help.title}</h3>
              <button onClick={() => setHelpKind(null)} aria-label="Close"><X size={16} className="text-gray-400" /></button>
            </div>
            <ol className="list-inside list-decimal space-y-1.5 text-sm text-gray-600">
              {help.steps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
            <p className="mt-2 text-[11px] text-gray-400">{help.note}</p>
          </div>
        </div>
      )}
    </>
  );
}
