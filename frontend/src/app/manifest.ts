import type { MetadataRoute } from "next";

import { env } from "@/lib/env";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: env.appName,
    short_name: "Quiniela",
    description: "Picks, resultados y rankings del Mundial.",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#07111f",
    theme_color: "#07111f",
  };
}
