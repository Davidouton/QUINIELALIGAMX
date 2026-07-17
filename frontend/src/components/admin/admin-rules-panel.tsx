"use client";

import { FormEvent, useEffect, useState } from "react";

import { backendFetch } from "@/lib/api/backend";
import { isSurvivorAvailableForSeason } from "@/lib/dashboard-season";
import { getBrowserAccessToken } from "@/lib/supabase/session";
import type { RulePage, Season } from "@/types/api";

type FormState = {
  title: string;
  version_label: string;
  content_markdown: string;
};

const initialForm: FormState = {
  title: "Reglamento",
  version_label: "v 1.07",
  content_markdown: "",
};

type RuleSheetOption = {
  key: string;
  seasonId: string;
  pageKind: RulePage["page_kind"];
  label: string;
};

export function AdminRulesPanel() {
  const [form, setForm] = useState<FormState>(initialForm);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [selectedSeasonId, setSelectedSeasonId] = useState("");
  const [selectedPageKind, setSelectedPageKind] = useState<RulePage["page_kind"]>("regular");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const ruleSheetOptions: RuleSheetOption[] = seasons.flatMap((season) => [
    {
      key: `${season.id}:regular`,
      seasonId: season.id,
      pageKind: "regular" as const,
      label: `${season.name} · Quiniela`,
    },
    ...(isSurvivorAvailableForSeason(season)
      ? [
          {
            key: `${season.id}:survivor`,
            seasonId: season.id,
            pageKind: "survivor" as const,
            label: `${season.name} · ${season.survivor_name ?? "Survivor"}`,
          },
        ]
      : []),
  ]);

  async function loadRulePage(seasonId?: string, pageKind: RulePage["page_kind"] = "regular") {
    const accessToken = await getBrowserAccessToken();
    const params = new URLSearchParams();
    if (seasonId) {
      params.set("season_id", seasonId);
    }
    params.set("page_kind", pageKind);
    const suffix = `?${params.toString()}`;
    const data = await backendFetch<RulePage>(`/admin/rules${suffix}`, accessToken);
    setForm({
      title: data.title,
      version_label: data.version_label ?? "",
      content_markdown: data.content_markdown,
    });
  }

  async function loadPanel(nextSeasonId?: string, nextPageKind: RulePage["page_kind"] = "regular") {
    const accessToken = await getBrowserAccessToken();
    const seasonRows = await backendFetch<Season[]>("/seasons", accessToken);
    const targetSeasonId = nextSeasonId ?? seasonRows.find((season) => season.is_active)?.id ?? seasonRows[0]?.id ?? "";
    setSeasons(seasonRows);
    setSelectedSeasonId(targetSeasonId);
    setSelectedPageKind(nextPageKind);
    await loadRulePage(targetSeasonId, nextPageKind);
  }

  useEffect(() => {
    async function load() {
      try {
        await loadPanel();
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
    if (!selectedSeasonId) {
      setError("Selecciona una temporada para editar su reglamento.");
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const accessToken = await getBrowserAccessToken();
      await backendFetch<RulePage>(
        `/admin/rules?season_id=${encodeURIComponent(selectedSeasonId)}&page_kind=${encodeURIComponent(selectedPageKind)}`,
        accessToken,
        {
          method: "PUT",
          body: JSON.stringify({
            title: form.title,
            version_label: form.version_label || null,
            content_markdown: form.content_markdown,
          }),
        },
      );
      await loadRulePage(selectedSeasonId, selectedPageKind);
      const selectedSeason = seasons.find((season) => season.id === selectedSeasonId);
      setMessage(
        `Reglamento ${selectedPageKind === "survivor" ? "de survivor" : "regular"} actualizado para ${selectedSeason?.name ?? "la temporada"}.`,
      );
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
            Aqui puedes pegar y actualizar reglamentos distintos por torneo.
          </p>
        </div>

        {loading ? <p className="mt-5 text-sm text-steel">Cargando reglamento...</p> : null}

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div className="grid gap-4 md:grid-cols-[220px_minmax(0,1fr)_220px]">
            <select
              value={selectedSeasonId && selectedPageKind ? `${selectedSeasonId}:${selectedPageKind}` : ""}
              onChange={(event) => {
                const nextOption = ruleSheetOptions.find((option) => option.key === event.target.value) ?? null;
                if (!nextOption) {
                  return;
                }
                setSelectedSeasonId(nextOption.seasonId);
                setSelectedPageKind(nextOption.pageKind);
                setLoading(true);
                setError(null);
                setMessage(null);
                void loadRulePage(nextOption.seasonId, nextOption.pageKind).finally(() => setLoading(false));
              }}
              className="field-control"
              disabled={loading || ruleSheetOptions.length === 0}
            >
              {ruleSheetOptions.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
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
              placeholder="v 1.07"
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
