import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { preloadCurrentRoute, warmCommonPages } from './preload'

// Start fetching this page's code now, in parallel with the sign-in check, instead of after it.
preloadCurrentRoute()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

warmCommonPages()
