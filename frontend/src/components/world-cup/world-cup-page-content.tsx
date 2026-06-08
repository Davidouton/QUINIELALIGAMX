"use client";

import { useEffect, useMemo, useState } from "react";

import { backendFetch } from "@/lib/api/backend";
import { useDashboardSeasonParam } from "@/lib/dashboard-season";
import { formatMexicoCityDateTime } from "@/lib/datetime/mexico-city";
import type { Season, WorldCupBoard, WorldCupBracketMatch } from "@/types/api";

const stageTitles = {
  round_of_32: "Dieciseisavos",
  round_of_16: "Octavos",
  quarterfinals: "Cuartos de final",
  semifinals: "Semifinales",
  third_place: "Tercer lugar",
  final: "Final",
} as const;

function TeamMiniBadge({
  name,
  shortName,
  crestUrl,
}: {
  name: string;
  shortName: string;
  crestUrl: string | null;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      {crestUrl ? (
        <div className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-white/[0.06]">
          <img src={crestUrl} alt={name} className="h-full w-full object-cover" />
        </div>
      ) : (
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/[0.06] text-[9px] text-steel">
          {shortName.slice(0, 1)}
        </span>
      )}
      <span className="truncate text-sm font-medium text-ink">{shortName}</span>
    </div>
  );
}

function formatScore(match: WorldCupBracketMatch) {
  if (match.home_score === null || match.away_score === null) {
    return "Pendiente";
  }
  return `${match.home_score}-${match.away_score}`;
}

function getAdvancingTeamName(match: WorldCupBracketMatch) {
  if (!match.advancing_team_id) {
    return null;
  }
  if (match.advancing_team_id === match.home_team_id) {
    return match.home_team_name;
  }
  if (match.advancing_team_id === match.away_team_id) {
    return match.away_team_name;
  }
  return "Clasificado";
}

export function WorldCupPageContent() {
  const { competitionId, seasonId: seasonIdParam, setSeasonId } = useDashboardSeasonParam();
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [selectedSeasonId, setSelectedSeasonId] = useState("");
  const [board, setBoard] = useState<WorldCupBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const worldCupSeasons = useMemo(
    () => seasons.filter((season) => season.tournament_format === "world_cup"),
    [seasons],
  );

  useEffect(() => {
    async function loadInitial() {
      try {
        const seasonRows = await backendFetch<Season[]>("/seasons");
        const wcSeasons = seasonRows.filter((season) => season.tournament_format === "world_cup");
        setSeasons(seasonRows);
        if (wcSeasons.length === 0) {
          setBoard(null);
          setError(null);
          return;
        }
        const nextSeason =
          wcSeasons.find((season) => season.id === seasonIdParam) ??
          wcSeasons.find((season) => season.is_active) ??
          wcSeasons[0];
        const nextSeasonId = nextSeason.id;
        const nextCompetitionId = nextSeason.competition_id ?? "";
        setSelectedSeasonId(nextSeasonId);
        if (seasonIdParam !== nextSeasonId || competitionId !== nextCompetitionId) {
          setSeasonId(nextSeasonId, nextCompetitionId);
        }
        const boardResponse = await backendFetch<WorldCupBoard>(`/world-cup/board?season_id=${nextSeasonId}`);
        setBoard(boardResponse);
        setError(null);
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "No se pudo cargar el tablero mundialista");
      } finally {
        setLoading(false);
      }
    }

    void loadInitial();
  }, [competitionId, seasonIdParam, setSeasonId]);

  async function handleSeasonChange(seasonId: string) {
    setSelectedSeasonId(seasonId);
    setLoading(true);
    try {
      const selectedSeason = seasons.find((season) => season.id === seasonId);
      setSeasonId(seasonId, selectedSeason?.competition_id ?? "");
      const boardResponse = await backendFetch<WorldCupBoard>(`/world-cup/board?season_id=${seasonId}`);
      setBoard(boardResponse);
      setError(null);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo cambiar la temporada mundialista");
    } finally {
      setLoading(false);
    }
  }

  if (loading && !board) {
    return <p className="text-sm text-ink/60">Cargando tablero mundialista...</p>;
  }

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <p className="text-[11px] uppercase tracking-[0.28em] text-steel">Quiniela Mundialista</p>
        <h1 className="text-2xl font-semibold text-ink">Mundial</h1>
        <p className="max-w-3xl text-sm text-steel">
          Grupos, eliminatorias y llaves finales sobre el mismo motor de picks, con punto extra por acertar el
          clasificado en knockout.
        </p>
      </section>

      {worldCupSeasons.length > 0 ? (
        <section className="max-w-[360px]">
          <label className="space-y-2 text-sm">
            <span className="text-steel">Temporada mundialista</span>
            <select
              value={selectedSeasonId}
              onChange={(event) => void handleSeasonChange(event.target.value)}
              className="field-control"
            >
              {worldCupSeasons.map((season) => (
                <option key={season.id} value={season.id}>
                  {season.name}
                </option>
              ))}
            </select>
          </label>
        </section>
      ) : (
        <p className="text-sm text-steel">Todavia no hay una temporada marcada como Mundial.</p>
      )}

      {error ? <p className="text-sm text-coral">{error}</p> : null}

      {board ? (
        <>
          <section className="space-y-4">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.22em] text-steel">Grupos</p>
              <p className="mt-2 text-sm text-steel">La tabla se arma con los resultados oficiales de la fase de grupos.</p>
            </div>
            <div className="grid gap-4 xl:grid-cols-2">
              {board.groups.map((group) => (
                <div key={group.group_label} className="rounded-[18px] border border-white/[0.06] bg-white/[0.03] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="text-lg font-semibold text-ink">Grupo {group.group_label}</h2>
                    <span className="text-xs uppercase tracking-[0.16em] text-steel">
                      {group.standings.length} equipos
                    </span>
                  </div>
                  <div className="mt-4 overflow-x-auto">
                    <table className="min-w-full text-left text-sm text-ink">
                      <thead>
                        <tr className="text-[10px] uppercase tracking-[0.16em] text-steel">
                          <th className="px-2 py-2">Equipo</th>
                          <th className="px-2 py-2 text-right">Pts</th>
                          <th className="px-2 py-2 text-right">PJ</th>
                          <th className="px-2 py-2 text-right">DG</th>
                          <th className="px-2 py-2 text-right">GF</th>
                          <th className="px-2 py-2 text-right">GC</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.standings.map((team) => (
                          <tr key={team.team_id} className="border-t border-white/[0.05]">
                            <td className="px-2 py-2">
                              <div className="flex items-center gap-2 font-medium text-ink">
                                {team.team_crest_url ? (
                                  <div className="flex h-5 w-5 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-white/[0.06]">
                                    <img
                                      src={team.team_crest_url}
                                      alt={team.team_name}
                                      className="h-full w-full object-cover"
                                    />
                                  </div>
                                ) : (
                                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/[0.06] text-[9px] text-steel">
                                    {team.team_short_name.slice(0, 1)}
                                  </span>
                                )}
                                <span>{team.team_short_name}</span>
                              </div>
                            </td>
                            <td className="px-2 py-2 text-right">{team.points}</td>
                            <td className="px-2 py-2 text-right">{team.played}</td>
                            <td className="px-2 py-2 text-right">{team.goal_difference}</td>
                            <td className="px-2 py-2 text-right">{team.goals_for}</td>
                            <td className="px-2 py-2 text-right">{team.goals_against}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-4">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.22em] text-steel">Bracket final</p>
              <p className="mt-2 text-sm text-steel">
                La llave usa la fase marcada en cada partido y muestra el clasificado oficial cuando ya existe.
              </p>
            </div>

            {(
              [
                ["round_of_32", board.round_of_32],
                ["round_of_16", board.round_of_16],
                ["quarterfinals", board.quarterfinals],
                ["semifinals", board.semifinals],
                ["third_place", board.third_place],
                ["final", board.final],
              ] as const
            ).map(([stageKey, matches]) =>
              matches.length > 0 ? (
                <div key={stageKey} className="space-y-3">
                  <h2 className="text-lg font-semibold text-ink">{stageTitles[stageKey]}</h2>
                  <div className="grid gap-3 lg:grid-cols-2">
                    {matches.map((match) => (
                      <div key={match.match_id} className="rounded-[16px] border border-white/[0.06] bg-white/[0.03] p-4">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-semibold text-ink">{match.bracket_slot ?? "Llave"}</p>
                          <div className="flex flex-wrap items-center justify-end gap-2 text-xs uppercase tracking-[0.16em]">
                            <span className="text-steel">{match.is_official ? "Oficial" : "Pendiente"}</span>
                            <span className={match.is_ready_for_picks ? "text-moss" : "text-amber-100"}>
                              {match.is_ready_for_picks ? "Equipos listos" : "Seed pendiente"}
                            </span>
                          </div>
                        </div>
                        <div className="mt-3 space-y-2">
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <TeamMiniBadge
                                name={match.home_team_name}
                                shortName={match.home_team_short_name}
                                crestUrl={match.home_team_crest_url}
                              />
                              {match.home_placeholder ? (
                                <p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-steel">
                                  Seed {match.home_placeholder}
                                </p>
                              ) : null}
                            </div>
                            <span className="text-sm font-semibold text-ink">
                              {match.home_score ?? "-"}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <TeamMiniBadge
                                name={match.away_team_name}
                                shortName={match.away_team_short_name}
                                crestUrl={match.away_team_crest_url}
                              />
                              {match.away_placeholder ? (
                                <p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-steel">
                                  Seed {match.away_placeholder}
                                </p>
                              ) : null}
                            </div>
                            <span className="text-sm font-semibold text-ink">
                              {match.away_score ?? "-"}
                            </span>
                          </div>
                        </div>
                        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-steel">
                          <span>{formatMexicoCityDateTime(match.kickoff_at)}</span>
                          <span>90 min: {formatScore(match)}</span>
                        </div>
                        {getAdvancingTeamName(match) ? (
                          <p className="mt-3 text-xs font-semibold uppercase tracking-[0.16em] text-moss">
                            Avanza: {getAdvancingTeamName(match)}
                          </p>
                        ) : !match.is_ready_for_picks ? (
                          <p className="mt-3 text-xs text-amber-100">
                            Este cruce ya puede quedar visible en el bracket aunque los clasificados reales aun no esten definidos.
                          </p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null,
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
