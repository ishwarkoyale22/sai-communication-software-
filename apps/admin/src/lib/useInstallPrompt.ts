import { useEffect, useState } from "react";

export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as any).standalone === true;
}
export function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}
export function isAndroid() {
  return /android/i.test(navigator.userAgent);
}

/**
 * Shared "can/should we offer to install this app" state, used by both the compact header button
 * and the prominent Home-page card so they always agree on whether to show anything.
 *
 * `deferred` holds the real `beforeinstallprompt` event Chrome/Edge fire when the page qualifies —
 * calling `.prompt()` on it opens the browser's own native install dialog, with no UI of ours in the
 * way. `install()` does exactly that when it's available; when it isn't (iOS Safari never fires this
 * event; Chrome sometimes hasn't yet), it returns a platform tag instead so the caller can show the
 * smallest possible hint for that device — never a multi-step walkthrough.
 */
export function useInstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
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

  async function install(): Promise<"accepted" | "dismissed" | "unavailable"> {
    if (!deferred) return "unavailable";
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    if (outcome === "accepted") setInstalled(true);
    setDeferred(null);
    return outcome;
  }

  return { canPromptNatively: !!deferred, installed, install };
}
