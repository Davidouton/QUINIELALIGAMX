"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { env } from "@/lib/env";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { getBrowserSession } from "@/lib/supabase/session";

export default function RegisterPage() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
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
    setMessage(null);

    const supabase = createSupabaseBrowserClient();
    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${env.siteUrl}/auth/confirm`,
        data: {
          display_name: displayName,
        },
      },
    });

    setLoading(false);
    if (signUpError) {
      setError(signUpError.message);
      return;
    }

    if (data.session) {
      router.push("/dashboard");
      router.refresh();
      return;
    }

    setMessage("Cuenta creada. Si tu proyecto exige confirmacion por email, revisa tu bandeja.");
    router.push("/login?registered=1");
    router.refresh();
  }

  if (checkingSession) {
    return <main className="mx-auto flex min-h-screen max-w-lg items-center px-6 py-12 text-sm text-ink/60">Validando sesion...</main>;
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-lg items-center px-6 py-12">
      <form onSubmit={handleSubmit} className="surface-card-strong w-full p-8">
        <p className="eyebrow">Registro</p>
        <h1 className="mt-4 text-4xl font-semibold text-ink">Crear cuenta</h1>
        <p className="mt-3 text-sm text-steel">Arma tu perfil y entra a competir desde la primera jornada.</p>
        <div className="mt-8 space-y-5">
          <input
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            type="text"
            placeholder="Nombre visible"
            className="field-control"
            required
          />
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
        {error ? <p className="mt-4 text-sm text-coral">{error}</p> : null}
        {message ? <p className="mt-4 text-sm text-moss">{message}</p> : null}
        <button
          type="submit"
          disabled={loading}
          className="primary-button mt-8 w-full disabled:opacity-60"
        >
          {loading ? "Creando..." : "Crear cuenta"}
        </button>
        <p className="mt-4 text-sm text-steel">
          Ya tienes cuenta? <Link href="/login" className="text-coral">Inicia sesion</Link>
        </p>
      </form>
    </main>
  );
}
