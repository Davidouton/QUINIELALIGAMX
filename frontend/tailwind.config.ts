import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#f5f7ff",
        sand: "#dbe5ff",
        gold: "#ffd166",
        moss: "#2f5bff",
        coral: "#ff5c7a",
        night: "#07111f",
        slate: "#0d1a30",
        steel: "#8ea5d1",
      },
      boxShadow: {
        soft: "0 30px 90px rgba(4, 10, 22, 0.45)",
      },
    },
  },
  plugins: [],
};

export default config;
