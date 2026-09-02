/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          // "Warm Brand-Aligned" palette — the customer website's Heritage
          // Boutique deep blue + gold, carried into the back office so admin,
          // staff and the storefront read as one product family.
          primary: "#1F3A8A",
          primaryDark: "#16296B",
          success: "#059669",
          warning: "#D97706",
          danger: "#DC2626",
          // Per-stat accent tones (used on Dashboard cards + icon chips).
          revenue: "#C9975A", // gold — money in
          profit: "#1F3A8A", // deep blue — margin
          stock: "#1F3A8A", // deep blue — inventory / orders
          repair: "#C9975A", // gold — service jobs
        },
        page: "#FBF9F6",
        card: "#FFFFFF",
        accent: "#F6F1E7",
        // Sidebar: deep graphite with a warm gold accent — the same premium
        // identity as the customer website's medallion motif.
        sidebar: "#1A1712",
        sidebarHover: "#282319",
        gold: "#C9975A",
        goldDim: "#8A6B3F",
        border: "#E5E0D8",
      },
      fontFamily: {
        sans: ["Manrope", "ui-sans-serif", "system-ui", "sans-serif"],
        serif: ["Fraunces", "ui-serif", "Georgia", "serif"],
      },
      borderRadius: {
        card: "10px",
      },
      boxShadow: {
        card: "0 1px 2px 0 rgb(27 27 27 / 0.04), 0 1px 3px 0 rgb(27 27 27 / 0.06)",
        cardHover: "0 4px 12px -2px rgb(27 27 27 / 0.10)",
      },
      spacing: {
        sidebar: "220px",
        topbar: "56px",
      },
    },
  },
  plugins: [],
};
