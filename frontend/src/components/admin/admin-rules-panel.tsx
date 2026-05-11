"use client";

import { FormEvent, useEffect, useState } from "react";

import { backendFetch } from "@/lib/api/backend";
import { getBrowserAccessToken } from "@/lib/supabase/session";
import type { RulePage } from "@/types/api";

type FormState = {
  title: string;
  version_label: string;
  content_markdown: string;
};

const initialForm: FormState = {
  title: "Reglamento",
  version_label: "Beta 1.3",
  content_markdown: "",
};

export function AdminRulesPanel() {
  const [form, setForm] = useState<FormState>(initialForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function loadRulePage() {
    const accessToken = await getBrowserAccessToken();
    const data = await backendFetch<RulePage>("/admin/rules", accessToken);
    setForm({
      title: data.title,
      version_label: data.version_label ?? "",
      content_markdown: data.content_markdown,
    });
  }

  useEffect(() => {
    async function load() {
      try {
        await loadRulePage();
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "No se pudo cargar el reglamento");
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const accessToken = await getBrowserAccessToken();
      await backendFetch<RulePage>("/admin/rules", accessToken, {
        method: "PUT",
        body: JSON.stringify({
          title: form.title,
          version_label: form.version_label || null,
          content_markdown: form.content_markdown,
        }),
      });
      await loadRulePage();
      setMessage("Reglamento actualizado.");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo guardar el reglamento");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="space-y-5">
        <div>
          <h2 className="text-xl font-semibold text-ink">Editor de reglamento</h2>
          <p className="mt-1 max-w-2xl text-sm text-steel">
            Aqui puedes pegar y actualizar el reglamento vivo que vera todo el torneo.
          </p>
        </div>

        {loading ? <p className="mt-5 text-sm text-steel">Cargando reglamento...</p> : null}

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
            <input
              value={form.title}
              onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
              className="field-control"
              placeholder="Reglamento"
              required
            />
            <input
              value={form.version_label}
              onChange={(event) => setForm((current) => ({ ...current, version_label: event.target.value }))}
              className="field-control"
              placeholder="Beta 1.3"
            />
          </div>

          <textarea
            value={form.content_markdown}
            onChange={(event) => setForm((current) => ({ ...current, content_markdown: event.target.value }))}
            className="field-control min-h-[420px] resize-y leading-7"
            placeholder={"1. Sistema de puntos\n2. Cierres de picks\n3. Publicacion de resultados\n4. Premios y desempates"}
          />

          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={saving || loading} className="app-pill-active px-4 disabled:opacity-60">
              {saving ? "Guardando..." : "Guardar reglamento"}
            </button>
            {message ? <p className="text-sm text-moss">{message}</p> : null}
            {error ? <p className="text-sm text-coral">{error}</p> : null}
          </div>
        </form>
      </section>
    </div>
  );
}
