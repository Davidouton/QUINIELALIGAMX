import type { ReactNode } from "react";
import type { Metadata, Viewport } from "next";

import { OneSignalProvider } from "@/components/onesignal/onesignal-provider";

import "./globals.css";

export const metadata: Metadata = {
  title: "El Quinielón",
  description: "Quiniela profesional con picks, resultados, survivor y rankings multi torneo.",
  applicationName: "El Quinielón",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "El Quinielón",
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [
      { url: "/app-icon/32", sizes: "32x32", type: "image/png" },
      { url: "/app-icon/192", sizes: "192x192", type: "image/png" },
      { url: "/app-icon/512", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/app-icon/180", sizes: "180x180", type: "image/png" },
    ],
    shortcut: ["/app-icon/32"],
  },
};

export const viewport: Viewport = {
  themeColor: "#07111f",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="es">
      <body>
        <OneSignalProvider>{children}</OneSignalProvider>
      </body>
    </html>
  );
}
