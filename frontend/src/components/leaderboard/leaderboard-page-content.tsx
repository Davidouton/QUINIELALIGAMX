"use client";

import { useEffect, useState } from "react";

import { backendFetch } from "@/lib/api/backend";
import { filterMatchdaysBySeason, resolveSeasonForContext, useDashboardSeasonParam } from "@/lib/dashboard-season";
import { getBrowserAccessToken } from "@/lib/supabase/session";
import type { LeaderboardEntry, Matchday, Season } from "@/types/api";

type LeaderboardState = {
  activeMatchday: Matchday | null;
  selectedSeason: Season | null;
  overall: LeaderboardEntry[];
  error: string | null;
};

const initialState: LeaderboardState = {
  activeMatchday: null,
  selectedSeason: null,
  overall: [],
  error: null,
};

export function LeaderboardPageContent() {
  const [state, setState] = useState<LeaderboardState>(initialState);
  const [loading, setLoading] = useState(true);
  const { seasonId: seasonIdParam, competitionId, setSeasonId } = useDashboardSeasonParam();

  useEffect(() => {
    async function loadLeaderboard() {
      try {
        const accessToken = await getBrowserAccessToken();

        const [activeMatchdays, seasons] = await Promise.all([
          backendFetch<Matchday[]>("/matchdays?status=active", accessToken),
          backendFetch<Season[]>("/seasons", accessToken),
        ]);
        const selectedSeason = resolveSeasonForContext(seasons, seasonIdParam, competitionId);
        const overall = await backendFetch<LeaderboardEntry[]>(
          selectedSeason ? `/leaderboard/overall?season_id=${selectedSeason.id}` : "/leaderboard/overall",
          accessToken,
        );
        const activeMatchday =
          (selectedSeason
            ? activeMatchdays.find((matchday) => matchday.season_id === selectedSeason.id) ??
              filterMatchdaysBySeason(activeMatchdays, selectedSeason.id)[0] ??
              null
            : null);

        if (selectedSeason && selectedSeason.id !== seasonIdParam) {
          setSeasonId(selectedSeason.id, selectedSeason.competition_id ?? "");
        }

        setState({
          activeMatchday,
          selectedSeason,
          overall,
          error: null,
        });
      } catch (error) {
        setState((current) => ({
          ...current,
          error: error instanceof Error ? error.message : "No se pudo cargar la tabla general",
        }));
      } finally {
        setLoading(false);
      }
    }

    void loadLeaderboard();
  }, [competitionId, seasonIdParam, setSeasonId]);

  if (loading) {
    return <p className="text-sm text-ink/60">Cargando tabla general...</p>;
  }

  if (state.error) {
    return <p className="text-sm text-coral">{state.error}</p>;
  }

  return (
    <div className="space-y-6">
      <section>
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-ink">Ranking</h1>
            <p className="mt-1 text-sm text-steel">
              {state.selectedSeason ? `Tabla general de ${state.selectedSeason.name}` : "Tabla general del torneo"}
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-3 xl:min-w-[520px]">
            <div className="space-y-1">
              <p className="text-[10px] uppercase tracking-[0.24em] text-steel">Lider</p>
              <p className="mt-2 text-sm font-semibold text-ink">
                {state.overall[0]?.display_name ?? "Sin clasificacion"}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-[10px] uppercase tracking-[0.24em] text-steel">Puntos</p>
              <p className="mt-2 text-sm font-semibold text-ink">
                {state.overall[0] ? `${state.overall[0].total_points} pts` : "Pendiente"}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-[10px] uppercase tracking-[0.24em] text-steel">Jugadores</p>
              <p className="mt-2 text-sm font-semibold text-ink">{state.overall.length}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm font-semibold uppercase tracking-[0.22em] text-steel">Tabla general</p>
          <p className="text-xs text-steel">{state.overall.length} participantes</p>
        </div>

        <div className="overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <table className="min-w-[720px] w-full table-fixed text-left text-[11px] text-ink sm:text-sm">
            <colgroup>
              <col className="w-[72px]" />
              <col className="w-[44%]" />
              <col className="w-[128px]" />
              <col className="w-[128px]" />
              <col className="w-[128px]" />
            </colgroup>
            <thead className="app-table-head">
              <tr>
                <th className="px-3 py-3">Pos</th>
                <th className="px-3 py-3">Jugador</th>
                <th className="px-3 py-3 text-center">Puntos</th>
                <th className="px-3 py-3 text-center">Aciertos</th>
                <th className="px-3 py-3 text-center">Exactos</th>
              </tr>
            </thead>
            <tbody>
              {state.overall.map((entry) => (
                <tr key={entry.profile_id} className="app-table-row border-b last:border-b-0">
                  <td className="px-3 py-3 font-semibold text-ink">{entry.rank_position}</td>
                  <td className="px-3 py-3 font-medium">
                    <span className="block truncate">{entry.display_name}</span>
                  </td>
                  <td className="px-3 py-3 text-center">{entry.total_points}</td>
                  <td className="px-3 py-3 text-center">{entry.correct_results}</td>
                  <td className="px-3 py-3 text-center">{entry.exact_scores}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {state.overall.length === 0 ? (
            <p className="py-6 text-sm text-steel">Aun no hay posiciones calculadas.</p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
