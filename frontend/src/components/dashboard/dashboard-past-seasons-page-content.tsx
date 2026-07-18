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
      className: "app-pill px-3 text-[10px]",
      detail: "No tuviste alta registrada en esta temporada.",
    };
  }
  if (membership.is_active) {
    return {
      label: "Jugaste",
      className: "app-pill-active px-3 text-[10px] text-ink",
      detail: "Tu membresia quedo activa y el torneo ya vive como historico.",
    };
  }
  if (membership.is_paid) {
    return {
      label: "Pagado",
      className: "app-pill px-3 text-[10px] text-gold",
      detail: "Hubo registro de pago, pero el alta no quedo activa para competir.",
    };
  }
  return {
    label: "Cerrada",
    className: "app-pill px-3 text-[10px] text-steel",
    detail: "Tuviste relacion con esta temporada, pero no quedo activa al cierre.",
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
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[30px] border border-white/[0.06] bg-white/[0.03] px-5 py-5 sm:px-6 sm:py-6">
        <p className="text-xs uppercase tracking-[0.28em] text-steel">Past Seasons</p>
        <h1 className="mt-2 text-2xl font-semibold text-ink sm:text-3xl">Historico de temporadas</h1>
        <p className="mt-3 max-w-3xl text-sm text-steel">
          Aqui se van las temporadas archivadas para que el panel vivo se quede limpio. Puedes entrar a revisar
          resultados y ranking sin mezclarlo con lo que esta corriendo hoy.
        </p>
      </section>

      <section className="rounded-[28px] border border-white/[0.06] bg-white/[0.03] px-5 py-5 sm:px-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-steel">Archivadas</p>
            <h2 className="mt-2 text-xl font-semibold text-ink">Temporadas cerradas y guardadas</h2>
          </div>
          <div className="text-xs text-steel">{archivedRows.length} temporadas</div>
        </div>

        {archivedRows.length > 0 ? (
          <div className="mt-5 overflow-hidden rounded-[20px] border border-white/[0.06]">
            <div className="hidden grid-cols-[minmax(0,1.5fr)_140px_minmax(0,1fr)_220px] gap-3 border-b border-white/[0.06] bg-white/[0.03] px-4 py-3 text-[10px] uppercase tracking-[0.16em] text-steel md:grid">
              <span>Temporada</span>
              <span>Scope</span>
              <span>Tu estatus</span>
              <span>Accesos</span>
            </div>
            <div className="divide-y divide-white/[0.06]">
              {archivedRows.map(({ season, membership }) => {
                const status = getMembershipStatus(membership);
                return (
                  <div
                    key={season.id}
                    className="grid gap-4 px-4 py-4 md:grid-cols-[minmax(0,1.5fr)_140px_minmax(0,1fr)_220px] md:items-center"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ink">{season.name}</p>
                      <p className="mt-1 text-xs text-steel">
                        {season.competition_name ?? getSeasonScopeLabel(season)}
                        {season.survivor_enabled ? ` · ${season.survivor_name ?? "Survivor"} habilitado` : ""}
                      </p>
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm text-steel">{getSeasonScopeLabel(season)}</p>
                    </div>
                    <div className="min-w-0">
                      <span className={status.className}>{status.label}</span>
                      <p className="mt-2 text-xs text-steel">{status.detail}</p>
                    </div>
                    <div className="flex flex-wrap gap-3">
                      <Link
                        href={buildHrefWithSeason("/dashboard/results", season.id, season.competition_id ?? "")}
                        className="secondary-button"
                      >
                        Ver resultados
                      </Link>
                      <Link
                        href={buildHrefWithSeason("/dashboard/leaderboard", season.id, season.competition_id ?? "")}
                        className="secondary-button"
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
          <div className="mt-5 rounded-[22px] border border-white/[0.06] bg-night/20 px-4 py-4">
            <p className="text-sm text-steel">Todavia no hay temporadas archivadas.</p>
          </div>
        )}
      </section>
    </div>
  );
}
