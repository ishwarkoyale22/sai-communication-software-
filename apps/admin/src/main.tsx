import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary'
import { preloadCurrentRoute, warmCommonPages } from './preload'

// Start fetching this page's code now, in parallel with the sign-in check, instead of after it.
preloadCurrentRoute()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)

warmCommonPages()

// PWA: register the service worker after the page has loaded, so it never competes with the
// initial render for the network/CPU. Safe to call on every load — the browser no-ops when the
// registered worker is already current, and re-registers when public/sw.js has changed.
if ("serviceWorker" in navigator) {
  // A tab that was already open when a new version deployed keeps running the JS it already loaded —
  // that old code can still be mid-session when a *newer* service worker takes over in the background
  // (our sw.js calls skipWaiting()+clients.claim() specifically so it takes over promptly). Without
  // this, that tab is left running old page code against a new worker/cache until someone manually
  // reloads — this is the actual mechanism behind "the page went blank, only fixed by refreshing".
  // `controllerchange` fires exactly when that handover happens, so reload once, right then, instead
  // of waiting for the person to notice something is wrong.
  let reloadedForNewWorker = false
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloadedForNewWorker) return
    reloadedForNewWorker = true
    window.location.reload()
  })

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.warn("[pwa] service worker registration failed:", err)
    })
  })
}
