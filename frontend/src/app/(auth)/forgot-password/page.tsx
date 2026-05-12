"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { env } from "@/lib/env";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { getBrowserSession } from "@/lib/supabase/session";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
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
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${env.siteUrl}/reset-password`,
    });

    setLoading(false);
    if (resetError) {
      setError(resetError.message);
      return;
    }

    setMessage("Si el correo existe, te enviamos un enlace para restablecer la contrasena.");
  }

  if (checkingSession) {
    return <main className="mx-auto flex min-h-screen max-w-lg items-center px-6 py-12 text-sm text-ink/60">Validando sesion...</main>;
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-lg items-center px-6 py-12">
      <form onSubmit={handleSubmit} className="surface-card-strong w-full p-8">
        <p className="eyebrow">Recuperacion</p>
        <h1 className="mt-4 text-4xl font-semibold text-ink">Restablecer contrasena</h1>
        <p className="mt-3 text-sm text-steel">
          Ingresa tu correo y te mandamos un enlace para elegir una nueva clave.
        </p>
        <div className="mt-8 space-y-5">
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            type="email"
            placeholder="Correo"
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
          {loading ? "Enviando..." : "Enviar enlace"}
        </button>
        <p className="mt-4 text-sm text-steel">
          Ya la recordaste? <Link href="/login" className="text-coral">Volver a iniciar sesion</Link>
        </p>
      </form>
    </main>
  );
}
