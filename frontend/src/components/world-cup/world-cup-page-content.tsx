"use client";

import { useEffect, useMemo, useState } from "react";

import { backendFetch, CATALOG_CACHE_TTL_MS } from "@/lib/api/backend";
import { isSeasonLive, useDashboardSeasonParam } from "@/lib/dashboard-season";
import { formatMexicoCityDateTime } from "@/lib/datetime/mexico-city";
import { getBrowserAccessToken } from "@/lib/supabase/session";
import type {
  Season,
  WorldCupBoard,
  WorldCupNewsArticle,
  WorldCupNewsFeed,
  WorldCupOfficialResult,
} from "@/types/api";

const WORLD_CUP_BOARD_CACHE_KEY = "qm-world-cup-board";

const stageTitles = {
  group: "Fase de grupos",
  regular: "Regular",
  round_of_32: "Dieciseisavos",
  round_of_16: "Octavos",
  quarterfinal: "Cuartos de final",
  quarterfinals: "Cuartos de final",
  semifinal: "Semifinales",
  semifinals: "Semifinales",
  third_place: "Tercer lugar",
  final: "Final",
} as const;

type WorldCupSection = "standings" | "groups" | "official-results" | "playoffs" | "news";
type ResultsGrouping = "matchday" | "day";
type NewsCategory = "all" | "official" | "mexico";

const newsCategoryLabels: Record<NewsCategory, string> = {
  all: "Todo",
  official: "Oficial FIFA",
  mexico: "Mexico",
};

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
        <img src={crestUrl} alt={name} className="h-8 w-8 object-contain" />
      ) : (
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/[0.06] text-[9px] text-steel">
          {shortName.slice(0, 1)}
        </span>
      )}
      <span className="truncate text-sm font-medium text-ink">{shortName}</span>
    </div>
  );
}

function TeamCrestOnly({ name, shortName, crestUrl }: { name: string; shortName: string; crestUrl: string | null }) {
  return crestUrl ? (
    <img src={crestUrl} alt={name} title={name} className="h-10 w-10 object-contain" />
  ) : (
    <span title={name} className="inline-flex h-10 w-10 items-center justify-center text-[10px] font-semibold text-steel">
      {shortName.slice(0, 3)}
    </span>
  );
}

function getOfficialAdvancingTeamName(match: WorldCupOfficialResult) {
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

function getStageTitle(stageType: WorldCupOfficialResult["stage_type"]) {
  return stageTitles[stageType as keyof typeof stageTitles] ?? "Partido";
}

function getMexicoCityDateKey(value: string) {
  const date = new Date(value);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function formatMexicoCityDay(value: string) {
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: "America/Mexico_City",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(value));
}

function formatNewsDate(value: string | null) {
  if (!value) {
    return "Fecha pendiente";
  }
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: "America/Mexico_City",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function getCachedWorldCupBoard(seasonId: string) {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const rawValue = window.sessionStorage.getItem(`${WORLD_CUP_BOARD_CACHE_KEY}:${seasonId}`);
    if (!rawValue) {
      return null;
    }
    return JSON.parse(rawValue) as WorldCupBoard;
  } catch {
    return null;
  }
}

function setCachedWorldCupBoard(seasonId: string, board: WorldCupBoard) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.sessionStorage.setItem(`${WORLD_CUP_BOARD_CACHE_KEY}:${seasonId}`, JSON.stringify(board));
  } catch {
    // Ignore browser cache write failures.
  }
}

function groupResultsByMatchday(results: WorldCupOfficialResult[]) {
  const grouped = new Map<string, { key: string; label: string; sort: number; results: WorldCupOfficialResult[] }>();
  for (const result of results) {
    const existing = grouped.get(result.matchday_id);
    if (existing) {
      existing.results.push(result);
    } else {
      grouped.set(result.matchday_id, {
        key: result.matchday_id,
        label: result.matchday_name.trim().toLowerCase().startsWith("jornada")
          ? result.matchday_name
          : `Jornada ${result.matchday_number}`,
        sort: result.matchday_number,
        results: [result],
      });
    }
  }
  return [...grouped.values()].sort((left, right) => left.sort - right.sort);
}

function groupResultsByDay(results: WorldCupOfficialResult[]) {
  const grouped = new Map<string, { key: string; label: string; sort: string; results: WorldCupOfficialResult[] }>();
  for (const result of results) {
    const key = getMexicoCityDateKey(result.kickoff_at);
    const existing = grouped.get(key);
    if (existing) {
      existing.results.push(result);
    } else {
      grouped.set(key, {
        key,
        label: formatMexicoCityDay(result.kickoff_at),
        sort: key,
        results: [result],
      });
    }
  }
  return [...grouped.values()].sort((left, right) => left.sort.localeCompare(right.sort));
}

export function WorldCupPageContent() {
  const { competitionId, seasonId: seasonIdParam, setSeasonId } = useDashboardSeasonParam();
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [selectedSeasonId, setSelectedSeasonId] = useState("");
  const [board, setBoard] = useState<WorldCupBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<WorldCupSection>("standings");
  const [resultsGrouping, setResultsGrouping] = useState<ResultsGrouping>("matchday");
  const [selectedResultsGroupKey, setSelectedResultsGroupKey] = useState("");
  const [newsCategory, setNewsCategory] = useState<NewsCategory>("all");
  const [newsArticles, setNewsArticles] = useState<WorldCupNewsArticle[]>([]);
  const [newsLoading, setNewsLoading] = useState(false);
  const [newsError, setNewsError] = useState<string | null>(null);

  async function loadBoardForSeason(seasonId: string) {
    try {
      const boardResponse = await backendFetch<WorldCupBoard>(`/world-cup/board?season_id=${seasonId}`, undefined, {
        cacheTtlMs: CATALOG_CACHE_TTL_MS,
      });
      setCachedWorldCupBoard(seasonId, boardResponse);
      return {
        board: boardResponse,
        error: null,
      };
    } catch (caughtError) {
      const cachedBoard = getCachedWorldCupBoard(seasonId);
      if (cachedBoard) {
        return {
          board: cachedBoard,
          error: "Mostrando el ultimo snapshot guardado del Mundial mientras vuelve el backend.",
        };
      }
      return {
        board: null,
        error: caughtError instanceof Error ? caughtError.message : "No se pudo cargar el tablero mundialista",
      };
    }
  }

  const tournamentSeasons = useMemo(
    () => seasons.filter((season) => season.visibility_status !== "archived"),
    [seasons],
  );
  const selectedSeason = tournamentSeasons.find((season) => season.id === selectedSeasonId) ?? null;
  const playoffRounds = useMemo(
    () => board ? [
      ["round_of_32", board.round_of_32],
      ["round_of_16", board.round_of_16],
      ["quarterfinals", board.quarterfinals],
      ["semifinals", board.semifinals],
      ["final", board.final],
      ["third_place", board.third_place],
    ] as const : [],
    [board],
  );
  const hasPlayoffs = playoffRounds.some(([, matches]) => matches.length > 0);
  const officialResultGroups = useMemo(() => {
    const results = board?.official_results ?? [];
    return resultsGrouping === "matchday" ? groupResultsByMatchday(results) : groupResultsByDay(results);
  }, [board?.official_results, resultsGrouping]);
  const selectedOfficialResultGroup =
    officialResultGroups.find((group) => group.key === selectedResultsGroupKey) ?? officialResultGroups[0] ?? null;

  useEffect(() => {
    async function loadInitial() {
      try {
        const accessToken = await getBrowserAccessToken();
        const seasonRows = await backendFetch<Season[]>("/seasons", accessToken, { cacheTtlMs: CATALOG_CACHE_TTL_MS });
        const statsSeasons = seasonRows.filter((season) => season.visibility_status !== "archived");
        setSeasons(seasonRows);
        if (statsSeasons.length === 0) {
          setBoard(null);
          setError(null);
          return;
        }
        const nextSeason =
          statsSeasons.find((season) => season.id === seasonIdParam) ??
          statsSeasons.find(isSeasonLive) ??
          statsSeasons.find((season) => season.is_active) ??
          statsSeasons[0];
        const nextSeasonId = nextSeason.id;
        const nextCompetitionId = nextSeason.competition_id ?? "";
        setSelectedSeasonId(nextSeasonId);
        setActiveSection(nextSeason.tournament_format === "world_cup" ? "groups" : "standings");
        if (seasonIdParam !== nextSeasonId || competitionId !== nextCompetitionId) {
          setSeasonId(nextSeasonId, nextCompetitionId);
        }
        const boardState = await loadBoardForSeason(nextSeasonId);
        setBoard(boardState.board);
        setError(boardState.error);
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "No se pudo cargar la vista mundialista");
        setBoard(null);
      } finally {
        setLoading(false);
      }
    }

    void loadInitial();
  }, [competitionId, seasonIdParam, setSeasonId]);

  async function handleReload() {
    setLoading(true);
    setError(null);
    try {
      const accessToken = await getBrowserAccessToken();
      const seasonRows = await backendFetch<Season[]>("/seasons", accessToken, { cacheTtlMs: CATALOG_CACHE_TTL_MS });
      const statsSeasons = seasonRows.filter((season) => season.visibility_status !== "archived");
      setSeasons(seasonRows);
      if (statsSeasons.length === 0) {
        setBoard(null);
        return;
      }
      const nextSeason =
        statsSeasons.find((season) => season.id === selectedSeasonId) ??
        statsSeasons.find((season) => season.id === seasonIdParam) ??
        statsSeasons.find(isSeasonLive) ??
        statsSeasons.find((season) => season.is_active) ??
        statsSeasons[0];
      setSelectedSeasonId(nextSeason.id);
      setActiveSection(nextSeason.tournament_format === "world_cup" ? "groups" : "standings");
      const boardState = await loadBoardForSeason(nextSeason.id);
      setBoard(boardState.board);
      setError(boardState.error);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo recargar el Mundial");
      setBoard(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setSelectedResultsGroupKey((current) => {
      if (officialResultGroups.some((group) => group.key === current)) {
        return current;
      }
      return officialResultGroups[0]?.key ?? "";
    });
  }, [officialResultGroups]);

  useEffect(() => {
    if (activeSection !== "news") {
      return;
    }

    let isCurrent = true;
    async function loadNews() {
      setNewsLoading(true);
      try {
        const feed = await backendFetch<WorldCupNewsFeed>(`/world-cup/news?category=${newsCategory}`);
        if (!isCurrent) {
          return;
        }
        setNewsArticles(feed.articles);
        setNewsError(null);
      } catch (caughtError) {
        if (!isCurrent) {
          return;
        }
        setNewsError(caughtError instanceof Error ? caughtError.message : "No se pudo cargar el feed mundialista");
        setNewsArticles([]);
      } finally {
        if (isCurrent) {
          setNewsLoading(false);
        }
      }
    }

    void loadNews();
    return () => {
      isCurrent = false;
    };
  }, [activeSection, newsCategory]);

  async function handleSeasonChange(seasonId: string) {
    setSelectedSeasonId(seasonId);
    setLoading(true);
    try {
      const selectedSeason = seasons.find((season) => season.id === seasonId);
      setActiveSection(selectedSeason?.tournament_format === "world_cup" ? "groups" : "standings");
      setSeasonId(seasonId, selectedSeason?.competition_id ?? "");
      const boardState = await loadBoardForSeason(seasonId);
      setBoard(boardState.board);
      setError(boardState.error);
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
      <header className="page-header">
        <h1 className="page-title">Tournament Stats</h1>

      {error ? (
        <section className="border-l-2 border-coral px-4 py-2">
          <p className="text-sm text-coral">No se pudo cargar la vista del Mundial en este momento.</p>
          <p className="mt-2 text-xs text-coral/80">{error}</p>
          <button type="button" onClick={() => void handleReload()} className="secondary-button mt-4">
            Reintentar
          </button>
        </section>
      ) : null}

      {tournamentSeasons.length > 0 ? (
        <div className="max-w-md">
          <label className="page-context-label">
            <span>Torneo</span>
            <select
              value={selectedSeasonId}
              onChange={(event) => void handleSeasonChange(event.target.value)}
              className="page-context-select"
            >
              {tournamentSeasons.map((season) => (
                <option key={season.id} value={season.id}>
                  {season.competition_name ? `${season.competition_name} · ` : ""}{season.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}
      </header>

      {tournamentSeasons.length === 0 ? (
        <p className="text-sm text-steel">Todavia no hay temporadas disponibles.</p>
      ) : null}

      {board ? (
        <>
          <section className="tab-list">
            {selectedSeason?.tournament_format !== "world_cup" ? (
              <button
                type="button"
                onClick={() => setActiveSection("standings")}
                className={activeSection === "standings" ? "tab-control tab-control-active" : "tab-control"}
              >
                Tabla general
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setActiveSection("official-results")}
              className={
                activeSection === "official-results" ? "tab-control tab-control-active" : "tab-control"
              }
            >
              Resultados oficiales
            </button>
            {selectedSeason?.tournament_format === "world_cup" ? (
              <button
                type="button"
                onClick={() => setActiveSection("groups")}
                className={activeSection === "groups" ? "tab-control tab-control-active" : "tab-control"}
              >
                Grupos
              </button>
            ) : null}
            {hasPlayoffs ? (
              <button
                type="button"
                onClick={() => setActiveSection("playoffs")}
                className={activeSection === "playoffs" ? "tab-control tab-control-active" : "tab-control"}
              >
                Playoffs
              </button>
            ) : null}
          </section>

          {activeSection === "standings" ? (
            <section>
              <h2 className="text-lg font-semibold text-ink">Tabla general</h2>
              {(board.league_standings ?? []).length === 0 ? (
                <p className="mt-4 text-sm text-steel">La tabla aparecerá cuando existan equipos en esta temporada.</p>
              ) : (
                <div className="mt-4 overflow-x-auto border-t border-white/[0.1]">
                  <table className="min-w-[820px] w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/[0.1] text-[10px] uppercase tracking-[0.14em] text-steel">
                        <th className="w-10 px-2 py-3 text-center">#</th>
                        <th className="px-2 py-3 text-left">Equipo</th>
                        <th className="px-2 py-3 text-right">PJ</th>
                        <th className="px-2 py-3 text-right">G</th>
                        <th className="px-2 py-3 text-right">E</th>
                        <th className="px-2 py-3 text-right">P</th>
                        <th className="px-2 py-3 text-right">GF</th>
                        <th className="px-2 py-3 text-right">GC</th>
                        <th className="px-2 py-3 text-right">DG</th>
                        <th className="px-2 py-3 text-center">Últimos 5</th>
                        <th className="px-2 py-3 text-right">PTS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(board.league_standings ?? []).map((team, index) => (
                        <tr key={team.team_id} className="border-b border-white/[0.07]">
                          <td className="px-2 py-3 text-center text-steel">{index + 1}</td>
                          <td className="px-2 py-3">
                            <div className="flex items-center gap-3">
                              {team.team_crest_url ? (
                                <img src={team.team_crest_url} alt={team.team_name} className="h-9 w-9 object-contain" />
                              ) : (
                                <span className="inline-flex h-9 w-9 items-center justify-center text-xs text-steel">{team.team_short_name.slice(0, 3)}</span>
                              )}
                              <div>
                                <p className="font-semibold text-ink">{team.team_name}</p>
                                <p className="text-[10px] text-steel">{team.team_short_name}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-2 py-3 text-right text-ink">{team.played}</td>
                          <td className="px-2 py-3 text-right text-ink">{team.wins}</td>
                          <td className="px-2 py-3 text-right text-ink">{team.draws}</td>
                          <td className="px-2 py-3 text-right text-ink">{team.losses}</td>
                          <td className="px-2 py-3 text-right text-steel">{team.goals_for}</td>
                          <td className="px-2 py-3 text-right text-steel">{team.goals_against}</td>
                          <td className="px-2 py-3 text-right text-steel">{team.goal_difference > 0 ? `+${team.goal_difference}` : team.goal_difference}</td>
                          <td className="px-2 py-3">
                            <div className="flex min-w-24 items-center justify-center gap-1.5" aria-label="Resultados de los últimos cinco partidos">
                              {(team.recent_form ?? []).map((result, resultIndex) => {
                                const label = result === "win" ? "Ganado" : result === "loss" ? "Perdido" : "Empatado";
                                const color = result === "win"
                                  ? "bg-emerald-500"
                                  : result === "loss"
                                    ? "bg-rose-500"
                                    : "border border-white/20 bg-black";
                                return (
                                  <span
                                    key={`${team.team_id}-${resultIndex}`}
                                    title={label}
                                    aria-label={label}
                                    className={`h-3 w-3 shrink-0 rounded-full ${color}`}
                                  />
                                );
                              })}
                              {(team.recent_form ?? []).length === 0 ? <span className="text-steel">—</span> : null}
                            </div>
                          </td>
                          <td className="px-2 py-3 text-right text-base font-bold text-[#4f7df3]">{team.points}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          ) : null}

          {activeSection === "groups" ? (
          <section className="space-y-4">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.22em] text-steel">Grupos</p>
            </div>
            <div className="grid gap-4 xl:grid-cols-2">
              {board.groups.map((group) => (
                <div key={group.group_label} className="border-t border-white/[0.1] py-4">
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
          ) : null}

          {activeSection === "official-results" ? (
            <section className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold uppercase tracking-[0.22em] text-steel">Resultados oficiales</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setResultsGrouping("matchday")}
                    className={resultsGrouping === "matchday" ? "tab-control tab-control-active" : "tab-control"}
                  >
                    Por jornada
                  </button>
                  <button
                    type="button"
                    onClick={() => setResultsGrouping("day")}
                    className={resultsGrouping === "day" ? "tab-control tab-control-active" : "tab-control"}
                  >
                    Por dia
                  </button>
                </div>
              </div>

              {officialResultGroups.length === 0 ? (
                <p className="text-sm text-steel">Todavia no hay resultados oficiales publicados para esta temporada.</p>
              ) : (
                <div className="space-y-4">
                  <label className="block max-w-[360px] space-y-2 text-sm">
                    <span className="text-steel">{resultsGrouping === "day" ? "Dia" : "Jornada"}</span>
                    <select
                      value={selectedOfficialResultGroup?.key ?? ""}
                      onChange={(event) => setSelectedResultsGroupKey(event.target.value)}
                      className="field-control"
                    >
                      {officialResultGroups.map((group) => (
                        <option key={group.key} value={group.key}>
                          {group.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  {selectedOfficialResultGroup ? (
                    <div key={selectedOfficialResultGroup.key} className="border-t border-white/[0.1] pt-4">
                      <div className="flex items-center justify-between gap-3">
                        <h2 className="text-base font-semibold text-ink">{selectedOfficialResultGroup.label}</h2>
                        <span className="text-xs uppercase tracking-[0.16em] text-steel">
                          {selectedOfficialResultGroup.results.length} partidos
                        </span>
                      </div>
                      <div className="relative mt-5 grid gap-x-10 lg:grid-cols-2 lg:after:absolute lg:after:inset-y-0 lg:after:left-1/2 lg:after:w-px lg:after:-translate-x-1/2 lg:after:bg-white/[0.08]">
                        {selectedOfficialResultGroup.results.map((result) => (
                          <div key={result.match_id} className="min-h-[132px] border-b border-white/[0.08] py-5">
                            <div className="flex min-h-4 items-center justify-between gap-3 text-[10px] uppercase tracking-[0.14em] text-steel">
                              <span>{result.stage_type === "regular" ? "" : getStageTitle(result.stage_type)}</span>
                              <span>{formatMexicoCityDateTime(result.kickoff_at)}</span>
                            </div>
                            <div className="mt-4 grid grid-cols-[minmax(0,1fr)_64px_minmax(0,1fr)] items-center gap-4">
                              <div className="min-w-0">
                                <TeamMiniBadge
                                  name={result.home_team_name}
                                  shortName={result.home_team_short_name}
                                  crestUrl={result.home_team_crest_url}
                                />
                              </div>
                              <span className="text-center text-xl font-bold tabular-nums text-ink">
                                {result.home_score ?? "-"}-{result.away_score ?? "-"}
                              </span>
                              <div className="min-w-0 justify-self-end">
                                <TeamMiniBadge
                                  name={result.away_team_name}
                                  shortName={result.away_team_short_name}
                                  crestUrl={result.away_team_crest_url}
                                />
                              </div>
                            </div>
                            {result.group_label || result.bracket_slot || getOfficialAdvancingTeamName(result) ? (
                              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-steel">
                                {result.group_label ? <span>Grupo {result.group_label}</span> : null}
                                {result.bracket_slot ? <span>{result.bracket_slot}</span> : null}
                                {getOfficialAdvancingTeamName(result) ? (
                                  <span className="font-semibold text-moss">Avanza: {getOfficialAdvancingTeamName(result)}</span>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
            </section>
          ) : null}

          {activeSection === "news" ? (
            <section className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold uppercase tracking-[0.22em] text-steel">Noticias</p>
                  <p className="mt-2 text-sm text-steel">
                    Feed mundialista en espanol con enlaces a la nota original.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {(Object.keys(newsCategoryLabels) as NewsCategory[]).map((category) => (
                    <button
                      key={category}
                      type="button"
                      onClick={() => setNewsCategory(category)}
                      className={newsCategory === category ? "tab-control tab-control-active" : "tab-control"}
                    >
                      {newsCategoryLabels[category]}
                    </button>
                  ))}
                </div>
              </div>

              {newsError ? <p className="text-sm text-coral">{newsError}</p> : null}
              {newsLoading ? <p className="text-sm text-steel">Cargando noticias del Mundial...</p> : null}

              {!newsLoading && newsArticles.length === 0 && !newsError ? (
                <p className="text-sm text-steel">No encontramos noticias disponibles en este momento.</p>
              ) : null}

              {newsArticles.length > 0 ? (
                <div className="grid gap-3 lg:grid-cols-2">
                  {newsArticles.map((article) => (
                    <article key={article.id} className="rounded-[16px] border border-white/[0.06] bg-white/[0.03] p-4">
                      <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-steel">
                        <span>{article.source}</span>
                        <span>{formatNewsDate(article.published_at)}</span>
                      </div>
                      <h2 className="mt-3 text-base font-semibold leading-snug text-ink">{article.title}</h2>
                      {article.summary ? (
                        <p className="mt-2 line-clamp-3 text-sm leading-6 text-steel">{article.summary}</p>
                      ) : null}
                      <a
                        href={article.url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-4 inline-flex rounded-md border border-moss/30 bg-moss/10 px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-moss transition hover:bg-moss/15"
                      >
                        Abrir nota
                      </a>
                    </article>
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}

          {activeSection === "playoffs" && hasPlayoffs ? (
            <section>
              <h2 className="text-lg font-semibold text-ink">Bracket</h2>
              <div className="no-scrollbar mt-5 overflow-x-auto pb-4">
                <div className="flex min-w-max items-stretch gap-8">
                  {playoffRounds.map(([stageKey, matches]) => matches.length > 0 ? (
                    <div key={stageKey} className="flex w-[140px] shrink-0 flex-col">
                      <h3 className="border-b border-white/[0.12] pb-3 text-sm font-semibold text-ink">
                        {stageTitles[stageKey]}
                      </h3>
                      <div className="flex flex-1 flex-col justify-around gap-8 py-5">
                        {matches.map((match) => (
                          <article key={match.match_id} className={`relative border-y border-white/[0.1] py-3 ${stageKey === "final" || stageKey === "third_place" ? "" : "after:absolute after:-right-8 after:top-1/2 after:h-px after:w-8 after:bg-white/[0.12]"}`}>
                            <div className="space-y-3">
                              <div className="flex items-center justify-between gap-3">
                                <TeamCrestOnly name={match.home_team_name} shortName={match.home_team_short_name} crestUrl={match.home_team_crest_url} />
                                <span className="text-base font-bold text-ink">{match.home_score ?? "-"}</span>
                              </div>
                              <div className="flex items-center justify-between gap-3">
                                <TeamCrestOnly name={match.away_team_name} shortName={match.away_team_short_name} crestUrl={match.away_team_crest_url} />
                                <span className="text-base font-bold text-ink">{match.away_score ?? "-"}</span>
                              </div>
                            </div>
                          </article>
                        ))}
                      </div>
                    </div>
                  ) : null)}
                </div>
              </div>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
