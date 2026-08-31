import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // Set by the unified Vercel build (see /vercel-build.sh) when this app is
  // deployed alongside apps/admin from a single project, so it's served at
  // /staff/* instead of the root — leave unset for local dev / a standalone
  // deploy, where it defaults to root as before.
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [react()],
  server: {
    // Honor the PORT env var (set by the dev-preview harness's autoPort
    // reassignment) instead of Vite's own silent increment-on-conflict,
    // which can collide with the admin app's dev server.
    port: process.env.PORT ? Number(process.env.PORT) : 5174,
    strictPort: true,
  },
})
