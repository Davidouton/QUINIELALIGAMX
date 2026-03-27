"use client";

import { useEffect, useState } from "react";

import { backendFetch } from "@/lib/api/backend";
import type { RulePage } from "@/types/api";

export function RulesPageContent() {
  const [rulePage, setRulePage] = useState<RulePage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const data = await backendFetch<RulePage>("/rules");
        setRulePage(data);
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "No se pudo cargar el reglamento");
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, []);

  if (loading) {
    return <p className="text-sm text-steel">Cargando reglamento...</p>;
  }

  if (error) {
    return <p className="text-sm text-coral">{error}</p>;
  }

  return (
    <div className="space-y-6">
      <section>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-semibold text-ink">{rulePage?.title || "Reglamento"}</h1>
          {rulePage?.version_label ? (
            <span className="app-pill h-9 px-3 text-[10px] uppercase tracking-[0.2em] text-steel">
              {rulePage.version_label}
            </span>
          ) : null}
        </div>
      </section>

      <section className="px-1 py-1 sm:px-3">
        {rulePage?.content_markdown?.trim() ? (
          <div className="whitespace-pre-wrap px-3 py-4 text-sm leading-7 text-ink/90">
            {rulePage.content_markdown}
          </div>
        ) : (
          <p className="px-3 py-4 text-sm text-steel">Todavia no hay reglamento cargado.</p>
        )}
      </section>
    </div>
  );
}
