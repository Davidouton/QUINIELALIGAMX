"use client";

import { useEffect, useMemo, useState } from "react";

import { DashboardLivePanel } from "@/components/dashboard/dashboard-live-panel";
import { backendFetch, CATALOG_CACHE_TTL_MS } from "@/lib/api/backend";
import { getLiveSeasons, resolveSeasonForContext, useDashboardSeasonParam } from "@/lib/dashboard-season";
import type { Season } from "@/types/api";

function sortSeasons(seasons: Season[]) {
  return seasons.slice().sort((left, right) => {
    if (left.is_active !== right.is_active) {
      return left.is_active ? -1 : 1;
    }
    return left.name.localeCompare(right.name, "es-MX");
  });
}

export function LivePageContent() {
  const { seasonId: seasonIdParam, competitionId, setSeasonId } = useDashboardSeasonParam();
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadSeasons() {
      try {
        setLoading(true);
        const rows = await backendFetch<Season[]>("/seasons", undefined, { cacheTtlMs: CATALOG_CACHE_TTL_MS });
        const nextSeasons = Array.isArray(rows) ? rows : [];
        setSeasons(nextSeasons);
        setError(null);
      } catch (caughtError) {
        setSeasons([]);
        setError(caughtError instanceof Error ? caughtError.message : "No se pudieron cargar las temporadas");
      } finally {
        setLoading(false);
      }
    }

    void loadSeasons();
  }, []);

  const liveEnabledSeasons = useMemo(
    () => sortSeasons(getLiveSeasons(seasons).filter((season) => season.live_dashboard_enabled)),
    [seasons],
  );
  const selectedSeason = useMemo(() => {
    const scoped = resolveSeasonForContext(liveEnabledSeasons, seasonIdParam, competitionId);
    return scoped ?? liveEnabledSeasons[0] ?? null;
  }, [competitionId, liveEnabledSeasons, seasonIdParam]);

  useEffect(() => {
    if (!selectedSeason) {
      return;
    }
    if (selectedSeason.id !== seasonIdParam || (selectedSeason.competition_id ?? "") !== competitionId) {
      setSeasonId(selectedSeason.id, selectedSeason.competition_id ?? "");
    }
  }, [competitionId, seasonIdParam, selectedSeason, setSeasonId]);

  if (loading) {
    return <p className="text-sm text-steel">Cargando vista live...</p>;
  }

  if (error && liveEnabledSeasons.length === 0) {
    return <p className="text-sm text-coral">{error}</p>;
  }

  if (liveEnabledSeasons.length === 0) {
    return (
      <section className="rounded-[24px] border border-white/10 bg-white/[0.02] p-5">
        <p className="text-xs uppercase tracking-[0.28em] text-steel">Live</p>
        <h1 className="mt-2 text-xl font-semibold text-ink">Quiniela al momento</h1>
        <p className="mt-2 text-sm text-steel">
          Aun no hay temporadas con la vista live prendida desde admin.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-[#ff7b9a]">Live</p>
          <h1 className="mt-2 text-xl font-semibold text-ink">Quiniela al momento</h1>
          <p className="mt-2 max-w-3xl text-sm text-steel">
            Aqui admin mueve marcadores en resultados y esta vista recalcula posiciones provisionales en tiempo real.
          </p>
        </div>
        <label className="space-y-1">
          <span className="text-[10px] font-semibold uppercase tracking-[0.24em] text-steel">Temporada</span>
          <select
            value={selectedSeason?.id ?? ""}
            onChange={(event) => {
              const nextSeason = liveEnabledSeasons.find((season) => season.id === event.target.value) ?? null;
              if (!nextSeason) {
                return;
              }
              setSeasonId(nextSeason.id, nextSeason.competition_id ?? "");
            }}
            className="field-control h-10 min-w-[280px] rounded-[8px] border-white/[0.08] bg-transparent px-3 text-sm"
          >
            {liveEnabledSeasons.map((season) => (
              <option key={season.id} value={season.id}>
                {season.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <DashboardLivePanel season={selectedSeason} />
    </section>
  );
}
