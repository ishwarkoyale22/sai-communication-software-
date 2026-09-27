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
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.warn("[pwa] service worker registration failed:", err)
    })
  })
}
