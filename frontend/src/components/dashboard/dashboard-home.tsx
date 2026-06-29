"use client";

import { useEffect, useRef, useState } from "react";

import { AdvancedStatsPanel } from "@/components/dashboard/advanced-stats-panel";
import { MatchdayPointsTable } from "@/components/dashboard/matchday-points-table";
import { PickResultsTable } from "@/components/dashboard/pick-results-table";
import { PerformanceRaceChart } from "@/components/dashboard/performance-race-chart";
import { Card } from "@/components/ui/card";
import { backendFetch, CATALOG_CACHE_TTL_MS, MATCHDAY_CACHE_TTL_MS } from "@/lib/api/backend";
import { VIP_SUMMARY_PATH, buildVipDetailPath } from "@/lib/api/vip";
import { filterMatchdaysBySeason, resolveSeasonForContext, useDashboardSeasonParam } from "@/lib/dashboard-season";
import { formatMexicoCityDateTime } from "@/lib/datetime/mexico-city";
import { env } from "@/lib/env";
import { getBrowserAccessToken } from "@/lib/supabase/session";
import type {
  AdvancedStats,
  AppBootstrap,
  DashboardSummary,
  LeaderboardEntry,
  Match,
  Matchday,
  Me,
  MyMatchdayPointsEntry,
  PersonalTrophyRecord,
  PickResultRow,
  PerformanceRace,
  PublishedResult,
  Season,
  Team,
  VipCompetition,
} from "@/types/api";

type DashboardState = {
  me: Me | null;
  seasons: Season[];
  matchdays: Matchday[];
  selectedMatchday: Matchday | null;
  selectedSeason: Season | null;
  summary: DashboardSummary | null;
  advancedStats: AdvancedStats | null;
  performanceRace: PerformanceRace | null;
  teams: Team[];
  matches: Match[];
  pickResults: PickResultRow[];
  matchdayPoints: MyMatchdayPointsEntry[];
  leaderboard: LeaderboardEntry[];
  vipCompetitions: VipCompetition[];
  publishedResults: PublishedResult[];
  personalTrophies: PersonalTrophyRecord[];
  upcomingMatchdayGroups: {
    matchday: Matchday;
    matches: Match[];
  }[];
  error: string | null;
};

type DashboardTab = "general" | "jornada" | "proximos" | "probabilidades" | "advanced" | "premios";
type DashboardDefaultView = "regular" | `vip:${string}`;
const DASHBOARD_DEFAULT_VIEW_STORAGE_KEY = "qm-dashboard-default-view";
type SeasonMetricsCacheEntry = Pick<DashboardState, "summary" | "advancedStats" | "performanceRace" | "matchdayPoints">;

const initialState: DashboardState = {
  me: null,
  seasons: [],
  matchdays: [],
  selectedMatchday: null,
  selectedSeason: null,
  summary: null,
  advancedStats: null,
  performanceRace: null,
  teams: [],
  matches: [],
  pickResults: [],
  matchdayPoints: [],
  leaderboard: [],
  vipCompetitions: [],
  publishedResults: [],
  personalTrophies: [],
  upcomingMatchdayGroups: [],
  error: null,
};

function formatProbability(value: number | null) {
  if (value === null || Number.isNaN(value)) {
    return "-";
  }
  return `${(value * 100).toFixed(1)}%`;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatCompactSeasonName(value: string | null | undefined) {
  if (!value) {
    return "Torneo";
  }

  const match = value.match(/([A-Za-z]+)\s+(\d{4})/);
  if (!match) {
    return value;
  }

  const season = match[1];
  const year = match[2].slice(-2);
  return `${season.slice(0, 3)} ${year}`;
}

function pickPreferredMatchday(matchdays: Matchday[]) {
  const sorted = matchdays.slice().sort((left, right) => right.number - left.number);
  return (
    sorted.find((matchday) => matchday.status === "active") ??
    sorted.find((matchday) => matchday.status === "published") ??
    sorted.find((matchday) => matchday.status === "closed") ??
    sorted[0] ??
    null
  );
}

function RecognitionShelf({
  title,
  subtitle,
  description,
  rows,
  emptyMessage,
  metaLabel,
  accentClassName,
}: {
  title: string;
  subtitle: string;
  description: string;
  rows: PersonalTrophyRecord[];
  emptyMessage: string;
  metaLabel: (row: PersonalTrophyRecord) => string;
  accentClassName?: string;
}) {
  return (
    <section className={accentClassName}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-steel">{subtitle}</p>
          <h2 className="mt-1.5 text-lg font-semibold text-ink sm:mt-2 sm:text-2xl">{title}</h2>
          <p className="mt-1.5 max-w-md text-xs text-steel sm:mt-2 sm:text-sm">{description}</p>
        </div>
        <p className="text-[11px] text-steel sm:text-sm">{rows.length} reconocimientos</p>
      </div>

      {rows.length > 0 ? (
        <>
          <div className="mt-4 hidden grid-cols-[72px_1fr_0.8fr_0.7fr] gap-3 border-b border-white/10 pb-2 text-[10px] uppercase tracking-[0.14em] text-steel/80 md:grid">
            <p className="text-center">Badge</p>
            <p>Nombre</p>
            <p className="text-center">Tipo</p>
            <p className="text-center">Pts</p>
          </div>
          <div className="space-y-2 md:space-y-0">
            {rows.map((trophy) => (
              <div
                key={trophy.id}
                className="grid grid-cols-[56px_1fr_0.7fr_0.55fr] items-center gap-2 border-b border-white/5 py-2 last:border-b-0 md:grid-cols-[72px_1fr_0.8fr_0.7fr] md:gap-3"
              >
                <div className="flex justify-center">
                  {trophy.image_url ? (
                  <img
                    src={trophy.image_url}
                    alt={trophy.trophy_name ?? trophy.place_label}
                    className="h-10 w-10 object-contain sm:h-12 sm:w-12"
                  />
                  ) : (
                    <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-night/20 text-[9px] text-steel sm:h-12 sm:w-12">
                      N/A
                    </div>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold text-ink sm:text-sm">{trophy.trophy_name ?? "Trofeo"}</p>
                  {metaLabel(trophy) ? <p className="mt-1 text-[9px] text-steel sm:text-[11px]">{metaLabel(trophy)}</p> : null}
                </div>
                <p className="text-center text-[9px] uppercase tracking-[0.08em] text-steel sm:text-[10px]">{trophy.place_label}</p>
                <p className="text-center text-[10px] font-semibold text-ink sm:text-[11px]">{trophy.total_points}</p>
              </div>
            ))}
          </div>
        </>
      ) : (
        <p className="mt-5 text-sm text-steel">{emptyMessage}</p>
      )}
    </section>
  );
}

function TeamMiniBadge({
  crestUrl,
  name,
  useWorldCupBubbles,
}: {
  crestUrl: string | null;
  name: string;
  useWorldCupBubbles: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col items-center justify-start gap-1 self-start text-center">
      {crestUrl ? (
        useWorldCupBubbles ? (
          <div className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-white/[0.06] sm:h-10 sm:w-10">
            <img src={crestUrl} alt={name} className="h-full w-full object-cover" />
          </div>
        ) : (
          <img src={crestUrl} alt={name} className="h-7 w-7 object-contain sm:h-10 sm:w-10" />
        )
      ) : (
        <div className="flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-[8px] font-semibold uppercase text-steel sm:h-10 sm:w-10 sm:text-[10px]">
          {name.slice(0, 3)}
        </div>
      )}
      <p className="min-h-[20px] max-w-[58px] text-[8px] leading-tight text-steel sm:max-w-[88px] sm:text-[11px]">{name}</p>
    </div>
  );
}

function MatchTeamsInline({
  homeName,
  homeCrestUrl,
  awayName,
  awayCrestUrl,
  useWorldCupBubbles,
}: {
  homeName: string;
  homeCrestUrl: string | null;
  awayName: string;
  awayCrestUrl: string | null;
  useWorldCupBubbles: boolean;
}) {
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-1">
      <TeamMiniBadge crestUrl={homeCrestUrl} name={homeName} useWorldCupBubbles={useWorldCupBubbles} />
      <span className="self-start pt-2 text-[9px] font-semibold uppercase tracking-[0.12em] text-steel">vs</span>
      <TeamMiniBadge crestUrl={awayCrestUrl} name={awayName} useWorldCupBubbles={useWorldCupBubbles} />
    </div>
  );
}

function isWorldCupSeason(season: Season | null) {
  return season?.tournament_format === "world_cup";
}

function readSettledValue<T>(result: PromiseSettledResult<T>, fallback: T) {
  return result.status === "fulfilled" ? result.value : fallback;
}

function readStoredDashboardDefaultView(): DashboardDefaultView {
  if (typeof window === "undefined") {
    return "regular";
  }

  const value = window.localStorage.getItem(DASHBOARD_DEFAULT_VIEW_STORAGE_KEY);
  if (value?.startsWith("vip:")) {
    return value as DashboardDefaultView;
  }
  return "regular";
}

function writeStoredDashboardDefaultView(value: DashboardDefaultView) {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(DASHBOARD_DEFAULT_VIEW_STORAGE_KEY, value);
  }
}

export function DashboardHome() {
  const [state, setState] = useState<DashboardState>(initialState);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<DashboardTab>("general");
  const [selectedVipBoardId, setSelectedVipBoardId] = useState("");
  const [isTabMenuOpen, setIsTabMenuOpen] = useState(false);
  const [dashboardDefaultView, setDashboardDefaultView] = useState<DashboardDefaultView>(readStoredDashboardDefaultView);
  const [hasAppliedDashboardDefault, setHasAppliedDashboardDefault] = useState(false);
  const [loadedVipDetailIds, setLoadedVipDetailIds] = useState<string[]>([]);
  const seasonMetricsCacheRef = useRef<Record<string, SeasonMetricsCacheEntry>>({});
  const { seasonId: seasonIdParam, competitionId, setSeasonId } = useDashboardSeasonParam();

  async function loadSeasonMetrics(
    seasonId: string,
    accessToken?: string,
  ): Promise<SeasonMetricsCacheEntry> {
    const [matchdayPointsResult, summaryResult, advancedStatsResult, performanceRaceResult] =
      await Promise.allSettled([
        backendFetch<MyMatchdayPointsEntry[]>(
          `/leaderboard/my-matchdays?season_id=${seasonId}`,
          accessToken,
          { cacheTtlMs: MATCHDAY_CACHE_TTL_MS },
        ),
        backendFetch<DashboardSummary>(
          `/me/dashboard-summary?season_id=${seasonId}`,
          accessToken,
          { cacheTtlMs: MATCHDAY_CACHE_TTL_MS },
        ),
        backendFetch<AdvancedStats>(
          `/me/advanced-stats?season_id=${seasonId}`,
          accessToken,
          { cacheTtlMs: MATCHDAY_CACHE_TTL_MS },
        ),
        backendFetch<PerformanceRace>(
          `/leaderboard/my-race?season_id=${seasonId}`,
          accessToken,
          { cacheTtlMs: MATCHDAY_CACHE_TTL_MS },
        ),
      ]);

    return {
      matchdayPoints: readSettledValue(matchdayPointsResult, []),
      summary: readSettledValue(summaryResult, null),
      advancedStats: readSettledValue(advancedStatsResult, null),
      performanceRace: readSettledValue(performanceRaceResult, null),
    };
  }

  async function loadSupplementalDashboardData(
    seasonId: string | null,
    accessToken?: string,
  ) {
    const [personalTrophiesResult, vipCompetitionsResult, leaderboardResult] = await Promise.allSettled([
      backendFetch<PersonalTrophyRecord[]>("/me/trophies", accessToken),
      backendFetch<VipCompetition[]>(VIP_SUMMARY_PATH, accessToken, { cacheTtlMs: CATALOG_CACHE_TTL_MS }),
      seasonId
        ? backendFetch<LeaderboardEntry[]>(`/leaderboard/overall?season_id=${seasonId}`, accessToken, {
            cacheTtlMs: MATCHDAY_CACHE_TTL_MS,
          })
        : Promise.resolve([] as LeaderboardEntry[]),
    ]);

    setState((current) => ({
      ...current,
      personalTrophies: readSettledValue(personalTrophiesResult, current.personalTrophies),
      vipCompetitions: readSettledValue(vipCompetitionsResult, current.vipCompetitions),
      leaderboard: readSettledValue(leaderboardResult, current.leaderboard),
    }));
  }

  async function loadSelectedMatchday(matchdayId: string, seasonsOverride?: Season[], matchdaysOverride?: Matchday[]) {
    try {
      setLoading(true);
      const accessToken = await getBrowserAccessToken().catch(() => undefined);
      const seasons = seasonsOverride ?? state.seasons;
      const matchdays = matchdaysOverride ?? state.matchdays;
      const selectedMatchday = matchdays.find((matchday) => matchday.id === matchdayId) ?? null;

      if (!selectedMatchday) {
        setState((current) => ({
          ...current,
          selectedMatchday: null,
          selectedSeason: current.selectedSeason,
          summary: null,
          advancedStats: null,
          performanceRace: null,
          matches: [],
          pickResults: [],
          matchdayPoints: [],
          error: null,
        }));
        return;
      }

      const selectedSeason =
        seasons.find((season) => season.id === selectedMatchday.season_id) ??
        resolveSeasonForContext(seasons, seasonIdParam, competitionId);
      const seasonMetricsId = selectedSeason?.id ?? selectedMatchday.season_id;
      const cachedSeasonMetrics = seasonMetricsCacheRef.current[seasonMetricsId] ?? null;
      const [matchesResult, pickResultsResult] = await Promise.allSettled([
        backendFetch<Match[]>(`/matches?matchday_id=${selectedMatchday.id}`, accessToken, {
          cacheTtlMs: MATCHDAY_CACHE_TTL_MS,
        }),
        backendFetch<PickResultRow[]>(`/my-pick-results?matchday_id=${selectedMatchday.id}`, accessToken, {
          cacheTtlMs: MATCHDAY_CACHE_TTL_MS,
        }),
      ]);
      const seasonMetrics =
        cachedSeasonMetrics ??
        (await loadSeasonMetrics(seasonMetricsId, accessToken));
      if (!cachedSeasonMetrics) {
        seasonMetricsCacheRef.current[seasonMetricsId] = seasonMetrics;
      }

      const matches = readSettledValue(matchesResult, []);
      const pickResults = readSettledValue(pickResultsResult, []);

      setState((current) => ({
        ...current,
        seasons,
        matchdays,
        selectedMatchday,
        selectedSeason,
        summary: seasonMetrics.summary,
        advancedStats: seasonMetrics.advancedStats,
        performanceRace: seasonMetrics.performanceRace,
        matches,
        pickResults,
        matchdayPoints: seasonMetrics.matchdayPoints,
        error: null,
      }));
    } catch {
      setState((current) => ({
        ...current,
        selectedMatchday: matchdaysOverride?.find((matchday) => matchday.id === matchdayId) ?? current.selectedMatchday,
        summary: null,
        advancedStats: null,
        performanceRace: null,
        matches: [],
        pickResults: [],
        matchdayPoints: [],
        error: null,
      }));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    async function load() {
      try {
        const accessToken = await getBrowserAccessToken().catch(() => undefined);

        const bootstrap = await backendFetch<AppBootstrap>("/bootstrap", accessToken, {
          cacheTtlMs: MATCHDAY_CACHE_TTL_MS,
        });
        const {
          me,
          seasons,
          matchdays,
          active_matchdays: activeMatchdays,
          teams,
        } = bootstrap;

        const preferredSeason = resolveSeasonForContext(seasons, seasonIdParam, competitionId);
        const preferredSeasonMatchdays = preferredSeason ? filterMatchdaysBySeason(matchdays, preferredSeason.id) : [];
        const selectedMatchday =
          (preferredSeason
            ? activeMatchdays.find((matchday) => matchday.season_id === preferredSeason.id) ??
              pickPreferredMatchday(preferredSeasonMatchdays)
            : null) ??
          null;
        const selectedSeason =
          preferredSeason ??
          seasons.find((season) => season.id === selectedMatchday?.season_id) ??
          null;

        if (selectedSeason) {
          const nextCompetitionId = selectedSeason.competition_id ?? "";
          if (selectedSeason.id !== seasonIdParam || competitionId !== nextCompetitionId) {
            setSeasonId(selectedSeason.id, nextCompetitionId);
          }
        }

        setState((current) => ({
          ...current,
          me,
          seasons,
          matchdays,
          selectedMatchday,
          selectedSeason,
          teams,
          error: null,
        }));

        void loadSupplementalDashboardData(selectedSeason?.id ?? null, accessToken);

        if (selectedMatchday) {
          await loadSelectedMatchday(selectedMatchday.id, seasons, matchdays);
        } else {
          setLoading(false);
        }
      } catch (error) {
        setState((current) => ({
          ...current,
          error:
            error instanceof Error
              ? error.message
              : "No se pudo cargar el dashboard",
        }));
        setLoading(false);
      }
    }

    void load();
  }, [competitionId, seasonIdParam, setSeasonId]);

  useEffect(() => {
    const approvedVipCompetitions = state.vipCompetitions.filter((vip) => vip.my_membership?.status === "approved");
    const selectedVipIdFromView = dashboardDefaultView.startsWith("vip:") ? dashboardDefaultView.slice(4) : selectedVipBoardId;
    const selectedVipCompetition =
      approvedVipCompetitions.find((vip) => vip.id === selectedVipIdFromView) ??
      approvedVipCompetitions.find((vip) => vip.id === selectedVipBoardId) ??
      null;

    if (!selectedVipCompetition || loadedVipDetailIds.includes(selectedVipCompetition.id)) {
      return;
    }

    const vipId = selectedVipCompetition.id;
    let cancelled = false;
    async function loadVipDetails() {
      try {
        const accessToken = await getBrowserAccessToken().catch(() => undefined);
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
        setLoadedVipDetailIds((current) => (current.includes(detail.id) ? current : [...current, detail.id]));
      } catch {
        return;
      }
    }

    void loadVipDetails();
    return () => {
      cancelled = true;
    };
  }, [dashboardDefaultView, loadedVipDetailIds, selectedVipBoardId, state.vipCompetitions]);

  useEffect(() => {
    async function loadUpcomingMatchdays() {
      if (activeTab !== "proximos" || !state.selectedSeason) {
        return;
      }

      try {
        const accessToken = await getBrowserAccessToken();
        const seasonRows = state.matchdays
          .filter((matchday) => matchday.season_id === state.selectedSeason?.id)
          .sort((left, right) => left.number - right.number);
        const now = Date.now();
        const upcomingByStatus = seasonRows.filter(
          (matchday) =>
            matchday.status === "draft" || matchday.status === "active",
        );
        const futureMatchdays = seasonRows.filter(
          (matchday) =>
            matchday.status !== "published" &&
            matchday.status !== "closed" &&
            new Date(matchday.ends_at).getTime() >= now,
        );
        const targetMatchdays =
          upcomingByStatus.length > 0
            ? upcomingByStatus
            : futureMatchdays.length > 0
            ? futureMatchdays
            : seasonRows
                .filter(
                  (matchday) =>
                    matchday.status === "draft" || matchday.status === "active",
                )
                .sort((left, right) => left.number - right.number);

        const groups = await Promise.all(
          targetMatchdays.map(async (matchday) => ({
            matchday,
            matches: await backendFetch<Match[]>(`/matches?matchday_id=${matchday.id}`, accessToken),
          })),
        );

        setState((current) => ({
          ...current,
          upcomingMatchdayGroups: groups,
        }));
      } catch {
        setState((current) => ({
          ...current,
          upcomingMatchdayGroups: [],
        }));
      }
    }

    void loadUpcomingMatchdays();
  }, [activeTab, state.selectedMatchday?.number, state.selectedSeason, state.matchdays]);

  useEffect(() => {
    const approvedVipCompetitions = state.vipCompetitions.filter((vip) => vip.my_membership?.status === "approved");

    if (approvedVipCompetitions.length > 0) {
      const stillSelected = approvedVipCompetitions.some((vip) => vip.id === selectedVipBoardId);
      if (!stillSelected) {
        setSelectedVipBoardId(approvedVipCompetitions[0].id);
      }
    }
  }, [selectedVipBoardId, state.vipCompetitions]);

  useEffect(() => {
    if (loading || hasAppliedDashboardDefault) {
      return;
    }

    const approvedVipCompetitions = state.vipCompetitions.filter((vip) => vip.my_membership?.status === "approved");
    const selectedSeasonMembership =
      state.selectedSeason && state.me
        ? state.me.season_memberships.find((membership) => membership.season_id === state.selectedSeason?.id) ?? null
        : null;
    const canViewRegularDashboard = Boolean(selectedSeasonMembership?.can_participate);
    if (dashboardDefaultView.startsWith("vip:")) {
      const vipId = dashboardDefaultView.slice(4);
      const vipExists = approvedVipCompetitions.some((vip) => vip.id === vipId);
      if (vipExists) {
        setSelectedVipBoardId(vipId);
      } else {
        const fallbackView = canViewRegularDashboard
          ? "regular"
          : approvedVipCompetitions[0]
            ? (`vip:${approvedVipCompetitions[0].id}` as DashboardDefaultView)
            : "regular";
        setDashboardDefaultView(fallbackView);
        writeStoredDashboardDefaultView(fallbackView);
      }
    } else if (!canViewRegularDashboard && approvedVipCompetitions[0]) {
      const fallbackView = `vip:${approvedVipCompetitions[0].id}` as DashboardDefaultView;
      setDashboardDefaultView(fallbackView);
      writeStoredDashboardDefaultView(fallbackView);
      setSelectedVipBoardId(approvedVipCompetitions[0].id);
    }

    setHasAppliedDashboardDefault(true);
  }, [dashboardDefaultView, hasAppliedDashboardDefault, loading, state.me, state.selectedSeason, state.vipCompetitions]);

  function handleDashboardDefaultViewChange(value: string) {
    const nextValue: DashboardDefaultView = value.startsWith("vip:") ? (value as DashboardDefaultView) : "regular";
    const approvedVipCompetitions = state.vipCompetitions.filter((vip) => vip.my_membership?.status === "approved");
    const selectedSeasonMembership =
      state.selectedSeason && state.me
        ? state.me.season_memberships.find((membership) => membership.season_id === state.selectedSeason?.id) ?? null
        : null;
    const canViewRegularDashboard = Boolean(selectedSeasonMembership?.can_participate);
    const safeValue =
      nextValue === "regular" && !canViewRegularDashboard
        ? approvedVipCompetitions[0]
          ? (`vip:${approvedVipCompetitions[0].id}` as DashboardDefaultView)
          : "regular"
        : nextValue;

    setDashboardDefaultView(safeValue);
    writeStoredDashboardDefaultView(safeValue);

    if (safeValue.startsWith("vip:")) {
      const vipId = safeValue.slice(4);
      const vipExists = approvedVipCompetitions.some((vip) => vip.id === vipId);
      if (vipExists) {
        setSelectedVipBoardId(vipId);
        setActiveTab("general");
        setIsTabMenuOpen(false);
        return;
      }
    }

    setActiveTab("general");
    setIsTabMenuOpen(false);
  }

  if (loading) {
    return <p className="text-sm text-ink/60">Cargando dashboard...</p>;
  }

  if (state.error) {
    return <p className="text-sm text-coral">{state.error}</p>;
  }

  const favoriteTeam = state.teams.find((team) => team.id === state.me?.favorite_team_id) ?? null;
  const headerLogoUrl = favoriteTeam?.crest_url ?? env.worldCupLogoUrl;
  const headerLogoLabel = favoriteTeam?.name ?? "FIFA World Cup";
  const matchesWithProbabilities = state.matches.filter(
    (match) =>
      match.home_win_probability !== null &&
      match.draw_probability !== null &&
      match.away_win_probability !== null,
  );
  const seasonMatchdays = state.selectedSeason
    ? state.matchdays
        .filter((matchday) => matchday.season_id === state.selectedSeason?.id)
        .sort((left, right) => left.number - right.number)
    : state.matchdays.slice().sort((left, right) => left.number - right.number);
  const selectedIndex = seasonMatchdays.findIndex((matchday) => matchday.id === state.selectedMatchday?.id);
  const previousMatchday = selectedIndex > 0 ? seasonMatchdays[selectedIndex - 1] : null;
  const nextMatchday =
    selectedIndex >= 0 && selectedIndex < seasonMatchdays.length - 1 ? seasonMatchdays[selectedIndex + 1] : null;
  const summaryAverage = (state.summary?.average_points_per_matchday ?? 0).toFixed(1);
  const summaryProjectedTotal = (state.summary?.projected_total_points ?? 0).toFixed(1);
  const dashboardSelectClass =
    "field-control text-xs";
  const showsMatchdayControls = activeTab === "jornada" || activeTab === "probabilidades";
  const trophyRecords = state.personalTrophies.filter((row) => row.recognition_type === "trophy");
  const awardRecords = state.personalTrophies.filter((row) => row.recognition_type === "award");
  const teamCrestById = new Map(state.teams.map((team) => [team.id, team.crest_url]));
  const teamShortNameById = new Map(state.teams.map((team) => [team.id, team.short_name]));
  const selectedSeasonMembership =
    state.selectedSeason && state.me
      ? state.me.season_memberships.find((membership) => membership.season_id === state.selectedSeason?.id) ?? null
      : null;
  const approvedVipCompetitions = state.vipCompetitions.filter((vip) => vip.my_membership?.status === "approved");
  const hasApprovedVipCompetition = approvedVipCompetitions.length > 0;
  const canViewRegularDashboard = Boolean(selectedSeasonMembership?.can_participate);
  const selectedVipIdFromView = dashboardDefaultView.startsWith("vip:") ? dashboardDefaultView.slice(4) : "";
  const selectedVipCompetition =
    approvedVipCompetitions.find((vip) => vip.id === selectedVipIdFromView) ??
    approvedVipCompetitions.find((vip) => vip.id === selectedVipBoardId) ??
    approvedVipCompetitions[0] ??
    null;
  const dashboardDefaultOptions: Array<{ value: DashboardDefaultView; label: string }> = [
    ...(canViewRegularDashboard ? [{ value: "regular" as DashboardDefaultView, label: "Torneo regular" }] : []),
    ...approvedVipCompetitions.map((vip) => ({
      value: `vip:${vip.id}` as DashboardDefaultView,
      label: vip.name,
    })),
  ];
  const dashboardDefaultValue = dashboardDefaultOptions.some((option) => option.value === dashboardDefaultView)
    ? dashboardDefaultView
    : dashboardDefaultOptions[0]?.value ?? "regular";
  const myVipEntry =
    selectedVipCompetition?.leaderboard.find((entry) => entry.profile_id === state.me?.id) ?? null;
  const vipMatchdayPoints = selectedVipCompetition?.matchday_points ?? [];
  const vipPerformanceRace = selectedVipCompetition?.performance_race ?? null;
  const vipCompletedMatchdays = vipPerformanceRace?.completed_matchdays ?? vipMatchdayPoints.length;
  const vipAverage =
    vipCompletedMatchdays > 0 ? ((myVipEntry?.total_points ?? 0) / vipCompletedMatchdays).toFixed(1) : "0.0";
  const vipProjectedTotal = (vipPerformanceRace?.projected_user_total ?? myVipEntry?.total_points ?? 0).toFixed(1);
  const isVipDashboardContext = dashboardDefaultValue.startsWith("vip:") && selectedVipCompetition !== null;
  const activeMatchdayPoints = isVipDashboardContext ? vipMatchdayPoints : state.matchdayPoints;
  const activePerformanceRace = isVipDashboardContext ? vipPerformanceRace : state.performanceRace;
  const activeContextName = isVipDashboardContext
    ? selectedVipCompetition?.name ?? "VIP"
    : state.summary?.season_name ?? state.selectedSeason?.name ?? "Torneo sin definir";
  const activeCompactContextLabel = formatCompactSeasonName(activeContextName);
  const activeTotalPoints = isVipDashboardContext ? myVipEntry?.total_points ?? 0 : state.summary?.total_points ?? 0;
  const activeRank = isVipDashboardContext ? myVipEntry?.rank_position ?? null : state.summary?.overall_rank ?? null;
  const activeCompletedMatchdays = isVipDashboardContext
    ? vipCompletedMatchdays
    : state.summary?.completed_matchdays ?? 0;
  const activeAverage = isVipDashboardContext ? vipAverage : summaryAverage;
  const activeProjectedTotal = isVipDashboardContext ? vipProjectedTotal : summaryProjectedTotal;
  const activeThirdMetricLabel = isVipDashboardContext ? "Bolsa VIP" : "Premios por jornada";
  const activeThirdMetricValue = isVipDashboardContext
    ? formatCurrency(selectedVipCompetition?.gross_pool_amount ?? 0)
    : String(state.summary?.weekly_prizes_count ?? 0);
  const activeThirdMetricHint = isVipDashboardContext ? "Pool bruto de la competencia" : "Top 3 por jornada";
  const activeRankLabel = isVipDashboardContext ? "Lugar VIP" : "Lugar general";
  const activeRankHint = isVipDashboardContext
    ? `${selectedVipCompetition?.approved_members_count ?? 0} jugadores en competencia`
    : `${activeCompletedMatchdays} jornadas calificadas`;
  const prizeRows = activeMatchdayPoints.filter((row) => row.rank_position !== null && row.rank_position <= 3);
  const totalWeeklyPrizeAmount = prizeRows.reduce((sum, row) => sum + row.weekly_prize_amount, 0);
  const dashboardTabs: Array<{ id: DashboardTab; label: string }> = [
    { id: "general", label: "General" },
    { id: "jornada", label: "Jornada" },
    { id: "proximos", label: "Proximos juegos" },
    { id: "probabilidades", label: "Probabilidades" },
    { id: "advanced", label: "E. Avanzadas" },
    { id: "premios", label: "Premios" },
  ];
  const activeTabLabel = dashboardTabs.find((tab) => tab.id === activeTab)?.label ?? "General";
  const summaryTileClass =
    "flex min-w-0 h-[78px] flex-col justify-between rounded-[16px] bg-transparent p-1.5 sm:h-auto sm:rounded-[30px] sm:p-5";
  const useWorldCupAbbreviation = isWorldCupSeason(state.selectedSeason);

  function getMatchTeamLabel(teamId: string | null, fallbackName: string) {
    if (!useWorldCupAbbreviation || !teamId) {
      return fallbackName;
    }
    return teamShortNameById.get(teamId) ?? fallbackName;
  }

  return (
    <div className="space-y-6 sm:space-y-8">
      <section className="relative px-1 py-2 sm:px-0 sm:py-1">
        <div className="flex items-center justify-between gap-2 sm:gap-3 lg:items-center">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center">
              <h1 className="truncate text-base font-semibold leading-tight text-ink sm:text-3xl">
                {state.me ? `Hola, ${state.me.display_name}` : "Dashboard"}
              </h1>
            </div>
            {state.me && state.selectedSeason && !selectedSeasonMembership?.can_participate && !hasApprovedVipCompetition ? (
              <div className="mt-3 max-w-2xl rounded-2xl border border-amber-300/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
                Tu cuenta esta activa y puedes entrar al dashboard, pero aun no estas dado de alta en
                {" "}{state.selectedSeason.name}. Cuando admin confirme tu acceso, te activa el torneo.
              </div>
            ) : null}
          </div>

          <div className="flex shrink-0 items-center gap-2 sm:gap-4">
            {dashboardDefaultOptions.length > 1 ? (
              <label className="hidden min-w-[180px] space-y-1 text-xs sm:block">
                <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-steel">
                  Vista dashboard
                </span>
                <select
                  value={dashboardDefaultValue}
                  onChange={(event) => handleDashboardDefaultViewChange(event.target.value)}
                  className={dashboardSelectClass}
                >
                  {dashboardDefaultOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <div className="shrink-0">
              {headerLogoUrl ? (
                <img
                  src={headerLogoUrl}
                  alt={headerLogoLabel}
                  className="h-9 w-9 object-contain sm:h-24 sm:w-24"
                />
              ) : (
                <div className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-sm font-semibold text-steel sm:h-24 sm:w-24 sm:text-2xl">
                  WC
                </div>
              )}
            </div>
          </div>
        </div>

        {dashboardDefaultOptions.length > 1 ? (
          <label className="mt-3 block space-y-1 text-xs sm:hidden">
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-steel">
              Vista dashboard
            </span>
            <select
              value={dashboardDefaultValue}
              onChange={(event) => handleDashboardDefaultViewChange(event.target.value)}
              className={dashboardSelectClass}
            >
              {dashboardDefaultOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </section>

      <section className="space-y-3">
        <div className="sm:hidden">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.22em] text-steel">Menu dashboard</p>
              <p className="mt-1 truncate text-sm font-semibold text-ink">{activeTabLabel}</p>
            </div>
            <button
              type="button"
              onClick={() => setIsTabMenuOpen((current) => !current)}
              className="app-pill px-3 text-[11px]"
            >
              {isTabMenuOpen ? "Cerrar" : "Menu"}
            </button>
          </div>

          {isTabMenuOpen ? (
            <div className="mt-3 grid grid-cols-2 gap-2">
              {dashboardTabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setActiveTab(tab.id);
                    setIsTabMenuOpen(false);
                  }}
                  className={
                    activeTab === tab.id
                      ? "app-pill-active h-10 px-3 text-center text-xs"
                      : "app-pill-ghost h-10 px-3 text-center text-xs"
                  }
                >
                  {tab.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="hidden flex-wrap gap-2 sm:flex">
          {dashboardTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={
                activeTab === tab.id
                  ? "app-pill-active px-4 text-sm"
                  : "app-pill-ghost px-4 text-sm"
              }
            >
              {tab.label}
            </button>
          ))}
        </div>
      </section>

      <section className="px-1 py-1">
        <div
          className={
            showsMatchdayControls
              ? "grid gap-2 lg:grid-cols-[minmax(0,240px)_auto] lg:items-end"
              : "grid gap-2"
          }
        >
          {showsMatchdayControls ? (
            <>
              <label className="space-y-1.5 text-xs">
                <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-steel">
                  {state.selectedSeason?.name ?? "Torneo"} · Jornada
                </span>
                <select
                  value={state.selectedMatchday?.id ?? ""}
                  onChange={(event) => void loadSelectedMatchday(event.target.value)}
                  className={dashboardSelectClass}
                >
                  <option value="">Selecciona jornada</option>
                  {seasonMatchdays.map((matchday) => (
                    <option key={matchday.id} value={matchday.id}>
                      Jornada {matchday.number} · {state.selectedSeason?.slug?.toUpperCase() ?? state.selectedSeason?.name ?? "Torneo"}
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => previousMatchday && void loadSelectedMatchday(previousMatchday.id)}
                  disabled={!previousMatchday}
                  className="app-pill px-3 text-[11px] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Anterior
                </button>
                <button
                  type="button"
                  onClick={() => nextMatchday && void loadSelectedMatchday(nextMatchday.id)}
                  disabled={!nextMatchday}
                  className="app-pill px-3 text-[11px] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Siguiente
                </button>
              </div>
            </>
          ) : null}
        </div>
      </section>

      {activeTab === "premios" ? (
        <div className="space-y-6">
          <RecognitionShelf
            title="Trofeos de historia"
            subtitle="Mis trofeos"
            description="Piezas de legado que hablan de tu historia completa, no solo de una temporada puntual."
            rows={trophyRecords}
            emptyMessage="Todavia no tienes trofeos historicos o de torneo."
            metaLabel={() => ""}
            accentClassName=""
          />
          <RecognitionShelf
            title="Awards del torneo"
            subtitle="Mis awards"
            description="Insignias del recorrido competitivo de cada torneo y sus jornadas."
            rows={awardRecords}
            emptyMessage="Todavia no tienes awards semanales."
            metaLabel={(row) => row.tournament_name}
            accentClassName=""
          />
        </div>
      ) : null}

      {activeTab === "advanced" ? (
        <AdvancedStatsPanel stats={state.advancedStats} />
      ) : activeTab === "jornada" ? (
        <PickResultsTable
          rows={state.pickResults}
          title={state.selectedMatchday ? state.selectedMatchday.name : "Jornada"}
          emptyMessage="No hay partidos cargados para la jornada seleccionada."
          useWorldCupBubbles={useWorldCupAbbreviation}
        />
      ) : activeTab === "proximos" ? (
        <section className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-4">
            <div>
              <h2 className="text-sm font-semibold text-ink sm:text-2xl">Proximos juegos</h2>
            </div>
            <p className="text-xs text-steel sm:text-sm">Vista rapida de las siguientes jornadas del torneo.</p>
          </div>

          <div className="space-y-4">
            {state.upcomingMatchdayGroups.map((group) => (
              <section key={group.matchday.id} className="border-b border-white/10 pb-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-ink">{group.matchday.name}</p>
                    <p className="mt-1 text-[10px] text-steel">
                      {formatMexicoCityDateTime(group.matchday.starts_at)} a {formatMexicoCityDateTime(group.matchday.ends_at)}
                    </p>
                  </div>
                  <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-steel">
                    {group.matches.length} partidos
                  </span>
                </div>

                {group.matches.length > 0 ? (
                  <>
                    <div className="hidden grid-cols-[1.5fr_1fr_1fr] gap-3 border-b border-white/10 pb-2 text-[10px] uppercase tracking-[0.14em] text-steel/80 md:grid">
                      <p>Partido</p>
                      <p className="text-center">Inicio</p>
                      <p className="text-center">Sede</p>
                    </div>

                    <div className="space-y-2 md:space-y-0">
                      {group.matches.map((match) => (
                        <div
                          key={match.id}
                          className="grid gap-1.5 border-b border-white/5 py-2 last:border-b-0 md:grid-cols-[1.5fr_1fr_1fr] md:items-center md:gap-3"
                        >
                          <MatchTeamsInline
                            homeName={getMatchTeamLabel(match.home_team_id, match.home_team_name)}
                            homeCrestUrl={match.home_team_id ? (teamCrestById.get(match.home_team_id) ?? null) : null}
                            awayName={getMatchTeamLabel(match.away_team_id, match.away_team_name)}
                            awayCrestUrl={match.away_team_id ? (teamCrestById.get(match.away_team_id) ?? null) : null}
                            useWorldCupBubbles={useWorldCupAbbreviation}
                          />
                          <p className="text-[10px] text-steel md:text-center">{formatMexicoCityDateTime(match.kickoff_at)}</p>
                          <p className="text-[10px] text-steel md:text-center">{match.venue ?? "Por definir"}</p>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-steel">Todavia no hay partidos cargados para esta jornada.</p>
                )}
              </section>
            ))}
            {state.upcomingMatchdayGroups.length === 0 ? (
              <p className="text-sm text-steel">No encontramos siguientes jornadas disponibles para esta temporada.</p>
            ) : null}
          </div>
        </section>
      ) : activeTab === "probabilidades" ? (
        <section className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-4">
            <div>
              <h2 className="text-sm font-semibold text-ink sm:text-2xl">Probabilidades del mercado</h2>
            </div>
          </div>

          {matchesWithProbabilities.length > 0 ? (
            <>
              <div className="hidden grid-cols-[1.5fr_1fr_0.8fr_0.8fr_0.8fr] gap-3 border-b border-white/10 pb-2 text-[10px] uppercase tracking-[0.14em] text-steel/80 md:grid">
                <p>Partido</p>
                <p className="text-center">Inicio</p>
                <p className="text-center">Local</p>
                <p className="text-center">Empate</p>
                <p className="text-center">Visita</p>
              </div>

              <div className="space-y-2 md:space-y-0">
                {matchesWithProbabilities.map((match) => (
                  <div
                    key={match.id}
                    className="grid grid-cols-[1.45fr_0.95fr_0.6fr_0.75fr_0.75fr] items-center gap-2 border-b border-white/5 py-2 last:border-b-0 md:grid-cols-[1.5fr_1fr_0.8fr_0.8fr_0.8fr] md:gap-3"
                  >
                    <MatchTeamsInline
                      homeName={getMatchTeamLabel(match.home_team_id, match.home_team_name)}
                      homeCrestUrl={match.home_team_id ? (teamCrestById.get(match.home_team_id) ?? null) : null}
                      awayName={getMatchTeamLabel(match.away_team_id, match.away_team_name)}
                      awayCrestUrl={match.away_team_id ? (teamCrestById.get(match.away_team_id) ?? null) : null}
                      useWorldCupBubbles={useWorldCupAbbreviation}
                    />
                    <p className="text-[9px] text-steel md:text-center">{formatMexicoCityDateTime(match.kickoff_at)}</p>
                    <div className="text-center">
                      <p className="text-[6px] uppercase tracking-[0.05em] text-steel/80 md:hidden">Local</p>
                      <p className="mt-1 text-[9px] font-semibold text-emerald-200 md:mt-0 md:text-[10px]">{formatProbability(match.home_win_probability)}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-[6px] uppercase tracking-[0.05em] text-steel/80 md:hidden">Empate</p>
                      <p className="mt-1 text-[9px] font-semibold text-amber-100 md:mt-0 md:text-[10px]">{formatProbability(match.draw_probability)}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-[6px] uppercase tracking-[0.05em] text-steel/80 md:hidden">Visita</p>
                      <p className="mt-1 text-[9px] font-semibold text-sky-100 md:mt-0 md:text-[10px]">{formatProbability(match.away_win_probability)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="text-sm text-steel">Todavia no hay probabilidades disponibles para la jornada seleccionada.</p>
          )}
        </section>
      ) : activeTab === "premios" ? (
        <section className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-steel">Premios</p>
              <h2 className="mt-1.5 text-lg font-semibold text-ink sm:mt-2 sm:text-2xl">Jornadas premiadas</h2>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 border-b border-white/10 pb-3">
            <div>
              <p className="text-[10px] uppercase tracking-[0.14em] text-steel">Cobrado</p>
              <p className="mt-1 text-[12px] font-semibold text-ink sm:text-lg">{formatCurrency(totalWeeklyPrizeAmount)}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.14em] text-steel">Mejor lugar</p>
              <p className="mt-1 text-[12px] font-semibold text-emerald-300 sm:text-lg">
                {prizeRows.length > 0 ? `#${Math.min(...prizeRows.map((row) => row.rank_position ?? 99))}` : "-"}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.14em] text-steel">Podios</p>
              <p className="mt-1 text-[12px] font-semibold text-ink sm:text-lg">{prizeRows.length}</p>
            </div>
          </div>

          {prizeRows.length > 0 ? (
            <>
              <div className="app-table-head hidden grid-cols-[1.3fr_0.7fr_0.7fr_0.9fr] gap-3 md:grid">
                <p>Jornada</p>
                <p className="text-center">Posicion</p>
                <p className="text-center">Puntos</p>
                <p className="text-center">Premio</p>
              </div>
              <div className="space-y-2 md:space-y-0">
                {prizeRows.map((row) => (
                  <div
                    key={row.matchday_id}
                    className="app-table-row grid grid-cols-[1.3fr_0.7fr_0.7fr_0.9fr] items-center gap-2 border-b py-2 last:border-b-0 md:gap-3"
                  >
                    <div>
                      <p className="text-[6px] uppercase tracking-[0.06em] text-steel/80 md:hidden">Jornada</p>
                      <p className="mt-1 text-[11px] font-medium text-ink md:mt-0">
                      {row.matchday_name.trim().toLowerCase().startsWith("jornada")
                        ? row.matchday_name
                        : `Jornada ${row.matchday_number}`}
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="text-[6px] uppercase tracking-[0.06em] text-steel/80 md:hidden">Posicion</p>
                      <p className="mt-1 text-[10px] font-semibold text-emerald-300 md:mt-0">{row.rank_position}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-[6px] uppercase tracking-[0.06em] text-steel/80 md:hidden">Puntos</p>
                      <p className="mt-1 text-[10px] text-ink md:mt-0">{row.total_points}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-[6px] uppercase tracking-[0.06em] text-steel/80 md:hidden">Premio</p>
                      <p className="mt-1 text-[10px] text-ink md:mt-0">{row.weekly_prize_amount > 0 ? formatCurrency(row.weekly_prize_amount) : "-"}</p>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="text-sm text-steel">Todavia no tienes jornadas premiadas en esta temporada.</p>
          )}
        </section>
      ) : activeTab === "general" ? (
        <>
          <div className="grid grid-cols-5 gap-1 md:grid-cols-2 md:gap-3 xl:grid-cols-5">
            <div className={summaryTileClass}>
              <p className="text-[6px] uppercase tracking-[0.06em] text-steel sm:text-xs sm:tracking-[0.3em]">
                <span className="sm:hidden">Pts</span>
                <span className="hidden sm:inline">Puntos acumulados</span>
              </p>
              <p className="mt-1 text-[12px] font-semibold leading-none text-ink sm:mt-2 sm:text-xl">{activeTotalPoints}</p>
              <p className="mt-1 text-[8px] leading-tight text-steel sm:mt-1.5 sm:text-sm">
                <span className="sm:hidden">{activeCompactContextLabel}</span>
                <span className="hidden sm:inline">{activeContextName}</span>
              </p>
            </div>
            <div className={summaryTileClass}>
              <p className="text-[6px] uppercase tracking-[0.06em] text-steel sm:text-xs sm:tracking-[0.3em]">
                <span className="sm:hidden">Lugar</span>
                <span className="hidden sm:inline">{activeRankLabel}</span>
              </p>
              <p className="mt-1 text-[12px] font-semibold leading-none text-coral sm:mt-2 sm:text-xl">
                {activeRank ? `#${activeRank}` : "-"}
              </p>
              <p className="mt-1 text-[8px] leading-tight text-steel sm:mt-1.5 sm:text-sm">
                <span className="sm:hidden">{activeCompletedMatchdays} jds</span>
                <span className="hidden sm:inline">{activeRankHint}</span>
              </p>
            </div>
            <div className={summaryTileClass}>
              <p className="text-[6px] uppercase tracking-[0.06em] text-steel sm:text-xs sm:tracking-[0.3em]">
                <span className="sm:hidden">{isVipDashboardContext ? "Bolsa" : "Podios"}</span>
                <span className="hidden sm:inline">{activeThirdMetricLabel}</span>
              </p>
              <p className="mt-1 text-[12px] font-semibold leading-none text-ink sm:mt-2 sm:text-xl">{activeThirdMetricValue}</p>
              <p className="mt-1 text-[8px] leading-tight text-steel sm:mt-1.5 sm:text-sm">
                <span className="sm:hidden">{isVipDashboardContext ? "pool" : "Top 3"}</span>
                <span className="hidden sm:inline">{activeThirdMetricHint}</span>
              </p>
            </div>
            <div className={summaryTileClass}>
              <p className="text-[6px] uppercase tracking-[0.06em] text-steel sm:text-xs sm:tracking-[0.3em]">
                <span className="sm:hidden">Prom</span>
                <span className="hidden sm:inline">Puntos promedio</span>
              </p>
              <p className="mt-1 text-[12px] font-semibold leading-none text-ink sm:mt-2 sm:text-xl">{activeAverage}</p>
              <p className="mt-1 text-[8px] leading-tight text-steel sm:mt-1.5 sm:text-sm">
                <span className="sm:hidden">por jd</span>
                <span className="hidden sm:inline">{isVipDashboardContext ? "Por jornada VIP calificada" : "Por jornada publicada"}</span>
              </p>
            </div>
            <div className={summaryTileClass}>
              <p className="text-[6px] uppercase tracking-[0.06em] text-steel sm:text-xs sm:tracking-[0.3em]">
                <span className="sm:hidden">Proy</span>
                <span className="hidden sm:inline">Cierre proyectado</span>
              </p>
              <p className="mt-1 text-[12px] font-semibold leading-none text-emerald-300 sm:mt-2 sm:text-xl">
                {activeProjectedTotal}
              </p>
              <p className="mt-1 text-[8px] leading-tight text-steel sm:mt-1.5 sm:text-sm">
                <span className="sm:hidden">pts</span>
                <span className="hidden sm:inline">
                  {isVipDashboardContext
                    ? `${selectedVipCompetition?.matchdays.length ?? 0} jornadas que cuentan`
                    : "Puntos proyectados al cierre"}
                </span>
              </p>
            </div>
          </div>

          <PerformanceRaceChart race={activePerformanceRace} userLabel={state.me?.display_name ?? "Tu desempeno"} />

          <MatchdayPointsTable rows={activeMatchdayPoints} />
        </>
      ) : null}
    </div>
  );
}
