"use client";

import { useEffect, useMemo, useState } from "react";

import { backendFetch, CATALOG_CACHE_TTL_MS } from "@/lib/api/backend";
import { getLiveSeasons, resolveLiveSeason, useDashboardSeasonParam } from "@/lib/dashboard-season";
import { getBrowserAccessToken } from "@/lib/supabase/session";
import type { RulePage, Season } from "@/types/api";

export function RulesPageContent() {
  const { seasonId: seasonIdParam, competitionId, setSeasonId } = useDashboardSeasonParam();
  const [rulePage, setRulePage] = useState<RulePage | null>(null);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [selectedSeason, setSelectedSeason] = useState<Season | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const accessToken = await getBrowserAccessToken().catch(() => undefined);
        const seasonRows = await backendFetch<Season[]>("/seasons", accessToken, {
          cacheTtlMs: CATALOG_CACHE_TTL_MS,
        });
        const resolvedSeason = resolveLiveSeason(seasonRows, seasonIdParam);
        const seasonQuery = resolvedSeason?.id ? `?season_id=${resolvedSeason.id}` : "";
        const data = await backendFetch<RulePage>(`/rules${seasonQuery}`, accessToken);
        setSeasons(seasonRows);
        setSelectedSeason(resolvedSeason);
        setRulePage(data);
        if (resolvedSeason) {
          if (resolvedSeason.id !== seasonIdParam || competitionId) {
            setSeasonId(resolvedSeason.id, "");
          }
        }
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "No se pudo cargar el reglamento");
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, [competitionId, seasonIdParam, setSeasonId]);

  const availableSeasons = useMemo(
    () => getLiveSeasons(seasons),
    [seasons],
  );

  if (loading) {
    return <p className="text-sm text-steel">Cargando reglamento...</p>;
  }

  if (error) {
    return <p className="text-sm text-coral">{error}</p>;
  }

  return (
    <div className="space-y-6">
      <section>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-ink">{rulePage?.title || "Reglamento"}</h1>
            <p className="mt-1 text-sm text-steel">{rulePage?.season_name ?? selectedSeason?.name ?? "Reglamento general"}</p>
          </div>
          {availableSeasons.length > 1 ? (
            <label className="w-full max-w-[360px] space-y-2 text-left text-sm">
              <span className="text-steel">Temporada</span>
              <select
                value={selectedSeason?.id ?? ""}
                onChange={(event) => {
                  const nextSeason = availableSeasons.find((season) => season.id === event.target.value) ?? null;
                  if (!nextSeason) {
                    return;
                  }
                  setLoading(true);
                  setError(null);
                  setSeasonId(nextSeason.id, "");
                }}
                className="field-control"
                disabled={loading}
              >
                {availableSeasons.map((season) => (
                  <option key={season.id} value={season.id}>
                    {season.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
        {rulePage?.version_label ? (
          <div className="mt-3">
            <span className="app-pill h-9 px-3 text-[10px] uppercase tracking-[0.2em] text-steel">
              {rulePage.version_label}
            </span>
          </div>
        ) : null}
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
