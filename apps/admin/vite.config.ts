import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // Leave unset for local dev / a standalone deploy, where it defaults to root.
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [react()],
  server: {
    // Honor the PORT env var (set by the dev-preview harness's autoPort
    // reassignment) instead of Vite's own silent increment-on-conflict.
    port: process.env.PORT ? Number(process.env.PORT) : 5173,
    strictPort: true,
  },
})
