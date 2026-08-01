"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { env } from "@/lib/env";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { getBrowserSession } from "@/lib/supabase/session";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [showRegisteredMessage, setShowRegisteredMessage] = useState(false);
  const [authMessage, setAuthMessage] = useState<string | null>(null);

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    setShowRegisteredMessage(searchParams.get("registered") === "1");
    if (searchParams.get("reset") === "1") {
      setAuthMessage("Contrasena actualizada. Inicia sesion con tu nueva clave.");
    } else {
      setAuthMessage(searchParams.get("error"));
    }

    async function checkSession() {
      const session = await getBrowserSession();
      if (session) {
        router.replace("/dashboard");
        router.refresh();
        return;
      }
      setCheckingSession(false);
    }

    void checkSession();
  }, [router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createSupabaseBrowserClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password: password.trim(),
    });

    setLoading(false);
    if (signInError) {
      setError(signInError.message);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  if (checkingSession) {
    return <main className="mx-auto flex min-h-screen max-w-lg items-center px-6 py-12 text-sm text-ink/60">Validando sesion...</main>;
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-lg items-center px-6 py-12">
      <form onSubmit={handleSubmit} className="surface-card-strong w-full p-8">
        <div className="mb-8 flex flex-col items-center text-center">
          <p className="eyebrow">El Quinielón</p>
          <div className="mt-5 flex items-center justify-center gap-3">
            {[
              { name: "Liga MX", shortName: "LMX", src: env.ligaMxLogoUrl },
              { name: "Leagues Cup", shortName: "LC", src: env.leaguesCupLogoUrl },
              { name: "NFL", shortName: "NFL", src: env.nflLogoUrl },
            ].map((competition) => (
              <div
                key={competition.name}
                className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white p-2 shadow-[0_12px_30px_rgba(0,0,0,0.24)] sm:h-20 sm:w-20"
                title={competition.name}
              >
                {competition.src ? (
                  <img
                    src={competition.src}
                    alt={competition.name}
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <span className="text-[10px] font-semibold tracking-[0.08em] text-night">
                    {competition.shortName}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
        <p className="eyebrow">Acceso</p>
        <h1 className="mt-4 text-4xl font-semibold text-ink">Iniciar sesion</h1>
        <div className="mt-8 space-y-5">
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            type="email"
            placeholder="Correo"
            className="field-control"
            required
          />
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            placeholder="Contrasena"
            className="field-control"
            required
          />
        </div>
        <div className="mt-4 flex justify-end">
          <Link href="/forgot-password" className="text-sm text-coral transition hover:text-coral/80">
            Olvide mi contrasena
          </Link>
        </div>
        {error ? <p className="mt-4 text-sm text-coral">{error}</p> : null}
        {showRegisteredMessage ? (
          <p className="mt-4 text-sm text-moss">Cuenta creada. Inicia sesion para entrar al panel.</p>
        ) : null}
        {authMessage ? (
          <p className={`mt-4 text-sm ${authMessage.includes("actualizada") ? "text-moss" : "text-coral"}`}>
            {authMessage}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={loading}
          className="primary-button mt-8 w-full disabled:opacity-60"
        >
          {loading ? "Entrando..." : "Entrar"}
        </button>
        <p className="mt-4 text-sm text-steel">
          No tienes cuenta? <Link href="/register" className="text-coral">Registrate</Link>
        </p>
      </form>
    </main>
  );
}
