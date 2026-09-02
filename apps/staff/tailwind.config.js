/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          // "Warm Brand-Aligned" palette — matches the admin portal and the
          // customer website, so all three surfaces read as one product.
          primary: "#1F3A8A",
          success: "#059669",
          warning: "#D97706",
          danger: "#DC2626",
        },
        page: "#FBF9F6",
        card: "#FFFFFF",
        sidebar: "#1A1712",
        gold: "#C9975A",
        goldDim: "#8A6B3F",
        accent: "#F6F1E7",
        border: "#E5E0D8",
      },
      fontFamily: {
        sans: ["Manrope", "ui-sans-serif", "system-ui", "sans-serif"],
        serif: ["Fraunces", "ui-serif", "Georgia", "serif"],
      },
      borderRadius: {
        card: "10px",
      },
      spacing: {
        sidebar: "200px",
        topbar: "56px",
      },
    },
  },
  plugins: [],
};
