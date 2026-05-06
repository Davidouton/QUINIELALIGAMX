import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "rgb(var(--app-ink-rgb) / <alpha-value>)",
        sand: "rgb(var(--app-sand-rgb) / <alpha-value>)",
        gold: "#ffd166",
        moss: "#2f5bff",
        coral: "#ff5c7a",
        night: "rgb(var(--app-night-rgb) / <alpha-value>)",
        slate: "rgb(var(--app-slate-rgb) / <alpha-value>)",
        steel: "rgb(var(--app-steel-rgb) / <alpha-value>)",
      },
      boxShadow: {
        soft: "0 30px 90px rgba(4, 10, 22, 0.45)",
      },
    },
  },
  plugins: [],
};

export default config;
