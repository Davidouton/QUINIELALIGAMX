"use client";

import { useEffect } from "react";
import Link from "next/link";

import { env } from "@/lib/env";

export default function HomePage() {
  useEffect(() => {
    const search = window.location.search;
    const hash = window.location.hash;
    const searchParams = new URLSearchParams(search);
    const hashParams = new URLSearchParams(hash.replace(/^#/, ""));
    const type = searchParams.get("type");
    const code = searchParams.get("code");
    const tokenHash = searchParams.get("token_hash");
    const hashType = hashParams.get("type");
    const accessToken = hashParams.get("access_token");
    const isPasswordSetup = type === "recovery" || type === "invite";
    const isHashPasswordSetup = hashType === "recovery" || hashType === "invite";

    if (code || (tokenHash && isPasswordSetup)) {
      window.location.replace(`/auth/confirm${search}`);
      return;
    }

    if (isPasswordSetup || isHashPasswordSetup || accessToken) {
      window.location.replace(`/reset-password${search}${hash}`);
    }
  }, []);

  return (
    <main className="min-h-screen px-6 py-8">
      <section className="surface-card-strong relative mx-auto max-w-7xl overflow-hidden px-8 py-12">
        <div className="mx-auto flex max-w-5xl flex-col items-center text-center">
          <h1 className="headline-glow text-5xl font-semibold leading-[0.92] text-ink md:text-7xl">
            El Quinielón
          </h1>

          <div className="mt-8 flex justify-center">
            <div className="flex h-52 w-52 items-center justify-center rounded-full bg-white p-2 shadow-[0_24px_80px_rgba(0,0,0,0.35)]">
              {env.worldCupLogoUrl ? (
                <img
                  src={env.worldCupLogoUrl}
                  alt="FIFA World Cup"
                  className="h-full w-full object-contain drop-shadow-[0_10px_24px_rgba(0,0,0,0.16)]"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center rounded-full text-2xl font-semibold text-night">
                  WC
                </div>
              )}
            </div>
          </div>

          <div className="mt-10 flex flex-wrap justify-center gap-4">
            <Link
              href="/register"
              className="primary-button"
            >
              Crear cuenta
            </Link>
            <Link
              href="/login"
              className="secondary-button"
            >
              Iniciar sesion
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
