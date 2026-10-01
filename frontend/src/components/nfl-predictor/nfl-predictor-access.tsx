"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { backendFetch } from "@/lib/api/backend";
import { getBrowserAccessToken } from "@/lib/supabase/session";
import type { Me } from "@/types/api";
import { NFLPredictorPage } from "./nfl-predictor-page";

export function NFLPredictorAccess() {
  const [allowed, setAllowed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    async function checkAccess() {
      try {
        const token = await getBrowserAccessToken();
        const me = await backendFetch<Me>("/me", token, { signal: controller.signal });
        if (!controller.signal.aborted) setAllowed(me.role_code === "master_admin");
      } catch {
        if (!controller.signal.aborted) setError("No se pudo verificar tu acceso. Vuelve a iniciar sesión.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void checkAccess();
    return () => controller.abort();
  }, []);

  return <div className="space-y-5">
    <Link href="/dashboard/quiniela-plus" className="text-sm text-steel hover:text-ink">← Quiniela+</Link>
    {loading ? <p className="text-sm text-steel">Verificando acceso…</p> : allowed ? <NFLPredictorPage /> :
      <p role="alert" className="text-sm text-coral">{error || "Predictor NFL está disponible solo para super admin."}</p>}
  </div>;
}
