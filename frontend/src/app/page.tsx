import Link from "next/link";

import { env } from "@/lib/env";

export default function HomePage() {
  return (
    <main className="min-h-screen px-6 py-8">
      <section className="surface-card-strong relative mx-auto max-w-7xl overflow-hidden px-8 py-12">
        <div className="mx-auto flex max-w-5xl flex-col items-center text-center">
          <p className="eyebrow">Liga MX · Quiniela Oficial</p>
          <h1 className="headline-glow mt-6 text-5xl font-semibold leading-[0.92] text-ink md:text-7xl">
            Beto's Bet
          </h1>
          <p className="mt-4 max-w-2xl text-lg text-steel">
            La quiniela de Liga MX con picks, resultados oficiales, tabla general y toda la energia
            del torneo en una sola experiencia.
          </p>

          <div className="mt-10 flex flex-col items-center gap-5 md:flex-row md:gap-8">
            <div className="flex min-h-[180px] min-w-[180px] items-center justify-center rounded-[30px] border border-white/10 bg-night/30 p-6 backdrop-blur-md">
              {env.betoImageUrl ? (
                <img
                  src={env.betoImageUrl}
                  alt="Beto"
                  className="h-36 w-36 object-contain"
                />
              ) : (
                <div className="flex h-36 w-36 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-2xl font-semibold text-steel">
                  Beto
                </div>
              )}
            </div>
            <div className="flex min-h-[180px] min-w-[180px] items-center justify-center rounded-[30px] border border-white/10 bg-night/30 p-6 backdrop-blur-md">
              {env.ligaMxLogoUrl ? (
                <img
                  src={env.ligaMxLogoUrl}
                  alt="Liga MX"
                  className="h-32 w-32 object-contain"
                />
              ) : (
                <div className="flex h-32 w-32 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-2xl font-semibold text-steel">
                  MX
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

          <div className="mt-12 grid w-full gap-4 md:grid-cols-2">
            {[
              "Cierre automatico de picks por partido",
              "Tabla general y lider semanal",
              "Resultados oficiales publicados por admin",
              "Dashboard listo para temporada completa",
            ].map((item) => (
              <div key={item} className="stat-tile text-left">
                <p className="text-sm uppercase tracking-[0.25em] text-steel">V1</p>
                <p className="mt-4 text-xl font-medium text-ink">{item}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
