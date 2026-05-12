"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { EmailOtpType } from "@supabase/supabase-js";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [canReset, setCanReset] = useState(false);

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const authError = searchParams.get("error");
    if (authError) {
      setError(authError);
    }

    async function bootstrapRecoverySession() {
      const supabase = createSupabaseBrowserClient();
      const code = searchParams.get("code");
      const tokenHash = searchParams.get("token_hash");
      const type = searchParams.get("type") as EmailOtpType | null;
      const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const accessToken = hashParams.get("access_token");
      const refreshToken = hashParams.get("refresh_token");
      const hashType = hashParams.get("type");

      if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (exchangeError) {
          setError(exchangeError.message);
        }
      } else if (tokenHash && type) {
        const { error: verifyError } = await supabase.auth.verifyOtp({
          type,
          token_hash: tokenHash,
        });
        if (verifyError) {
          setError(verifyError.message);
        }
      } else if (accessToken && refreshToken && hashType === "recovery") {
        const { error: setSessionError } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (setSessionError) {
          setError(setSessionError.message);
        }
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();

      setCanReset(Boolean(session));
      setCheckingSession(false);
    }

    void bootstrapRecoverySession();
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    if (password.length < 6) {
      setError("La contrasena debe tener al menos 6 caracteres.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Las contrasenas no coinciden.");
      return;
    }

    setLoading(true);
    const supabase = createSupabaseBrowserClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });

    if (updateError) {
      setLoading(false);
      setError(updateError.message);
      return;
    }

    await supabase.auth.signOut();
    setLoading(false);
    setMessage("Contrasena actualizada. Te estamos llevando al login.");
    router.replace("/login?reset=1");
    router.refresh();
  }

  if (checkingSession) {
    return <main className="mx-auto flex min-h-screen max-w-lg items-center px-6 py-12 text-sm text-ink/60">Validando enlace...</main>;
  }

  if (!canReset) {
    return (
      <main className="mx-auto flex min-h-screen max-w-lg items-center px-6 py-12">
        <div className="surface-card-strong w-full p-8">
          <p className="eyebrow">Recuperacion</p>
          <h1 className="mt-4 text-4xl font-semibold text-ink">Enlace no disponible</h1>
          <p className="mt-3 text-sm text-steel">
            El enlace de recuperacion es invalido, ya expiro o no abrio una sesion de recovery.
          </p>
          {error ? <p className="mt-4 text-sm text-coral">{error}</p> : null}
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link href="/forgot-password" className="primary-button w-full sm:w-auto">
              Pedir otro enlace
            </Link>
            <Link href="/login" className="secondary-button w-full sm:w-auto">
              Volver al login
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-lg items-center px-6 py-12">
      <form onSubmit={handleSubmit} className="surface-card-strong w-full p-8">
        <p className="eyebrow">Nueva clave</p>
        <h1 className="mt-4 text-4xl font-semibold text-ink">Elige tu nueva contrasena</h1>
        <p className="mt-3 text-sm text-steel">
          Usa una clave nueva para volver a entrar al panel sin friccion.
        </p>
        <div className="mt-8 space-y-5">
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            placeholder="Nueva contrasena"
            className="field-control"
            minLength={6}
            required
          />
          <input
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            type="password"
            placeholder="Confirmar contrasena"
            className="field-control"
            minLength={6}
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
          {loading ? "Guardando..." : "Actualizar contrasena"}
        </button>
      </form>
    </main>
  );
}
