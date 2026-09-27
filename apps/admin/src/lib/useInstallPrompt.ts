import { useEffect, useState } from "react";

export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

declare global {
  interface Window {
    // Captured as early as physically possible by an inline <script> in index.html, before React (or
    // its auth check, or the lazy-loaded header component) has even started — see the comment there
    // for why a React-only listener can permanently miss this event.
    __saiInstallPrompt?: BeforeInstallPromptEvent | null;
  }
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

export type InstallOutcome = "accepted" | "dismissed" | "unavailable" | "error";

/**
 * Shared "can/should we offer to install this app" state, used by both the compact header button
 * and the prominent Home-page card so they always agree on whether to show anything.
 *
 * `deferred` holds the real `beforeinstallprompt` event Chrome/Edge fire when the page qualifies —
 * calling `.prompt()` on it opens the browser's own native install dialog, with no UI of ours in the
 * way. `install()` does exactly that when it's available; when it isn't (iOS Safari never fires this
 * event; Chrome sometimes hasn't yet), it returns a platform tag instead so the caller can show the
 * smallest possible hint for that device — never a multi-step walkthrough.
 *
 * Tapping "Install" in that dialog only means the person said yes — Android then spends real time
 * afterwards actually building and installing the app in the background (a few seconds, sometimes
 * more), and that step can fail with nothing else on screen to say so. `installing` reflects that
 * in-between state; only the real `appinstalled` event (fired once Android confirms it is actually
 * done) marks it as truly installed, with a generous timeout as a fallback in case that event is ever
 * missed on some browser.
 */
export function useInstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(() => window.__saiInstallPrompt ?? null);
  const [installed, setInstalled] = useState(isStandalone);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    if (installed) return;
    // The event may already have arrived and been stashed by index.html's inline script before this
    // component ever mounted — pick it up immediately rather than waiting for it to fire again (it won't).
    if (window.__saiInstallPrompt && !deferred) setDeferred(window.__saiInstallPrompt);

    const onReady = () => setDeferred(window.__saiInstallPrompt ?? null);
    const onInstalledGlobal = () => {
      setInstalled(true);
      setInstalling(false);
      setDeferred(null);
    };
    // Also listen directly, in case this ever runs in a context without the inline script (harmless
    // redundancy — whichever listener sees it first wins, both do the same thing).
    const onPrompt = (e: Event) => {
      e.preventDefault();
      window.__saiInstallPrompt = e as BeforeInstallPromptEvent;
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("sai:bip-ready", onReady);
    window.addEventListener("sai:bip-installed", onInstalledGlobal);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalledGlobal);
    return () => {
      window.removeEventListener("sai:bip-ready", onReady);
      window.removeEventListener("sai:bip-installed", onInstalledGlobal);
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalledGlobal);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [installed]);

  async function install(): Promise<{ outcome: InstallOutcome; message?: string }> {
    if (!deferred) return { outcome: "unavailable" };
    try {
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      window.__saiInstallPrompt = null;
      setDeferred(null);
      if (outcome === "dismissed") return { outcome };
      // "accepted" — the person said yes; Android now installs it in the background. Show a brief
      // "Installing…" state and wait for the real appinstalled confirmation rather than declaring
      // success immediately, so a silent failure at this step is not indistinguishable from success.
      setInstalling(true);
      setTimeout(() => setInstalling((cur) => (cur ? false : cur)), 25000); // give up waiting after 25s
      return { outcome };
    } catch (err) {
      setDeferred(null);
      window.__saiInstallPrompt = null;
      return { outcome: "error", message: err instanceof Error ? err.message : String(err) };
    }
  }

  return { canPromptNatively: !!deferred, installed, installing, install };
}
