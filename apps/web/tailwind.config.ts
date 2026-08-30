import type { Config } from "tailwindcss";

// "Heritage Boutique" design system — see project brief. Warm ivory ground,
// deep heritage blue + gold accent, serif display type, hairline borders,
// small corner radii instead of the generic-SaaS rounded-pill look.
const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "#FBF9F6",
        foreground: "#1B1B1B",
        card: "#FFFFFF",
        primary: {
          DEFAULT: "#1F3A8A",
          glow: "#3355C0",
        },
        secondary: "#F2EDE4",
        muted: {
          DEFAULT: "#F2EDE4",
          foreground: "#78716A",
        },
        accent: "#F6F1E7",
        gold: "#B8894B",
        border: "#E5E0D8",
        success: {
          bg: "#E5F7EC",
          fg: "#14804A",
        },
        destructive: "#DC2626",
      },
      fontFamily: {
        display: ["var(--font-fraunces)", "ui-serif", "Georgia", "serif"],
        sans: ["var(--font-manrope)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-plex-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      borderRadius: {
        DEFAULT: "0.375rem", // 6px — global default, small/sharp not pill
        btn: "3px",
        card: "0.5rem",
        lg: "0.75rem",
      },
      boxShadow: {
        hairline: "0 1px 2px rgba(27, 27, 27, 0.03)",
        lift: "0 12px 32px -8px rgba(31, 58, 138, 0.18)",
      },
      backgroundImage: {
        "hero-ivory": "linear-gradient(180deg, #FBF7EE 0%, #F7F2E6 100%)",
      },
      letterSpacing: {
        caption: "0.2em",
      },
    },
  },
  plugins: [],
};
export default config;
