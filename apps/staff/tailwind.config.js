/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          primary: "#2563EB",
          success: "#16A34A",
          warning: "#D97706",
          danger: "#DC2626",
        },
        page: "#F8F9FA",
        card: "#FFFFFF",
        sidebar: "#F1F3F5",
        border: "#E5E7EB",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      borderRadius: {
        card: "12px",
      },
      spacing: {
        sidebar: "200px",
        topbar: "52px",
      },
    },
  },
  plugins: [],
};
