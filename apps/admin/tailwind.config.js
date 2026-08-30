/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          // Anchored on indigo for a richer, more retail-modern feel than the
          // old flat blue. `primary` is the interactive accent used across
          // buttons, links, and active nav.
          primary: "#4F46E5",
          primaryDark: "#4338CA",
          success: "#059669",
          warning: "#D97706",
          danger: "#DC2626",
          // Per-stat accent tones (used on Dashboard cards + icon chips).
          revenue: "#059669", // emerald — money in
          profit: "#4F46E5", // indigo — margin
          stock: "#0EA5E9", // sky — inventory
          repair: "#F59E0B", // amber — service jobs
        },
        page: "#F6F7FB",
        card: "#FFFFFF",
        // Sidebar: deep graphite (not generic slate-blue) with a warm gold
        // accent — ties the Admin Portal to the same premium identity as the
        // customer website instead of looking like an unrelated SaaS template.
        sidebar: "#1A1712",
        sidebarHover: "#282319",
        gold: "#C9975A",
        goldDim: "#8A6B3F",
        border: "#E5E7EB",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      borderRadius: {
        card: "14px",
      },
      boxShadow: {
        card: "0 1px 2px 0 rgb(16 24 40 / 0.04), 0 1px 3px 0 rgb(16 24 40 / 0.06)",
        cardHover: "0 4px 12px -2px rgb(16 24 40 / 0.10)",
      },
      spacing: {
        sidebar: "220px",
        topbar: "56px",
      },
    },
  },
  plugins: [],
};
