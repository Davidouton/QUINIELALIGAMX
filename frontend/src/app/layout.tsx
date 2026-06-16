import type { ReactNode } from "react";
import type { Metadata } from "next";

import { OneSignalProvider } from "@/components/onesignal/onesignal-provider";

import "./globals.css";

export const metadata: Metadata = {
  title: "El Quinielón",
  description: "Quiniela profesional de FIFA World Cup con picks, resultados y leaderboards.",
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
