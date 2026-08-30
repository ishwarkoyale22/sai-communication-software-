import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Honor the PORT env var (set by the dev-preview harness's autoPort
    // reassignment) instead of Vite's own silent increment-on-conflict,
    // which can collide with the staff app's dev server.
    port: process.env.PORT ? Number(process.env.PORT) : 5173,
    strictPort: true,
  },
})
