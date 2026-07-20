"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { backendFetch, MATCHDAY_CACHE_TTL_MS } from "@/lib/api/backend";
import { useDashboardSeasonParam } from "@/lib/dashboard-season";
import { getBrowserAccessToken } from "@/lib/supabase/session";
import type { Me, Season, UserSeasonMembership } from "@/types/api";

type PastSeasonsState = {
  seasons: Season[];
  memberships: UserSeasonMembership[];
};

const initialState: PastSeasonsState = {
  seasons: [],
  memberships: [],
};

function getMembershipStatus(membership: UserSeasonMembership | null) {
  if (!membership) {
    return {
      label: "Sin membresia",
      tone: "text-steel",
    };
  }
  if (membership.is_active) {
    return {
      label: "Jugaste",
      tone: "text-mint",
    };
  }
  if (membership.is_paid) {
    return {
      label: "Pagado",
      tone: "text-gold",
    };
  }
  return {
    label: "Cerrada",
    tone: "text-coral",
  };
}

function getSeasonScopeLabel(season: Season) {
  return season.tournament_format === "world_cup" ? "Mundial" : "Liga MX";
}

export function DashboardPastSeasonsPageContent() {
  const [state, setState] = useState<PastSeasonsState>(initialState);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { buildHrefWithSeason } = useDashboardSeasonParam();

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        setError(null);
        const accessToken = await getBrowserAccessToken().catch(() => undefined);
        const seasonsResponse = await backendFetch<Season[]>("/seasons", accessToken, {
          cacheTtlMs: MATCHDAY_CACHE_TTL_MS,
        });
        const seasons = Array.isArray(seasonsResponse) ? seasonsResponse : [];
        const me = accessToken
          ? await backendFetch<Me>("/me", accessToken, {
              cacheTtlMs: MATCHDAY_CACHE_TTL_MS,
            }).catch(() => null)
          : null;
        setState({
          seasons: seasons.filter((season) => season.visibility_status === "archived"),
          memberships: me?.season_memberships ?? [],
        });
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "No se pudo cargar el historico");
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, []);

  const archivedRows = useMemo(
    () =>
      state.seasons
        .map((season) => ({
          season,
          membership: state.memberships.find((membership) => membership.season_id === season.id) ?? null,
        }))
        .sort((left, right) => {
          const rightDate = new Date(right.season.updated_at || right.season.created_at).getTime();
          const leftDate = new Date(left.season.updated_at || left.season.created_at).getTime();
          return rightDate - leftDate;
        }),
    [state.memberships, state.seasons],
  );

  if (loading) {
    return <p className="text-sm text-ink/70">Cargando temporadas pasadas...</p>;
  }

  if (error) {
    return <p className="text-sm text-coral">{error}</p>;
  }

  return (
    <div className="space-y-12">
      <header className="page-header">
        <h1 className="page-title">Histórico de temporadas</h1>
      </header>

      <section>
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-sm font-semibold uppercase tracking-[0.22em] text-steel">Archivadas</h2>
          <p className="text-sm text-steel">{archivedRows.length}</p>
        </div>

        {archivedRows.length > 0 ? (
          <div className="mt-5 border-y border-white/10">
            <div className="hidden grid-cols-[minmax(0,1.5fr)_140px_minmax(0,0.8fr)_220px] gap-6 border-b border-white/10 py-4 text-xs uppercase tracking-[0.18em] text-steel md:grid">
              <span>Temporada</span>
              <span>Competencia</span>
              <span>Estado</span>
              <span className="text-right">Acciones</span>
            </div>
            <div className="divide-y divide-white/10">
              {archivedRows.map(({ season, membership }) => {
                const status = getMembershipStatus(membership);
                return (
                  <div
                    key={season.id}
                    className="grid gap-4 py-5 md:grid-cols-[minmax(0,1.5fr)_140px_minmax(0,0.8fr)_220px] md:items-center md:gap-6"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ink">{season.name}</p>
                      <p className="mt-1 text-xs text-steel">{season.competition_name ?? getSeasonScopeLabel(season)}</p>
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm text-steel">{getSeasonScopeLabel(season)}</p>
                    </div>
                    <p className={`text-sm font-semibold ${status.tone}`}>{status.label}</p>
                    <div className="flex flex-wrap gap-5 md:justify-end">
                      <Link
                        href={buildHrefWithSeason("/dashboard/results", season.id, season.competition_id ?? "")}
                        className="text-sm font-semibold text-ink transition hover:text-[#4f7df3]"
                      >
                        Ver resultados
                      </Link>
                      <Link
                        href={buildHrefWithSeason("/dashboard/leaderboard", season.id, season.competition_id ?? "")}
                        className="text-sm font-semibold text-ink transition hover:text-[#4f7df3]"
                      >
                        Ver ranking
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <p className="mt-5 border-y border-white/10 py-5 text-sm text-steel">No hay temporadas archivadas.</p>
        )}
      </section>
    </div>
  );
}
