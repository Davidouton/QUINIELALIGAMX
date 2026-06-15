"use client";

import { useEffect, useMemo, useState } from "react";

import { backendFetch } from "@/lib/api/backend";
import { useDashboardSeasonParam } from "@/lib/dashboard-season";
import { formatMexicoCityDateTime } from "@/lib/datetime/mexico-city";
import type {
  Season,
  WorldCupBoard,
  WorldCupBracketMatch,
  WorldCupNewsArticle,
  WorldCupNewsFeed,
  WorldCupOfficialResult,
} from "@/types/api";

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

type WorldCupSection = "groups" | "official-results" | "news";
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
  const [activeSection, setActiveSection] = useState<WorldCupSection>("groups");
  const [resultsGrouping, setResultsGrouping] = useState<ResultsGrouping>("matchday");
  const [newsCategory, setNewsCategory] = useState<NewsCategory>("all");
  const [newsArticles, setNewsArticles] = useState<WorldCupNewsArticle[]>([]);
  const [newsLoading, setNewsLoading] = useState(false);
  const [newsError, setNewsError] = useState<string | null>(null);

  const worldCupSeasons = useMemo(
    () => seasons.filter((season) => season.tournament_format === "world_cup"),
    [seasons],
  );
  const officialResultGroups = useMemo(() => {
    const results = board?.official_results ?? [];
    return resultsGrouping === "matchday" ? groupResultsByMatchday(results) : groupResultsByDay(results);
  }, [board?.official_results, resultsGrouping]);

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
          <section className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveSection("groups")}
              className={activeSection === "groups" ? "app-pill-active min-w-[10rem] px-3" : "app-pill min-w-[10rem] px-3"}
            >
              Grupos
            </button>
            <button
              type="button"
              onClick={() => setActiveSection("official-results")}
              className={
                activeSection === "official-results" ? "app-pill-active min-w-[10rem] px-3" : "app-pill min-w-[10rem] px-3"
              }
            >
              Resultados oficiales
            </button>
            <button
              type="button"
              onClick={() => setActiveSection("news")}
              className={activeSection === "news" ? "app-pill-active min-w-[10rem] px-3" : "app-pill min-w-[10rem] px-3"}
            >
              Noticias
            </button>
          </section>

          {activeSection === "groups" ? (
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
          ) : null}

          {activeSection === "official-results" ? (
            <section className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold uppercase tracking-[0.22em] text-steel">Resultados oficiales</p>
                  <p className="mt-2 text-sm text-steel">
                    Marcadores publicados para esta temporada mundialista, agrupados por jornada o por dia.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setResultsGrouping("matchday")}
                    className={resultsGrouping === "matchday" ? "app-pill-active px-3" : "app-pill px-3"}
                  >
                    Por jornada
                  </button>
                  <button
                    type="button"
                    onClick={() => setResultsGrouping("day")}
                    className={resultsGrouping === "day" ? "app-pill-active px-3" : "app-pill px-3"}
                  >
                    Por dia
                  </button>
                </div>
              </div>

              {officialResultGroups.length === 0 ? (
                <p className="text-sm text-steel">Todavia no hay resultados oficiales publicados para esta temporada.</p>
              ) : (
                <div className={resultsGrouping === "day" ? "no-scrollbar flex gap-4 overflow-x-auto pb-2 touch-pan-x" : "space-y-4"}>
                  {officialResultGroups.map((group) => (
                    <div
                      key={group.key}
                      className={
                        resultsGrouping === "day"
                          ? "w-[300px] shrink-0 rounded-[16px] border border-white/[0.06] bg-white/[0.03] p-4 sm:w-[360px]"
                          : "rounded-[16px] border border-white/[0.06] bg-white/[0.03] p-4"
                      }
                    >
                      <div className="flex items-center justify-between gap-3">
                        <h2 className="text-base font-semibold text-ink">{group.label}</h2>
                        <span className="text-xs uppercase tracking-[0.16em] text-steel">
                          {group.results.length} partidos
                        </span>
                      </div>
                      <div className="mt-4 space-y-3">
                        {group.results.map((result) => (
                          <div key={result.match_id} className="rounded-md border border-white/[0.06] bg-black/10 p-3">
                            <div className="flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.14em] text-steel">
                              <span>{getStageTitle(result.stage_type)}</span>
                              <span>{formatMexicoCityDateTime(result.kickoff_at)}</span>
                            </div>
                            <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                              <TeamMiniBadge
                                name={result.home_team_name}
                                shortName={result.home_team_short_name}
                                crestUrl={result.home_team_crest_url}
                              />
                              <span className="rounded-md border border-moss/30 bg-moss/10 px-2 py-1 text-sm font-semibold text-ink">
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
                  ))}
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
                      className={newsCategory === category ? "app-pill-active px-3" : "app-pill px-3"}
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
