"use client";

import { useEffect, useMemo, useState } from "react";

import { backendFetch } from "@/lib/api/backend";
import { formatMexicoCityDateTime } from "@/lib/datetime/mexico-city";
import { getBrowserAccessToken } from "@/lib/supabase/session";
import type { LiveLeaderboardResponse, Season } from "@/types/api";

type DashboardLivePanelProps = {
  season: Season | null;
  vipId?: string | null;
};

const initialState: LiveLeaderboardResponse = {
  enabled: false,
  season_id: null,
  season_name: null,
  matchday_id: null,
  matchday_name: null,
  is_official: false,
  refresh_interval_seconds: 20,
  updated_at: null,
  leaderboard: [],
  matches: [],
};

function formatSignedNumber(value: number) {
  if (value > 0) {
    return `+${value}`;
  }
  return String(value);
}

function formatMovementLabel(value: number) {
  if (value > 0) {
    return `↑ ${value}`;
  }
  if (value < 0) {
    return `↓ ${Math.abs(value)}`;
  }
  return "→ 0";
}

function renderScore(homeScore: number | null, awayScore: number | null) {
  if (homeScore === null || awayScore === null) {
    return "-";
  }
  return `${homeScore} - ${awayScore}`;
}

function TeamLiveBadge({ crestUrl, teamName }: { crestUrl: string | null; teamName: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      {crestUrl ? (
        <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full">
          <img src={crestUrl} alt={teamName} className="h-full w-full object-cover" />
        </div>
      ) : (
        <div className="flex h-9 w-9 shrink-0 items-center justify-center text-[10px] font-semibold uppercase text-steel">
          {teamName.slice(0, 3)}
        </div>
      )}
      <p className="truncate text-sm font-semibold text-ink">{teamName}</p>
    </div>
  );
}

export function DashboardLivePanel({ season, vipId = null }: DashboardLivePanelProps) {
  const [state, setState] = useState<LiveLeaderboardResponse>(initialState);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    setState(initialState);
    setError(null);
    setLoading(true);
    setRefreshTick(0);
  }, [season?.id, vipId]);

  useEffect(() => {
    if (!season?.id) {
      setLoading(false);
      return;
    }
    const seasonId = season.id;

    let cancelled = false;

    async function loadLiveBoard() {
      try {
        if (!cancelled) {
          setLoading((current) => (refreshTick === 0 ? true : current));
          setError(null);
        }
        const accessToken = await getBrowserAccessToken();
        const params = new URLSearchParams({ season_id: seasonId });
        if (vipId) {
          params.set("vip_id", vipId);
        }
        const response = await backendFetch<LiveLeaderboardResponse>(
          `/leaderboard/live?${params.toString()}`,
          accessToken,
          {
            cacheTtlMs: 0,
            timeoutMs: 20000,
          },
        );
        if (!cancelled) {
          setState(response);
        }
      } catch (caughtError) {
        if (!cancelled) {
          setError(caughtError instanceof Error ? caughtError.message : "No se pudo cargar la vista live");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadLiveBoard();
    return () => {
      cancelled = true;
    };
  }, [refreshTick, season?.id, vipId]);

  useEffect(() => {
    if (!season?.id || !season.live_dashboard_enabled) {
      return;
    }
    const refreshEveryMs = Math.max(10, state.refresh_interval_seconds || 20) * 1000;
    const intervalId = window.setInterval(() => {
      setRefreshTick((current) => current + 1);
    }, refreshEveryMs);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [season?.id, season?.live_dashboard_enabled, state.refresh_interval_seconds]);

  if (!season) {
    return <p className="text-sm text-steel">Selecciona un torneo para ver la quiniela al momento.</p>;
  }

  if (!season.live_dashboard_enabled) {
    return (
      <div className="border-y border-white/[0.08] py-5">
        <p className="text-sm text-steel">Live no disponible para {season.name}.</p>
      </div>
    );
  }

  if (loading && state.leaderboard.length === 0) {
    return <p className="text-sm text-steel">Cargando quiniela al momento...</p>;
  }

  if (error && state.leaderboard.length === 0) {
    return <p className="text-sm text-coral">{error}</p>;
  }

  return (
    <section className="space-y-5">
      <div>
        <div className="flex items-baseline justify-between gap-4 border-b border-white/[0.08] pb-3">
          <h2 className="text-base font-semibold text-ink">Marcadores del día</h2>
          {state.matchday_name ? <p className="text-xs text-steel/70">{state.matchday_name}</p> : null}
        </div>

        <div className="grid md:grid-cols-2">
            {state.matches.map((match) => (
              <article
                key={match.match_id}
                className="border-b border-white/[0.08] py-5 md:odd:pr-6 md:even:pl-6 md:even:border-l"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-steel">
                    {formatMexicoCityDateTime(match.kickoff_at)}
                  </p>
                  <span className={`text-[10px] font-semibold uppercase tracking-[0.18em] ${match.is_official ? "text-emerald-300" : "text-[#ff7b9a]"}`}>
                    {match.is_official ? "Oficial" : "Live"}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                  <TeamLiveBadge crestUrl={match.home_team_crest_url} teamName={match.home_team_name} />
                  <p className="text-base font-semibold text-ink">{renderScore(match.home_score, match.away_score)}</p>
                  <div className="flex justify-end">
                    <TeamLiveBadge crestUrl={match.away_team_crest_url} teamName={match.away_team_name} />
                  </div>
                </div>
              </article>
            ))}
          {state.matches.length === 0 ? <p className="py-5 text-sm text-steel">Sin partidos disponibles.</p> : null}
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-ink">Ranking provisional</h2>
          </div>
          {error ? <p className="text-xs text-coral">{error}</p> : null}
        </div>

        <div className="overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <table className="min-w-[760px] w-full table-fixed text-left text-[11px] text-ink sm:text-sm">
            <colgroup>
              <col className="w-[96px]" />
              <col className="w-[30%]" />
              <col className="w-[120px]" />
              <col className="w-[120px]" />
              <col className="w-[120px]" />
              <col className="w-[140px]" />
              <col className="w-[110px]" />
            </colgroup>
            <thead className="app-table-head">
              <tr>
                <th className="px-3 py-3">Live</th>
                <th className="px-3 py-3">Jugador</th>
                <th className="px-3 py-3">Movimiento</th>
                <th className="px-3 py-3">Pts</th>
                <th className="px-3 py-3">+ En vivo</th>
                <th className="px-3 py-3">Oficial</th>
                <th className="px-3 py-3">Exactos</th>
              </tr>
            </thead>
            <tbody>
              {state.leaderboard.map((entry) => (
                <tr key={entry.profile_id} className="app-table-row border-b last:border-b-0">
                  <td className="px-3 py-3 font-semibold text-ink">#{entry.rank_position}</td>
                  <td className="px-3 py-3">
                    <p className="font-semibold text-ink">{entry.display_name}</p>
                  </td>
                  <td className="px-3 py-3">
                    <span
                      className={`text-xs font-semibold ${
                        entry.rank_delta > 0
                          ? "text-emerald-300"
                          : entry.rank_delta < 0
                            ? "text-coral"
                            : "text-steel"
                      }`}
                    >
                      {formatMovementLabel(entry.rank_delta)}
                    </span>
                  </td>
                  <td className="px-3 py-3 font-semibold text-ink">{entry.total_points}</td>
                  <td className="px-3 py-3 text-steel">{formatSignedNumber(entry.live_matchday_points)}</td>
                  <td className="px-3 py-3 text-steel">
                    {entry.official_rank_position ? `#${entry.official_rank_position}` : "-"}
                  </td>
                  <td className="px-3 py-3 text-steel">{entry.exact_scores}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {state.leaderboard.length === 0 ? (
          <p className="text-sm text-steel">Todavia no hay picks evaluables para mover el ranking live.</p>
        ) : null}
      </div>
    </section>
  );
}
