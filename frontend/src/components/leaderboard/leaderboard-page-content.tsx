"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { backendFetch, CATALOG_CACHE_TTL_MS, MATCHDAY_CACHE_TTL_MS } from "@/lib/api/backend";
import { getDashboardScreenName, trackAnalyticsEvent } from "@/lib/analytics/track";
import { VIP_SUMMARY_PATH, buildVipDetailPath } from "@/lib/api/vip";
import { filterMatchdaysBySeason, getLiveSeasons, resolveLiveSeason, useDashboardSeasonParam } from "@/lib/dashboard-season";
import { getBrowserAccessToken } from "@/lib/supabase/session";
import type { AppBootstrap, LeaderboardEntry, Matchday, Me, PrizeSummary, Season, VipCompetition, WeeklyPrizeMatchday } from "@/types/api";

type RankingEntry = Pick<
  LeaderboardEntry,
  "profile_id" | "display_name" | "username" | "total_points" | "correct_results" | "exact_scores" | "rank_position"
>;

type RankingBoardOption = {
  value: string;
  label: string;
};

type LeaderboardState = {
  me: Me | null;
  seasons: Season[];
  activeMatchday: Matchday | null;
  selectedSeason: Season | null;
  overallBySeasonId: Record<string, LeaderboardEntry[]>;
  participantCountBySeasonId: Record<string, number>;
  weeklyPrizesBySeasonId: Record<string, WeeklyPrizeMatchday[]>;
  vipCompetitions: VipCompetition[];
  error: string | null;
};

const initialState: LeaderboardState = {
  me: null,
  seasons: [],
  activeMatchday: null,
  selectedSeason: null,
  overallBySeasonId: {},
  participantCountBySeasonId: {},
  weeklyPrizesBySeasonId: {},
  vipCompetitions: [],
  error: null,
};

const LEADERBOARD_VISIBILITY_REFRESH_STALE_MS = 60_000;

export function LeaderboardPageContent() {
  const [state, setState] = useState<LeaderboardState>(initialState);
  const [selectedBoardId, setSelectedBoardId] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingVipBoardId, setLoadingVipBoardId] = useState("");
  const [loadedVipDetailIds, setLoadedVipDetailIds] = useState<string[]>([]);
  const [activeView, setActiveView] = useState<"overall" | "weekly-prizes">("overall");
  const lastLoadedAtRef = useRef(0);
  const { seasonId: seasonIdParam, competitionId, setSeasonId } = useDashboardSeasonParam();

  const loadLeaderboard = useCallback(async () => {
    const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
    setLoading(true);
    try {
      const accessToken = await getBrowserAccessToken();

      const [bootstrap, vipCompetitions] = await Promise.all([
        backendFetch<AppBootstrap>("/bootstrap", accessToken, {
          cacheTtlMs: MATCHDAY_CACHE_TTL_MS,
        }),
        backendFetch<VipCompetition[]>(VIP_SUMMARY_PATH, accessToken, {
          cacheTtlMs: CATALOG_CACHE_TTL_MS,
        }),
      ]);
      const {
        me,
        active_matchdays: activeMatchdays,
        seasons,
      } = bootstrap;
      const liveSeasons = getLiveSeasons(seasons);
      const selectedSeason = resolveLiveSeason(seasons, seasonIdParam);
      const seasonBoardBundles = await Promise.all(
        liveSeasons.map(async (season) => {
          try {
            const [rows, prizeSummary, weeklyPrizes] = await Promise.all([
              backendFetch<LeaderboardEntry[]>(
                `/leaderboard/overall?season_id=${season.id}`,
                accessToken,
                { cacheTtlMs: MATCHDAY_CACHE_TTL_MS },
              ),
              backendFetch<PrizeSummary>(
                `/me/prize-summary?season_id=${season.id}`,
                accessToken,
                { cacheTtlMs: MATCHDAY_CACHE_TTL_MS },
              ),
              backendFetch<WeeklyPrizeMatchday[]>(
                `/leaderboard/weekly-prizes?season_id=${season.id}`,
                accessToken,
                { cacheTtlMs: MATCHDAY_CACHE_TTL_MS },
              ).catch(() => []),
            ]);
            return {
              seasonId: season.id,
              rows,
              participantCount: prizeSummary.confirmed_participants,
              weeklyPrizes,
            };
          } catch {
            return {
              seasonId: season.id,
              rows: [],
              participantCount: 0,
              weeklyPrizes: [],
            };
          }
        }),
      );
      const activeMatchday =
        (selectedSeason
          ? activeMatchdays.find((matchday) => matchday.season_id === selectedSeason.id) ??
            filterMatchdaysBySeason(activeMatchdays, selectedSeason.id)[0] ??
            null
          : null);

      if (selectedSeason && (selectedSeason.id !== seasonIdParam || competitionId)) {
        setSeasonId(selectedSeason.id, "");
      }

      setState({
        me,
        seasons,
        activeMatchday,
        selectedSeason,
        overallBySeasonId: Object.fromEntries(
          seasonBoardBundles.map((bundle) => [bundle.seasonId, bundle.rows]),
        ),
        participantCountBySeasonId: Object.fromEntries(
          seasonBoardBundles.map((bundle) => [bundle.seasonId, bundle.participantCount]),
        ),
        weeklyPrizesBySeasonId: Object.fromEntries(
          seasonBoardBundles.map((bundle) => [bundle.seasonId, bundle.weeklyPrizes]),
        ),
        vipCompetitions,
        error: null,
      });
      void trackAnalyticsEvent({
        category: "screen",
        event_name: "screen_loaded",
        route_path: "/dashboard/leaderboard",
        screen_name: getDashboardScreenName("/dashboard/leaderboard"),
        season_id: selectedSeason?.id ?? null,
        matchday_id: activeMatchday?.id ?? null,
        competition_id: selectedSeason?.competition_id ?? null,
        success: true,
        duration_ms: Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt),
      });
      lastLoadedAtRef.current = Date.now();
    } catch (error) {
      setState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : "No se pudo cargar la tabla general",
      }));
      void trackAnalyticsEvent({
        category: "screen",
        event_name: "screen_load_failed",
        route_path: "/dashboard/leaderboard",
        screen_name: getDashboardScreenName("/dashboard/leaderboard"),
        season_id: seasonIdParam,
        competition_id: competitionId || null,
        success: false,
        duration_ms: Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt),
        metadata: {
          message: error instanceof Error ? error.message : "leaderboard_failed",
        },
      });
    } finally {
      setLoading(false);
    }
  }, [competitionId, seasonIdParam, setSeasonId]);

  useEffect(() => {
    void loadLeaderboard();
  }, [loadLeaderboard]);

  useEffect(() => {
    if (!selectedBoardId.startsWith("vip:")) {
      return;
    }

    const vipId = selectedBoardId.slice(4);
    if (!vipId || loadedVipDetailIds.includes(vipId)) {
      return;
    }

    let cancelled = false;
    async function loadVipBoard() {
      try {
        setLoadingVipBoardId(vipId);
        const accessToken = await getBrowserAccessToken();
        const rows = await backendFetch<VipCompetition[]>(buildVipDetailPath(vipId), accessToken, {
          cacheTtlMs: MATCHDAY_CACHE_TTL_MS,
        });
        const detail = rows[0];
        if (!detail || cancelled) {
          return;
        }
        setState((current) => ({
          ...current,
          vipCompetitions: current.vipCompetitions.map((vip) => (vip.id === detail.id ? detail : vip)),
        }));
        setLoadedVipDetailIds((current) => (current.includes(vipId) ? current : [...current, vipId]));
      } catch {
        return;
      } finally {
        if (!cancelled) {
          setLoadingVipBoardId((current) => (current === vipId ? "" : current));
        }
      }
    }

    void loadVipBoard();
    return () => {
      cancelled = true;
    };
  }, [loadedVipDetailIds, selectedBoardId]);

  const approvedVipCompetitions = useMemo(
    () => state.vipCompetitions.filter((vip) => vip.my_membership?.status === "approved"),
    [state.vipCompetitions],
  );
  const liveSeasons = useMemo(
    () =>
      getLiveSeasons(state.seasons).slice().sort((left, right) => {
        if (left.is_active !== right.is_active) {
          return left.is_active ? -1 : 1;
        }
        if (left.tournament_format !== right.tournament_format) {
          return left.tournament_format === "standard" ? -1 : 1;
        }
        return left.name.localeCompare(right.name, "es-MX");
      }),
    [state.seasons],
  );
  const boardOptions = useMemo<RankingBoardOption[]>(() => {
    return [
      ...liveSeasons.map((season) => ({
        value: `season:${season.id}`,
        label: `Torneo regular · ${season.name}`,
      })),
      ...approvedVipCompetitions.map((vip) => ({
        value: `vip:${vip.id}`,
        label: vip.name,
      })),
    ];
  }, [approvedVipCompetitions, liveSeasons]);
  const selectedVipCompetition = useMemo(
    () =>
      selectedBoardId.startsWith("vip:")
        ? approvedVipCompetitions.find((vip) => vip.id === selectedBoardId.slice(4)) ?? null
        : null,
    [approvedVipCompetitions, selectedBoardId],
  );
  const selectedRegularSeason = useMemo(
    () =>
      selectedBoardId.startsWith("season:")
        ? liveSeasons.find((season) => season.id === selectedBoardId.slice(7)) ?? null
        : null,
    [liveSeasons, selectedBoardId],
  );
  const activeEntries = useMemo<RankingEntry[]>(
    () =>
      selectedVipCompetition
        ? selectedVipCompetition.leaderboard
        : selectedRegularSeason
          ? state.overallBySeasonId[selectedRegularSeason.id] ?? []
          : [],
    [selectedRegularSeason, selectedVipCompetition, state.overallBySeasonId],
  );
  const activeSectionLabel = selectedVipCompetition ? "Tabla VIP" : "Tabla general";
  const activeParticipantsCount = selectedVipCompetition
    ? selectedVipCompetition.approved_members_count
    : selectedRegularSeason
      ? state.participantCountBySeasonId[selectedRegularSeason.id] ?? activeEntries.length
      : activeEntries.length;
  const myActiveEntry = activeEntries.find((entry) => entry.profile_id === state.me?.id) ?? null;
  const activeWeeklyPrizes = selectedRegularSeason
    ? state.weeklyPrizesBySeasonId[selectedRegularSeason.id] ?? []
    : [];
  const isLoadingActiveVipBoard = Boolean(selectedVipCompetition && loadingVipBoardId === selectedVipCompetition.id);
  const hasSeasonParticipantsWithoutStandings = Boolean(
    selectedRegularSeason && activeEntries.length === 0 && activeParticipantsCount > 0,
  );

  useEffect(() => {
    if (boardOptions.length === 0) {
      if (selectedBoardId !== "") {
        setSelectedBoardId("");
      }
      return;
    }

    const currentStillExists = boardOptions.some((option) => option.value === selectedBoardId);
    if (!currentStillExists) {
      const selectedSeasonBoardId = state.selectedSeason ? `season:${state.selectedSeason.id}` : "";
      const fallbackBoardId =
        selectedSeasonBoardId && boardOptions.some((option) => option.value === selectedSeasonBoardId)
          ? selectedSeasonBoardId
          : boardOptions[0].value;
      setSelectedBoardId(fallbackBoardId);
    }
  }, [boardOptions, selectedBoardId, state.selectedSeason]);

  useEffect(() => {
    if (!state.selectedSeason || selectedBoardId.startsWith("vip:")) {
      return;
    }
    const selectedSeasonBoardId = `season:${state.selectedSeason.id}`;
    if (selectedBoardId !== selectedSeasonBoardId && boardOptions.some((option) => option.value === selectedSeasonBoardId)) {
      setSelectedBoardId(selectedSeasonBoardId);
    }
  }, [boardOptions, selectedBoardId, state.selectedSeason]);

  useEffect(() => {
    function refreshWhenVisible() {
      if (
        document.visibilityState === "visible" &&
        Date.now() - lastLoadedAtRef.current >= LEADERBOARD_VISIBILITY_REFRESH_STALE_MS
      ) {
        void loadLeaderboard();
      }
    }

    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [loadLeaderboard]);

  if (loading) {
    return <p className="text-sm text-ink/60">Cargando tabla general...</p>;
  }

  if (state.error) {
    return <p className="text-sm text-coral">{state.error}</p>;
  }

  if (boardOptions.length === 0) {
    return (
      <div className="space-y-3">
        <h1 className="page-title">Ranking</h1>
        <p className="text-sm text-steel">
          Todavia no tienes torneos activos con ranking disponible. Cuando admin te active en una temporada o VIP,
          aparecera aqui.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="page-header">
        <div className="space-y-3">
          <div className="min-w-0 max-w-3xl">
            <h1 className="page-title">Ranking</h1>
          </div>
          <div className="max-w-md">
            <label className="page-context-label">
              <span>Torneo</span>
              <select
                value={selectedBoardId}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  setSelectedBoardId(nextValue);
                  if (nextValue.startsWith("season:")) {
                    const nextSeasonId = nextValue.slice(7);
                    if (nextSeasonId) {
                      setSeasonId(nextSeasonId, "");
                    }
                    return;
                  }
                  if (nextValue.startsWith("vip:")) {
                    const nextVip = approvedVipCompetitions.find((vip) => vip.id === nextValue.slice(4)) ?? null;
                    if (nextVip?.season_id) {
                      setSeasonId(nextVip.season_id, "");
                    }
                  }
                }}
                className="page-context-select"
              >
                {boardOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {isLoadingActiveVipBoard ? (
          <p className="text-sm text-steel">Cargando tabla VIP...</p>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-3 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,0.8fr)_minmax(0,0.8fr)]">
          <div className="space-y-1">
            <p className="text-[10px] uppercase tracking-[0.24em] text-steel">Lider</p>
            <p className="mt-2 text-sm font-semibold text-ink">
              {activeEntries[0]?.display_name ?? "Sin clasificacion"}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-[10px] uppercase tracking-[0.24em] text-steel">Puntos</p>
            <p className="mt-2 text-sm font-semibold text-ink">
              {activeEntries[0] ? `${activeEntries[0].total_points} pts` : "Pendiente"}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-[10px] uppercase tracking-[0.24em] text-steel">Jugadores</p>
            <p className="mt-2 text-sm font-semibold text-ink">{activeParticipantsCount}</p>
          </div>
        </div>
        <div className="mt-5 grid gap-4 border-t border-white/[0.08] pt-4 sm:grid-cols-3 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,0.8fr)_minmax(0,0.8fr)]">
          <div>
            <p className="text-[10px] uppercase tracking-[0.24em] text-steel">Tu posición</p>
            <p className="mt-1 truncate text-sm font-semibold text-ink">{myActiveEntry?.display_name ?? state.me?.display_name ?? "Sin posición"}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-steel">Puntos</p>
            <p className="mt-1 text-sm font-semibold text-ink">{myActiveEntry ? `${myActiveEntry.total_points} pts` : "—"}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-steel">Lugar</p>
            <p className="mt-1 text-sm font-semibold text-ink">{myActiveEntry ? `#${myActiveEntry.rank_position}` : "—"}</p>
          </div>
        </div>
      </header>

      <section className="space-y-3">
        <div className="flex flex-wrap gap-x-8 gap-y-3 border-b border-white/[0.08]">
          <button
            type="button"
            onClick={() => setActiveView("overall")}
            className={activeView === "overall" ? "tab-control tab-control-active" : "tab-control"}
          >
            {activeSectionLabel}
          </button>
          <button
            type="button"
            onClick={() => setActiveView("weekly-prizes")}
            className={activeView === "weekly-prizes" ? "tab-control tab-control-active" : "tab-control"}
          >
            Premios por jornada
          </button>
        </div>

        {activeView === "overall" ? <div className="overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
              {activeEntries.map((entry) => (
                <tr key={entry.profile_id} className={`app-table-row border-b last:border-b-0 ${entry.profile_id === state.me?.id ? "font-semibold text-[#4f7df3] [&>td]:text-[#4f7df3]" : ""}`}>
                  <td className="px-3 py-3 font-semibold">{entry.rank_position}</td>
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

          {activeEntries.length === 0 ? (
            <p className="py-6 text-sm text-steel">
              {hasSeasonParticipantsWithoutStandings
                ? "Ya hay inscritos en este torneo, pero aun no hay resultados oficiales ni puntos calculados."
                : "Aun no hay posiciones calculadas."}
            </p>
          ) : null}
        </div> : selectedVipCompetition ? (
          <p className="py-6 text-sm text-steel">Los premios por jornada corresponden a los torneos regulares.</p>
        ) : activeWeeklyPrizes.length === 0 ? (
          <p className="py-6 text-sm text-steel">Todavía no hay jornadas cerradas con premios calculados.</p>
        ) : (
          <div className="divide-y divide-white/[0.08] border-t border-white/[0.08]">
            {activeWeeklyPrizes.map((matchday) => (
              <section key={matchday.matchday_id} className="py-5">
                <div className="flex items-baseline justify-between gap-4">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.22em] text-steel">Jornada {matchday.matchday_number}</p>
                    <h2 className="mt-1 text-base font-semibold text-ink">{matchday.matchday_name}</h2>
                  </div>
                  <p className="text-sm font-semibold text-ink">
                    {new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 2 }).format(matchday.total_prize_amount)}
                  </p>
                </div>
                <div className="mt-4 overflow-x-auto">
                  <table className="min-w-[620px] w-full table-fixed text-sm">
                    <thead className="app-table-head">
                      <tr>
                        <th className="w-20 px-3 py-3 text-left">Lugar</th>
                        <th className="px-3 py-3 text-left">Jugador</th>
                        <th className="w-28 px-3 py-3 text-center">Puntos</th>
                        <th className="w-28 px-3 py-3 text-center">Exactos</th>
                        <th className="w-32 px-3 py-3 text-right">Premio</th>
                      </tr>
                    </thead>
                    <tbody>
                      {matchday.winners.map((winner) => (
                        <tr key={winner.profile_id} className={`app-table-row border-b last:border-b-0 ${winner.profile_id === state.me?.id ? "font-semibold text-[#4f7df3] [&>td]:text-[#4f7df3]" : ""}`}>
                          <td className="px-3 py-3 font-semibold">#{winner.rank_position}</td>
                          <td className="px-3 py-3 font-medium">{winner.display_name}</td>
                          <td className="px-3 py-3 text-center">{winner.total_points}</td>
                          <td className="px-3 py-3 text-center">{winner.exact_scores}</td>
                          <td className="px-3 py-3 text-right font-semibold">
                            {new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 2 }).format(winner.prize_amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
