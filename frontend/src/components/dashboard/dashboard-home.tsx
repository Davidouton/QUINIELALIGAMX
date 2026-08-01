"use client";

import { type ReactNode, useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { AdvancedStatsPanel } from "@/components/dashboard/advanced-stats-panel";
import { DashboardRuntimeBoundary } from "@/components/dashboard/dashboard-runtime-boundary";
import { MatchdayPointsTable } from "@/components/dashboard/matchday-points-table";
import { PickResultsTable } from "@/components/dashboard/pick-results-table";
import { PerformanceRaceChart } from "@/components/dashboard/performance-race-chart";
import { SurvivorPageContent } from "@/components/survivor/survivor-page-content";
import { backendFetch, MATCHDAY_CACHE_TTL_MS } from "@/lib/api/backend";
import { getDashboardScreenName, trackAnalyticsEvent } from "@/lib/analytics/track";
import { buildVipDetailPath } from "@/lib/api/vip";
import { getMatchdayDisplayLabel } from "@/lib/dashboard/matchday-label";
import {
  filterMatchdaysBySeason,
  getLiveSeasons,
  isSeasonArchived,
  isSurvivorAvailableForSeason,
  resolveLiveSeason,
  resolveSurvivorSeason,
  useDashboardSeasonParam,
} from "@/lib/dashboard-season";
import { formatMexicoCityDateTime } from "@/lib/datetime/mexico-city";
import { env } from "@/lib/env";
import { getBrowserAccessToken } from "@/lib/supabase/session";
import type {
  AdvancedStats,
  AppBootstrap,
  DashboardWidgetConfig,
  DashboardWidgetId,
  DashboardHomeBundle,
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
  SurvivorBoard,
  Team,
  VipCompetition,
} from "@/types/api";

type DashboardState = {
  me: Me | null;
  seasons: Season[];
  enrollmentSeasons: Season[];
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
  dashboardBundlesBySeasonId: Record<string, DashboardHomeBundle>;
  upcomingMatchdayGroupsBySeasonId: Record<
    string,
    {
      matchday: Matchday;
      matches: Match[];
    }[]
  >;
  survivorBoard: SurvivorBoard | null;
  survivorBoardsBySeasonId: Record<string, SurvivorBoard | null>;
  error: string | null;
};

type DashboardTab = "general" | "jornada" | "proximos" | "survivor" | "probabilidades" | "advanced" | "premios";
type DashboardDefaultView = "regular" | `vip:${string}`;
type DashboardLeagueOption = {
  value: string;
  label: string;
  seasons: Season[];
};
const DASHBOARD_DEFAULT_VIEW_STORAGE_KEY = "qm-dashboard-default-view";
const DEFAULT_DASHBOARD_WIDGET_IDS: DashboardWidgetId[] = [
  "summary",
  "performance",
  "matchday_points",
  "prize_summary",
  "upcoming",
  "memberships",
];
const SEASON_SCOPED_WIDGET_IDS: DashboardWidgetId[] = [
  "summary",
  "performance",
  "matchday_points",
  "matchday_results",
  "prize_summary",
  "upcoming",
  "survivor_summary",
  "ranking",
];
const DASHBOARD_WIDGET_OPTIONS: Array<{
  id: DashboardWidgetId;
  label: string;
  description: string;
}> = [
  { id: "summary", label: "Resumen", description: "KPIs principales del torneo o VIP activo." },
  { id: "performance", label: "Performance", description: "Grafica de avance contra franja de premios." },
  { id: "matchday_points", label: "Puntos por jornada", description: "Historial acumulado por jornada." },
  { id: "matchday_results", label: "Resultados por jornada", description: "Tus picks, marcador final y puntos de la jornada activa." },
  { id: "prize_summary", label: "Premios", description: "Cobros, podios y mejor posicion conseguida." },
  { id: "upcoming", label: "Proximos juegos", description: "Vista compacta de la siguiente jornada disponible." },
  { id: "memberships", label: "Membresias", description: "Estado regular, survivor y acceso VIP." },
  { id: "survivor_summary", label: "Survivor", description: "Vidas, pick actual e historial reciente del survivor por temporada." },
  { id: "ranking", label: "Ranking", description: "Primeras posiciones y tu lugar actual en el torneo." },
];
const DASHBOARD_WIDGET_PRESETS: Array<{
  id: "standard" | "competition" | "memberships" | "express";
  label: string;
  description: string;
  widgetIds: DashboardWidgetId[];
}> = [
  {
    id: "standard",
    label: "Estandar",
    description: "El arranque balanceado para la mayoria: resumen, performance, premios y agenda.",
    widgetIds: DEFAULT_DASHBOARD_WIDGET_IDS,
  },
  {
    id: "competition",
    label: "Competencia",
    description: "Pensado para seguir resultados y puntos sin tanto ruido de acceso.",
    widgetIds: ["summary", "performance", "matchday_points", "prize_summary"],
  },
  {
    id: "memberships",
    label: "Accesos",
    description: "Deja al frente tus altas, Survivor y proximos movimientos de la cuenta.",
    widgetIds: ["memberships", "summary", "upcoming", "prize_summary"],
  },
  {
    id: "express",
    label: "Express",
    description: "Una vista corta para entrar rapido, leer el estado y salir a picks.",
    widgetIds: ["summary", "upcoming", "memberships"],
  },
];

function createDashboardWidgetConfig(
  widgetId: DashboardWidgetId,
  seasonId: string | null = null,
): DashboardWidgetConfig {
  const supportsSeason = SEASON_SCOPED_WIDGET_IDS.includes(widgetId);
  const fallbackId =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${widgetId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id: fallbackId,
    widget_id: widgetId,
    season_id: supportsSeason ? seasonId : null,
  };
}

function buildDefaultDashboardWidgets() {
  return DEFAULT_DASHBOARD_WIDGET_IDS.map((widgetId) => createDashboardWidgetConfig(widgetId));
}

function widgetSupportsSeasonContext(widgetId: DashboardWidgetId) {
  return SEASON_SCOPED_WIDGET_IDS.includes(widgetId);
}

const initialState: DashboardState = {
  me: null,
  seasons: [],
  enrollmentSeasons: [],
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
  dashboardBundlesBySeasonId: {},
  upcomingMatchdayGroupsBySeasonId: {},
  survivorBoard: null,
  survivorBoardsBySeasonId: {},
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

function formatEnrollmentCountdown(lockAt: string | null, now: number) {
  if (!lockAt) return null;
  const remaining = new Date(lockAt).getTime() - now;
  if (!Number.isFinite(remaining) || remaining <= 0) return "Inscripción cerrada";
  const totalSeconds = Math.floor(remaining / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return days > 0
    ? `${days}d ${String(hours).padStart(2, "0")}h ${String(minutes).padStart(2, "0")}m`
    : `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function renderDashboardLives(remainingLives: number, maxLives: number) {
  return (
    <span className="inline-flex items-center gap-1" aria-label={`${remainingLives} de ${maxLives} vidas`}>
      {Array.from({ length: maxLives }, (_, index) => (
        <svg key={index} viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5" fill={index < remainingLives ? "#ef4444" : "#541f2a"}>
          <path d="M12 21s-7.2-4.35-9.55-8.36C.3 8.96 2.18 4.5 6.5 4.5c2.22 0 3.68 1.24 4.5 2.42.82-1.18 2.28-2.42 4.5-2.42 4.32 0 6.2 4.46 4.05 8.14C19.2 16.65 12 21 12 21Z" />
        </svg>
      ))}
    </span>
  );
}

function renderDashboardTeamCrest(name: string, shortName: string, crestUrl: string | null, className: string) {
  return crestUrl ? (
    <img src={crestUrl} alt={name} title={name} className={`${className} object-contain`} />
  ) : (
    <span className={`inline-flex items-center justify-center text-[10px] font-semibold text-steel ${className}`} title={name}>
      {shortName.slice(0, 3)}
    </span>
  );
}

function getSurvivorResultLabel(resultStatus: "pending" | "won" | "lost" | "draw") {
  if (resultStatus === "won") {
    return "Ganado";
  }
  if (resultStatus === "lost") {
    return "Perdido";
  }
  if (resultStatus === "draw") {
    return "Empate";
  }
  return "Pendiente";
}

function getSurvivorLifeStateLabel(alive: boolean, remainingLives: number) {
  if (!alive || remainingLives <= 0) {
    return "Eliminado";
  }
  return "Vivo";
}

function getSurvivorResultTone(resultStatus: "pending" | "won" | "lost" | "draw") {
  if (resultStatus === "won") {
    return "text-emerald-300";
  }
  if (resultStatus === "lost") {
    return "text-coral";
  }
  if (resultStatus === "draw") {
    return "text-amber-100";
  }
  return "text-steel";
}

function getDashboardLeagueKey(season: Season) {
  return season.competition_id ?? season.competition_name ?? season.competition_sport_name ?? season.tournament_format;
}

function getDashboardLeagueLabel(season: Season) {
  if (season.competition_name?.trim()) {
    return season.competition_name.trim();
  }
  if (season.competition_sport_name?.trim()) {
    return season.competition_sport_name.trim();
  }
  if (season.tournament_format === "world_cup") {
    return "World Cup";
  }
  return "Liga";
}

function asArray<T>(value: T[] | null | undefined) {
  return Array.isArray(value) ? value : [];
}

function normalizePerformanceRace(race: PerformanceRace | null | undefined) {
  if (!race) {
    return null;
  }
  return {
    ...race,
    points: asArray(race.points),
  };
}

function normalizeVipCompetition(vip: VipCompetition): VipCompetition {
  return {
    ...vip,
    matchdays: asArray(vip.matchdays),
    approved_members: asArray(vip.approved_members),
    leaderboard: asArray(vip.leaderboard),
    matchday_points: asArray(vip.matchday_points),
    performance_race: normalizePerformanceRace(vip.performance_race),
    team_winner_teams: asArray(vip.team_winner_teams),
    team_winner_entries: asArray(vip.team_winner_entries),
    question_pool_questions: Array.isArray(vip.question_pool_questions)
      ? vip.question_pool_questions.map((question) => ({
          ...question,
          options: asArray(question.options),
        }))
      : [],
  };
}

function normalizeDashboardHomeBundle(bundle: DashboardHomeBundle): DashboardHomeBundle {
  return {
    ...bundle,
    performance_race: normalizePerformanceRace(bundle.performance_race) ?? bundle.performance_race,
    matches: asArray(bundle.matches),
    pick_results: asArray(bundle.pick_results),
    matchday_points: asArray(bundle.matchday_points),
    personal_trophies: asArray(bundle.personal_trophies),
    vip_competitions: asArray(bundle.vip_competitions).map(normalizeVipCompetition),
    leaderboard: asArray(bundle.leaderboard),
  };
}

function normalizeMe(me: Me): Me {
  return {
    ...me,
    dashboard_widget_ids: asArray(me.dashboard_widget_ids),
    season_memberships: asArray(me.season_memberships),
  };
}

function filterSeasonsForActiveMembership(seasons: Season[], me: Me) {
  const activeSeasonIds = new Set(
    me.season_memberships
      .filter((membership) => membership.is_active)
      .map((membership) => membership.season_id),
  );
  return seasons.filter((season) => activeSeasonIds.has(season.id));
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

function buildDashboardHomePath(seasonId?: string | null, matchdayId?: string | null) {
  const params = new URLSearchParams();
  if (seasonId) {
    params.set("season_id", seasonId);
  }
  if (matchdayId) {
    params.set("matchday_id", matchdayId);
  }
  const query = params.toString();
  return query ? `/me/dashboard-home?${query}` : "/me/dashboard-home";
}

function areWidgetConfigsEqual(left: DashboardWidgetConfig[], right: DashboardWidgetConfig[]) {
  return (
    left.length === right.length &&
    left.every(
      (value, index) =>
        value.id === right[index]?.id &&
        value.widget_id === right[index]?.widget_id &&
        value.season_id === right[index]?.season_id,
    )
  );
}

function dedupeWidgetIds(widgetConfigs: DashboardWidgetConfig[]) {
  const seen = new Set<DashboardWidgetId>();
  return widgetConfigs.flatMap((widget) => {
    if (seen.has(widget.widget_id)) {
      return [];
    }
    seen.add(widget.widget_id);
    return [widget.widget_id];
  });
}

export function DashboardHome() {
  const [state, setState] = useState<DashboardState>(initialState);
  const [loading, setLoading] = useState(true);
  const [dashboardConfigSaving, setDashboardConfigSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<DashboardTab>("general");
  const [selectedVipBoardId, setSelectedVipBoardId] = useState("");
  const [isTabMenuOpen, setIsTabMenuOpen] = useState(false);
  const [isWidgetEditorOpen, setIsWidgetEditorOpen] = useState(false);
  const [dashboardWidgetDraft, setDashboardWidgetDraft] = useState<DashboardWidgetConfig[]>(buildDefaultDashboardWidgets);
  const [dashboardDefaultView, setDashboardDefaultView] = useState<DashboardDefaultView>(readStoredDashboardDefaultView);
  const [hasAppliedDashboardDefault, setHasAppliedDashboardDefault] = useState(false);
  const [loadedVipDetailIds, setLoadedVipDetailIds] = useState<string[]>([]);
  const [dashboardNow, setDashboardNow] = useState(() => Date.now());
  const { seasonId: seasonIdParam, competitionId, setSeasonId, buildHrefWithSeason } = useDashboardSeasonParam();

  useEffect(() => {
    const timer = window.setInterval(() => setDashboardNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const effectiveDashboardWidgets = useMemo(() => {
    const storedDashboardWidgets = state.me?.dashboard_widgets?.length
      ? state.me.dashboard_widgets
      : state.me?.dashboard_widget_ids?.length
        ? state.me.dashboard_widget_ids.map((widgetId) => createDashboardWidgetConfig(widgetId))
        : buildDefaultDashboardWidgets();
    if (!state.seasons.length) {
      return storedDashboardWidgets;
    }
    return storedDashboardWidgets.filter((widget) => {
      if (!widgetSupportsSeasonContext(widget.widget_id) || !widget.season_id) {
        return true;
      }
      return state.seasons.some(
        (season) => season.id === widget.season_id && season.visibility_status !== "archived",
      );
    });
  }, [state.me?.dashboard_widget_ids, state.me?.dashboard_widgets, state.seasons]);
  const effectiveDashboardWidgetIds = dedupeWidgetIds(effectiveDashboardWidgets);

  useEffect(() => {
    setDashboardWidgetDraft(effectiveDashboardWidgets);
  }, [effectiveDashboardWidgets]);

  async function loadSelectedMatchday(matchdayId: string, seasonsOverride?: Season[], matchdaysOverride?: Matchday[]) {
    const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
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
        resolveLiveSeason(seasons, seasonIdParam);
      const dashboardBundle = normalizeDashboardHomeBundle(await backendFetch<DashboardHomeBundle>(
        buildDashboardHomePath(selectedSeason?.id ?? selectedMatchday.season_id, selectedMatchday.id),
        accessToken,
        { cacheTtlMs: MATCHDAY_CACHE_TTL_MS },
      ));

      setState((current) => ({
        ...current,
        seasons,
        matchdays,
        selectedMatchday,
        selectedSeason,
        summary: dashboardBundle.summary,
        advancedStats: dashboardBundle.advanced_stats,
        performanceRace: dashboardBundle.performance_race,
        matches: dashboardBundle.matches,
        pickResults: dashboardBundle.pick_results,
        matchdayPoints: dashboardBundle.matchday_points,
        personalTrophies: dashboardBundle.personal_trophies,
        vipCompetitions: dashboardBundle.vip_competitions,
        leaderboard: dashboardBundle.leaderboard,
        dashboardBundlesBySeasonId: selectedSeason?.id
          ? {
              ...current.dashboardBundlesBySeasonId,
              [selectedSeason.id]: dashboardBundle,
            }
          : current.dashboardBundlesBySeasonId,
        error: null,
      }));
      void trackAnalyticsEvent({
        category: "screen",
        event_name: "screen_loaded",
        route_path: "/dashboard",
        screen_name: getDashboardScreenName("/dashboard"),
        season_id: selectedSeason?.id ?? selectedMatchday.season_id,
        matchday_id: selectedMatchday.id,
        competition_id: selectedSeason?.competition_id ?? null,
        success: true,
        duration_ms: Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt),
      });
    } catch (error) {
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
      void trackAnalyticsEvent({
        category: "screen",
        event_name: "screen_load_failed",
        route_path: "/dashboard",
        screen_name: getDashboardScreenName("/dashboard"),
        matchday_id: matchdayId,
        season_id: seasonIdParam,
        competition_id: competitionId || null,
        success: false,
        duration_ms: Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt),
        metadata: {
          message: error instanceof Error ? error.message : "dashboard_matchday_failed",
        },
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    async function load() {
      const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
      try {
        const accessToken = await getBrowserAccessToken().catch(() => undefined);

        const bootstrap = await backendFetch<AppBootstrap>("/bootstrap", accessToken, {
          cacheTtlMs: MATCHDAY_CACHE_TTL_MS,
        });
        const me = normalizeMe(bootstrap.me);
        const seasons = asArray(bootstrap.seasons);
        const matchdays = asArray(bootstrap.matchdays);
        const activeMatchdays = asArray(bootstrap.active_matchdays);
        const teams = asArray(bootstrap.teams);

        const memberSeasons = filterSeasonsForActiveMembership(seasons, me);
        const preferredSeason = resolveLiveSeason(memberSeasons, seasonIdParam);
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
          if (selectedSeason.id !== seasonIdParam || competitionId) {
            setSeasonId(selectedSeason.id, "");
          }
        }

        setState((current) => ({
          ...current,
          me,
          seasons: memberSeasons,
          enrollmentSeasons: seasons.filter((season) => season.visibility_status === "live" && (season.dashboard_enrollment_enabled || (season.survivor_enabled && season.survivor_dashboard_enrollment_enabled))),
          matchdays,
          selectedMatchday,
          selectedSeason,
          teams,
          error: null,
        }));

        const dashboardBundle = normalizeDashboardHomeBundle(await backendFetch<DashboardHomeBundle>(
          buildDashboardHomePath(selectedSeason?.id ?? null, selectedMatchday?.id ?? null),
          accessToken,
          { cacheTtlMs: MATCHDAY_CACHE_TTL_MS },
        ));
        const survivorSeason = resolveSurvivorSeason(memberSeasons, seasonIdParam, competitionId);
        let survivorBoard: SurvivorBoard | null = null;
        if (accessToken && survivorSeason && isSurvivorAvailableForSeason(survivorSeason)) {
          try {
            survivorBoard = await backendFetch<SurvivorBoard>(
              `/survivor/board?season_id=${survivorSeason.id}`,
              accessToken,
            );
          } catch {
            survivorBoard = null;
          }
        }

        setState((current) => ({
          ...current,
          summary: dashboardBundle.summary,
          advancedStats: dashboardBundle.advanced_stats,
          performanceRace: dashboardBundle.performance_race,
          matches: dashboardBundle.matches,
          pickResults: dashboardBundle.pick_results,
          matchdayPoints: dashboardBundle.matchday_points,
          personalTrophies: dashboardBundle.personal_trophies,
          vipCompetitions: dashboardBundle.vip_competitions,
          leaderboard: dashboardBundle.leaderboard,
          dashboardBundlesBySeasonId: selectedSeason?.id
            ? {
                ...current.dashboardBundlesBySeasonId,
                [selectedSeason.id]: dashboardBundle,
              }
            : current.dashboardBundlesBySeasonId,
          survivorBoard,
          survivorBoardsBySeasonId:
            survivorSeason?.id
              ? {
                  ...current.survivorBoardsBySeasonId,
                  [survivorSeason.id]: survivorBoard,
                }
              : current.survivorBoardsBySeasonId,
        }));
        void trackAnalyticsEvent({
          category: "screen",
          event_name: "screen_loaded",
          route_path: "/dashboard",
          screen_name: getDashboardScreenName("/dashboard"),
          season_id: selectedSeason?.id ?? null,
          matchday_id: selectedMatchday?.id ?? null,
          competition_id: selectedSeason?.competition_id ?? null,
          success: true,
          duration_ms: Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt),
        });
        setLoading(false);
      } catch (error) {
        setState((current) => ({
          ...current,
          error:
            error instanceof Error
              ? error.message
              : "No se pudo cargar el dashboard",
        }));
        void trackAnalyticsEvent({
          category: "screen",
          event_name: "screen_load_failed",
          route_path: "/dashboard",
          screen_name: getDashboardScreenName("/dashboard"),
          season_id: seasonIdParam,
          competition_id: competitionId || null,
          success: false,
          duration_ms: Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt),
          metadata: {
            message: error instanceof Error ? error.message : "dashboard_failed",
          },
        });
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
        const detailRow = asArray(rows)[0];
        const detail = detailRow ? normalizeVipCompetition(detailRow) : null;
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
    if (loading || !state.me || dashboardDefaultView.startsWith("vip:")) {
      return;
    }

    const targetSeasonIds = Array.from(
      new Set(
        effectiveDashboardWidgets
          .filter((widget) => widgetSupportsSeasonContext(widget.widget_id))
          .map((widget) => widget.season_id ?? state.selectedSeason?.id ?? null)
          .filter((seasonId): seasonId is string => Boolean(seasonId))
          .filter((seasonId) => !state.dashboardBundlesBySeasonId[seasonId]),
      ),
    );

    if (targetSeasonIds.length === 0) {
      return;
    }

    let cancelled = false;
    async function loadDashboardBundles() {
      try {
        const accessToken = await getBrowserAccessToken().catch(() => undefined);
        const rows = await Promise.all(
          targetSeasonIds.map(async (seasonId) => ({
            seasonId,
            bundle: await backendFetch<DashboardHomeBundle>(buildDashboardHomePath(seasonId, null), accessToken, {
              cacheTtlMs: MATCHDAY_CACHE_TTL_MS,
            }),
          })),
        );
        if (cancelled) {
          return;
        }
        setState((current) => ({
          ...current,
          dashboardBundlesBySeasonId: rows.reduce<Record<string, DashboardHomeBundle>>(
            (accumulator, row) => {
              accumulator[row.seasonId] = row.bundle;
              return accumulator;
            },
            { ...current.dashboardBundlesBySeasonId },
          ),
        }));
      } catch {
        return;
      }
    }

    void loadDashboardBundles();
    return () => {
      cancelled = true;
    };
  }, [
    dashboardDefaultView,
    effectiveDashboardWidgets,
    loading,
    state.dashboardBundlesBySeasonId,
    state.me,
    state.selectedSeason?.id,
  ]);

  useEffect(() => {
    if (loading || !state.me || dashboardDefaultView.startsWith("vip:")) {
      return;
    }

    const targetSeasonIds = Array.from(
      new Set(
        effectiveDashboardWidgets
          .filter((widget) => widget.widget_id === "survivor_summary")
          .map((widget) => widget.season_id ?? state.selectedSeason?.id ?? null)
          .filter((seasonId): seasonId is string => Boolean(seasonId))
          .filter((seasonId) => state.survivorBoardsBySeasonId[seasonId] === undefined),
      ),
    );

    if (targetSeasonIds.length === 0) {
      return;
    }

    let cancelled = false;
    async function loadSurvivorBoards() {
      try {
        const accessToken = await getBrowserAccessToken().catch(() => undefined);
        const rows = await Promise.all(
          targetSeasonIds.map(async (seasonId) => {
            const season = state.seasons.find((row) => row.id === seasonId) ?? null;
            if (!accessToken || !season || !isSurvivorAvailableForSeason(season)) {
              return { seasonId, board: null as SurvivorBoard | null };
            }
            try {
              const board = await backendFetch<SurvivorBoard>(`/survivor/board?season_id=${seasonId}`, accessToken);
              return { seasonId, board };
            } catch {
              return { seasonId, board: null as SurvivorBoard | null };
            }
          }),
        );
        if (cancelled) {
          return;
        }
        setState((current) => ({
          ...current,
          survivorBoardsBySeasonId: rows.reduce<Record<string, SurvivorBoard | null>>((accumulator, row) => {
            accumulator[row.seasonId] = row.board;
            return accumulator;
          }, { ...current.survivorBoardsBySeasonId }),
        }));
      } catch {
        return;
      }
    }

    void loadSurvivorBoards();
    return () => {
      cancelled = true;
    };
  }, [
    dashboardDefaultView,
    effectiveDashboardWidgets,
    loading,
    state.me,
    state.seasons,
    state.selectedSeason?.id,
    state.survivorBoardsBySeasonId,
  ]);

  useEffect(() => {
    async function loadUpcomingMatchdays() {
      const generalSeasonIds =
        activeTab === "general" && !dashboardDefaultView.startsWith("vip:")
          ? Array.from(
              new Set(
                effectiveDashboardWidgets
                  .filter((widget) => widget.widget_id === "upcoming")
                  .map((widget) => widget.season_id ?? state.selectedSeason?.id ?? null)
                  .filter((seasonId): seasonId is string => Boolean(seasonId)),
              ),
            )
          : [];
      const targetSeasonIds =
        activeTab === "proximos"
          ? state.selectedSeason?.id
            ? [state.selectedSeason.id]
            : []
          : generalSeasonIds;

      if (targetSeasonIds.length === 0) {
        return;
      }

      try {
        const accessToken = await getBrowserAccessToken();
        const now = Date.now();
        const seasonGroups = await Promise.all(
          targetSeasonIds.map(async (seasonId) => {
            const seasonRows = state.matchdays
              .filter((matchday) => matchday.season_id === seasonId)
              .sort((left, right) => left.number - right.number);
            const upcomingByStatus = seasonRows.filter(
              (matchday) => matchday.status === "draft" || matchday.status === "active",
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
                      .filter((matchday) => matchday.status === "draft" || matchday.status === "active")
                      .sort((left, right) => left.number - right.number);
            const groups = await Promise.all(
              targetMatchdays.map(async (matchday) => ({
                matchday,
                matches: asArray(await backendFetch<Match[]>(`/matches?matchday_id=${matchday.id}`, accessToken)),
              })),
            );
            return { seasonId, groups };
          }),
        );

        setState((current) => ({
          ...current,
          upcomingMatchdayGroupsBySeasonId: seasonGroups.reduce<Record<string, { matchday: Matchday; matches: Match[] }[]>>(
            (accumulator, row) => {
              accumulator[row.seasonId] = row.groups;
              return accumulator;
            },
            { ...current.upcomingMatchdayGroupsBySeasonId },
          ),
        }));
      } catch {
        setState((current) => ({
          ...current,
          upcomingMatchdayGroupsBySeasonId: targetSeasonIds.reduce<Record<string, { matchday: Matchday; matches: Match[] }[]>>(
            (accumulator, seasonId) => {
              accumulator[seasonId] = [];
              return accumulator;
            },
            { ...current.upcomingMatchdayGroupsBySeasonId },
          ),
        }));
      }
    }

    void loadUpcomingMatchdays();
  }, [activeTab, dashboardDefaultView, effectiveDashboardWidgets, state.matchdays, state.selectedSeason]);

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

  function handleAddDashboardWidget(widgetId: DashboardWidgetId = "summary") {
    setDashboardWidgetDraft((current) => [
      ...current,
      createDashboardWidgetConfig(widgetId, state.selectedSeason?.id ?? null),
    ]);
  }

  function handleRemoveDashboardWidget(widgetKey: string) {
    setDashboardWidgetDraft((current) => {
      if (current.length <= 1) {
        return current;
      }
      return current.filter((widget) => widget.id !== widgetKey);
    });
  }

  function handleUpdateDashboardWidget(
    widgetKey: string,
    updates: Partial<Pick<DashboardWidgetConfig, "widget_id" | "season_id">>,
  ) {
    setDashboardWidgetDraft((current) =>
      current.map((widget) => {
        if (widget.id !== widgetKey) {
          return widget;
        }
        const nextWidgetId = updates.widget_id ?? widget.widget_id;
        return {
          ...widget,
          widget_id: nextWidgetId,
          season_id: widgetSupportsSeasonContext(nextWidgetId) ? updates.season_id ?? widget.season_id : null,
        };
      }),
    );
  }

  function handleMoveDashboardWidget(widgetKey: string, direction: -1 | 1) {
    setDashboardWidgetDraft((current) => {
      const currentIndex = current.findIndex((widget) => widget.id === widgetKey);
      if (currentIndex < 0) {
        return current;
      }
      const nextIndex = currentIndex + direction;
      if (nextIndex < 0 || nextIndex >= current.length) {
        return current;
      }
      const next = current.slice();
      const [moved] = next.splice(currentIndex, 1);
      next.splice(nextIndex, 0, moved);
      return next;
    });
  }

  function handleApplyDashboardPreset(widgetIds: DashboardWidgetId[]) {
    setDashboardWidgetDraft(widgetIds.map((widgetId) => createDashboardWidgetConfig(widgetId, state.selectedSeason?.id ?? null)));
  }

  async function handleSaveDashboardWidgets() {
    if (!state.me) {
      return;
    }
    setDashboardConfigSaving(true);
    try {
      const accessToken = await getBrowserAccessToken();
      const saved = await backendFetch<Me>("/me", accessToken, {
        method: "PUT",
        body: JSON.stringify({
          display_name: state.me.display_name,
          email: state.me.email,
          favorite_team_id: state.me.favorite_team_id,
          contact_phone: state.me.contact_phone,
          bank_name: state.me.bank_name,
          deposit_account: state.me.deposit_account,
          modality: state.me.modality,
          aval_profile_id: state.me.aval_profile_id,
          theme_preference: state.me.theme_preference,
          dashboard_widgets: dashboardWidgetDraft,
          dashboard_widget_ids: dashboardWidgetDraft.map((widget) => widget.widget_id),
          pick_reminder_email_enabled: state.me.pick_reminder_email_enabled,
          pick_reminder_opening_enabled: state.me.pick_reminder_opening_enabled,
          pick_reminder_hours_before: state.me.pick_reminder_hours_before,
          matchday_start_notification_enabled: state.me.matchday_start_notification_enabled,
          match_result_notification_enabled: state.me.match_result_notification_enabled,
          matchday_summary_notification_enabled: state.me.matchday_summary_notification_enabled,
        }),
      });
      setState((current) => ({
        ...current,
        me: saved,
        error: null,
      }));
      setIsWidgetEditorOpen(false);
    } catch (error) {
      setState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : "No se pudo guardar la configuracion del dashboard",
      }));
    } finally {
      setDashboardConfigSaving(false);
    }
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
  const trophyRecords = state.personalTrophies.filter((row) => row.recognition_type === "trophy");
  const awardRecords = state.personalTrophies.filter((row) => row.recognition_type === "award");
  const teamCrestById = new Map(state.teams.map((team) => [team.id, team.crest_url]));
  const teamShortNameById = new Map(state.teams.map((team) => [team.id, team.short_name]));
  const selectedSeasonMembership =
    state.selectedSeason && state.me
      ? state.me.season_memberships.find((membership) => membership.season_id === state.selectedSeason?.id) ?? null
      : null;
  const dashboardEnrollmentProducts = state.enrollmentSeasons.flatMap((season) => {
    const membership = state.me?.season_memberships.find((row) => row.season_id === season.id) ?? null;
    const products: Array<{ id: string; name: string; description: string; season: Season; status: string; lockAt: string | null; closed: boolean }> = [];
    if (season.dashboard_enrollment_enabled && !membership?.is_active) {
      products.push({
        id: `season-${season.id}`,
        name: season.name,
        description: season.description || "Inscripción a Liga/Quiniela.",
        season,
        status: membership ? (membership.is_rejected ? "Solicitar nuevamente" : "En revisión") : "Inscribirme",
        lockAt: season.participants_lock_at,
        closed: season.registration_closed,
      });
    }
    if (season.survivor_enabled && season.survivor_dashboard_enrollment_enabled) {
      products.push({
        id: `survivor-${season.id}`,
        name: season.survivor_name || `Survivor ${season.name}`,
        description: season.survivor_description || "Inscripción independiente a Survivor.",
        season,
        status: "Ver inscripción",
        lockAt: season.survivor_registration_lock_at ?? season.participants_lock_at,
        closed: season.survivor_registration_closed || season.registration_closed,
      });
    }
    return products;
  });
  const isLigaMxSeason = state.selectedSeason?.tournament_format === "standard";
  const hasActiveLigaMxMembership = Boolean(selectedSeasonMembership?.is_active);
  const isPrePagoPendingApproval = Boolean(
    selectedSeasonMembership && !selectedSeasonMembership.is_active && state.me?.modality === "pre_pago",
  );
  const survivorSeason = resolveSurvivorSeason(state.seasons, seasonIdParam, competitionId);
  const canJoinSurvivor = Boolean(survivorSeason && isSurvivorAvailableForSeason(survivorSeason));
  const hasSurvivorMembership = Boolean(state.survivorBoard?.my_membership);
  const shouldShowLigaMxActionPanel = Boolean(
    state.me &&
      isLigaMxSeason &&
      (!hasActiveLigaMxMembership || (canJoinSurvivor && !hasSurvivorMembership)),
  );
  const approvedVipCompetitions = state.vipCompetitions.filter((vip) => vip.my_membership?.status === "approved");
  const hasApprovedVipCompetition = approvedVipCompetitions.length > 0;
  const canViewRegularDashboard = Boolean(selectedSeasonMembership?.can_participate);
  const selectableSeasons = getLiveSeasons(state.seasons)
    .filter((season) => !isSeasonArchived(season))
    .slice()
    .sort((left, right) => {
      if (left.is_active !== right.is_active) {
        return left.is_active ? -1 : 1;
      }
      if (left.tournament_format !== right.tournament_format) {
        return left.tournament_format === "standard" ? -1 : 1;
      }
      return String(left.name ?? "").localeCompare(String(right.name ?? ""), "es-MX");
    });
  const computedLeagueOptions: DashboardLeagueOption[] = (() => {
    const grouped = new Map<string, DashboardLeagueOption>();
    selectableSeasons.forEach((season) => {
      const key = getDashboardLeagueKey(season);
      const existing = grouped.get(key);
      if (existing) {
        existing.seasons.push(season);
        return;
      }
      grouped.set(key, {
        value: key,
        label: getDashboardLeagueLabel(season),
        seasons: [season],
      });
    });
    return Array.from(grouped.values());
  })();
  const selectedLeagueValue =
    computedLeagueOptions.find((option) => option.seasons.some((season) => season.id === state.selectedSeason?.id))?.value ??
    computedLeagueOptions[0]?.value ??
    "";
  const selectableLeagueSeasons =
    computedLeagueOptions.find((option) => option.value === selectedLeagueValue)?.seasons ?? selectableSeasons;
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
  const selectedVipLeaderboard = selectedVipCompetition?.leaderboard ?? [];
  const myVipEntry =
    selectedVipLeaderboard.find((entry) => entry.profile_id === state.me?.id) ?? null;
  const vipMatchdayPoints = selectedVipCompetition?.matchday_points ?? [];
  const vipPerformanceRace = selectedVipCompetition?.performance_race ?? null;
  const vipMatchdaysCount = selectedVipCompetition?.matchdays?.length ?? 0;
  const vipCompletedMatchdays = vipPerformanceRace?.completed_matchdays ?? vipMatchdayPoints.length;
  const vipAverage =
    vipCompletedMatchdays > 0 ? ((myVipEntry?.total_points ?? 0) / vipCompletedMatchdays).toFixed(1) : "0.0";
  const vipProjectedTotal = (vipPerformanceRace?.projected_user_total ?? myVipEntry?.total_points ?? 0).toFixed(1);
  const isVipDashboardContext = dashboardDefaultValue.startsWith("vip:") && selectedVipCompetition !== null;
  const visibleDashboardWidgetConfigs = effectiveDashboardWidgets.filter((widget) =>
    DASHBOARD_WIDGET_OPTIONS.some((option) => option.id === widget.widget_id),
  );
  const visibleDashboardWidgetIds = dedupeWidgetIds(visibleDashboardWidgetConfigs);
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
  const bestPrizeRank = prizeRows.length > 0 ? Math.min(...prizeRows.map((row) => row.rank_position ?? 99)) : null;
  const nextUpcomingGroup =
    (state.selectedSeason?.id ? state.upcomingMatchdayGroupsBySeasonId[state.selectedSeason.id]?.[0] : null) ?? null;
  const approvedVipCount = approvedVipCompetitions.length;
  const survivorMembershipSummary = state.survivorBoard?.my_membership ?? null;
  const activePresetId =
    DASHBOARD_WIDGET_PRESETS.find(
      (preset) =>
        preset.widgetIds.length === dashboardWidgetDraft.length &&
        preset.widgetIds.every(
          (widgetId, index) =>
            dashboardWidgetDraft[index]?.widget_id === widgetId && dashboardWidgetDraft[index]?.season_id === null,
        ),
    )?.id ?? null;
  const hasDashboardWidgetChanges = !areWidgetConfigsEqual(dashboardWidgetDraft, effectiveDashboardWidgets);
  const canShowSurvivorDashboardTab = Boolean(
    survivorSeason && isSurvivorAvailableForSeason(survivorSeason),
  );
  const resolvedActiveTab: DashboardTab =
    activeTab === "survivor" && !canShowSurvivorDashboardTab
      ? "general"
      : activeTab;

  function handleLeagueChange(nextLeagueValue: string) {
    const nextLeague = computedLeagueOptions.find((option) => option.value === nextLeagueValue) ?? null;
    const nextSeason =
      nextLeague?.seasons.find((season) => season.is_active) ??
      nextLeague?.seasons[0] ??
      null;
    if (!nextSeason) {
      return;
    }
    setSeasonId(nextSeason.id, "");
  }
  const computedDashboardTabs: Array<{ id: DashboardTab; label: string }> = [
    { id: "general", label: "General" },
    { id: "jornada", label: "Jornada" },
    { id: "proximos", label: "Proximos juegos" },
    ...(canShowSurvivorDashboardTab ? [{ id: "survivor" as DashboardTab, label: "Survivor" }] : []),
    { id: "advanced", label: "E. Avanzadas" },
    { id: "premios", label: "Premios" },
  ];
  const computedActiveTabLabel = computedDashboardTabs.find((tab) => tab.id === resolvedActiveTab)?.label ?? "General";
  const showsMatchdayControls = resolvedActiveTab === "jornada" || resolvedActiveTab === "probabilidades";
  const summaryTileClass =
    "flex min-w-0 h-[78px] flex-col justify-between rounded-[16px] bg-transparent p-1.5 sm:h-auto sm:rounded-[30px] sm:p-5";
  const useWorldCupAbbreviation = isWorldCupSeason(state.selectedSeason);
  const selectedSeasonDashboardBundle: DashboardHomeBundle = {
    summary: state.summary ?? {
      season_id: state.selectedSeason?.id ?? null,
      season_name: state.selectedSeason?.name ?? null,
      total_points: 0,
      overall_rank: null,
      weekly_prizes_count: 0,
      average_points_per_matchday: 0,
      projected_total_points: 0,
      projected_rank: null,
      tournament_matchdays: 0,
      completed_matchdays: 0,
      remaining_matchdays: 0,
    },
    advanced_stats: state.advancedStats ?? {
      season_id: state.selectedSeason?.id ?? null,
      season_name: state.selectedSeason?.name ?? null,
      graded_picks: 0,
      best_matchday_name: null,
      best_matchday_points: 0,
      home_bets: 0,
      draw_bets: 0,
      away_bets: 0,
      max_hit_points: 0,
      result_hit_points: 0,
      exact_hits: 0,
      result_hits: 0,
      overall_effectiveness_pct: 0,
      home_effectiveness_pct: 0,
      draw_effectiveness_pct: 0,
      away_effectiveness_pct: 0,
      home_points: 0,
      draw_points: 0,
      away_points: 0,
    },
    performance_race: state.performanceRace ?? {
      season_id: state.selectedSeason?.id ?? null,
      season_name: state.selectedSeason?.name ?? null,
      leader_profile_id: null,
      leader_name: null,
      tournament_matchdays: 0,
      completed_matchdays: 0,
      projected_user_total: 0,
      projected_leader_total: 0,
      projected_first_place_total: 0,
      projected_third_place_total: 0,
      points: [],
    },
    matchday_points: state.matchdayPoints,
    personal_trophies: state.personalTrophies,
    vip_competitions: state.vipCompetitions,
    leaderboard: state.leaderboard,
    matches: state.matches,
    pick_results: state.pickResults,
  };

  function getMatchTeamLabel(teamId: string | null, fallbackName: string) {
    if (!useWorldCupAbbreviation || !teamId) {
      return fallbackName;
    }
    return teamShortNameById.get(teamId) ?? fallbackName;
  }

  function resolveDashboardWidgetSeason(widget: DashboardWidgetConfig) {
    const seasonId = widgetSupportsSeasonContext(widget.widget_id) ? widget.season_id ?? state.selectedSeason?.id ?? null : null;
    const season = seasonId ? state.seasons.find((row) => row.id === seasonId) ?? null : null;
    const bundle = seasonId
      ? seasonId === state.selectedSeason?.id
        ? selectedSeasonDashboardBundle
        : state.dashboardBundlesBySeasonId[seasonId] ?? null
      : null;
    const upcomingGroups = seasonId ? state.upcomingMatchdayGroupsBySeasonId[seasonId] ?? [] : [];
    return { seasonId, season, bundle, upcomingGroups };
  }

  function renderWidgetSeasonBadge(widget: DashboardWidgetConfig, season: Season | null) {
    if (!widgetSupportsSeasonContext(widget.widget_id) || !season) {
      return null;
    }
    return (
      <div className="mb-3 flex items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink">
          {season.competition_name ?? "Torneo"}
        </span>
        <span className="text-xs text-steel">{season.name}</span>
      </div>
    );
  }

  function renderSurvivorSummarySection({
    sectionKey,
    season,
    board,
    seasonBadge,
  }: {
    sectionKey: string;
    season: Season | null;
    board: SurvivorBoard | null;
    seasonBadge?: ReactNode;
  }) {
    const survivorName = season?.survivor_name ?? board?.season.survivor_name ?? "Survivor";
    const currentPick = board?.my_membership?.current_pick ?? board?.my_picks?.[0] ?? null;
    const recentPicks = (board?.my_picks ?? []).slice().sort((left, right) => right.matchday_number - left.matchday_number).slice(0, 3);
    const aliveEntries = (board?.leaderboard ?? []).filter((entry) => entry.alive && entry.remaining_lives > 0).length;

    if (!season || !isSurvivorAvailableForSeason(season)) {
      return (
        <section key={sectionKey} className="border-y border-white/[0.08] py-5">
          {seasonBadge}
          <p className="text-sm text-steel">Esta temporada no tiene survivor disponible.</p>
        </section>
      );
    }

    return (
      <section key={sectionKey} className="border-y border-white/[0.08] py-5">
        {seasonBadge}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-ink">{survivorName}</h2>
          </div>
          <Link href={buildHrefWithSeason("/dashboard/survivor", season.id)} className="text-xs font-semibold text-ink transition hover:text-[#4f7df3] active:text-[#4f7df3]">
            Ver tablero
          </Link>
        </div>

        {!board?.my_membership ? (
          <p className="mt-4 text-sm text-steel">Todavia no estas inscrito en este survivor.</p>
        ) : (
          <>
            <div className="mt-4 grid border-y border-white/[0.08] md:grid-cols-3">
              <div className="px-4 py-4">
                <p className="text-[10px] uppercase tracking-[0.14em] text-steel">Estado</p>
                <p className="mt-2 text-lg font-semibold text-ink">
                  {getSurvivorLifeStateLabel(board.my_membership.alive, board.my_membership.remaining_lives)}
                </p>
              </div>
              <div className="border-white/[0.08] px-4 py-4 md:border-l">
                <p className="text-[10px] uppercase tracking-[0.14em] text-steel">Vidas</p>
                <div className="mt-2">{renderDashboardLives(board.my_membership.remaining_lives, board.my_membership.max_lives)}</div>
              </div>
              <div className="border-white/[0.08] px-4 py-4 md:border-l">
                <p className="text-[10px] uppercase tracking-[0.14em] text-steel">Siguen vivos</p>
                <p className="mt-2 text-lg font-semibold text-ink">{aliveEntries} <span className="text-sm font-normal text-steel">de {board.season.total_entries}</span></p>
              </div>
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
              <div className="border-b border-white/[0.08] py-4 lg:border-b-0 lg:border-r lg:pr-6">
                <p className="text-[10px] uppercase tracking-[0.14em] text-steel">Pick actual</p>
                {currentPick ? (
                  <>
                    <div className="mt-4 flex items-center gap-5">
                      <div className="flex flex-col items-center gap-1">
                        {renderDashboardTeamCrest(currentPick.team_name, currentPick.team_short_name, currentPick.team_crest_url, "h-16 w-16 drop-shadow-[0_0_8px_rgba(74,222,128,0.35)]")}
                        <span className="text-xs font-semibold text-ink">{currentPick.team_short_name}</span>
                      </div>
                      <span className="text-xs text-steel">vs</span>
                      <div className="flex flex-col items-center gap-1 opacity-70">
                        {renderDashboardTeamCrest(currentPick.opponent_team_name, currentPick.opponent_team_short_name, currentPick.opponent_team_crest_url, "h-11 w-11")}
                        <span className="text-[10px] text-steel">{currentPick.opponent_team_short_name}</span>
                      </div>
                    </div>
                    <p className="mt-1 text-xs text-steel">{currentPick.matchday_name}</p>
                    <p className="mt-1 text-xs text-steel">{formatMexicoCityDateTime(currentPick.kickoff_at)}</p>
                    <p className={`mt-2 text-sm font-semibold ${getSurvivorResultTone(currentPick.result_status)}`}>
                      {getSurvivorResultLabel(currentPick.result_status)}
                    </p>
                  </>
                ) : (
                  <p className="mt-2 text-sm text-steel">Todavia no tienes pick capturado.</p>
                )}
              </div>

              <div className="py-4 lg:pl-6">
                <p className="text-[10px] uppercase tracking-[0.14em] text-steel">Historial reciente</p>
                {recentPicks.length > 0 ? (
                  <div className="mt-3 space-y-2">
                    {recentPicks.map((pick) => (
                      <div key={pick.id} className="flex items-center justify-between gap-3 border-b border-white/[0.06] py-2 last:border-b-0">
                        <div className="flex min-w-0 items-center gap-3">
                          {renderDashboardTeamCrest(pick.team_name, pick.team_short_name, pick.team_crest_url, "h-9 w-9")}
                          <div className="min-w-0">
                          <p className="text-sm font-semibold text-ink">
                            J{pick.matchday_number} · {pick.team_short_name}
                          </p>
                          <p className="mt-1 truncate text-[11px] text-steel">
                            vs {pick.opponent_team_short_name}
                          </p>
                          </div>
                        </div>
                        <p className={`text-xs font-semibold ${getSurvivorResultTone(pick.result_status)}`}>
                          {getSurvivorResultLabel(pick.result_status)}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-steel">Aun no hay historial para mostrar.</p>
                )}
              </div>
            </div>
          </>
        )}
      </section>
    );
  }

  function renderRankingSection({
    sectionKey,
    rows,
    seasonBadge,
  }: {
    sectionKey: string;
    rows: Array<{ profile_id: string; display_name: string; total_points: number; exact_scores: number; rank_position: number }>;
    seasonBadge?: ReactNode;
  }) {
    const topRows = rows.slice(0, 5);
    const myRow = rows.find((row) => row.profile_id === state.me?.id) ?? null;
    const visibleRows = myRow && !topRows.some((row) => row.profile_id === myRow.profile_id) ? [...topRows, myRow] : topRows;
    return (
      <section key={sectionKey} className="border-y border-white/[0.08] py-5">
        {seasonBadge}
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold text-ink">Ranking</h2>
          <Link href={buildHrefWithSeason("/dashboard/leaderboard")} className="text-xs font-semibold text-ink transition hover:text-[#4f7df3] active:text-[#4f7df3]">Ver completo</Link>
        </div>
        {visibleRows.length > 0 ? (
          <div className="mt-4">
            {visibleRows.map((row, index) => {
              const isMe = row.profile_id === state.me?.id;
              const separated = index >= 5;
              return (
                <div key={row.profile_id} className={`grid grid-cols-[42px_minmax(0,1fr)_70px_54px] items-center gap-3 border-b border-white/[0.07] py-3 text-sm ${separated ? "mt-3 border-t" : ""}`}>
                  <span className={isMe ? "font-bold text-[#4f7df3]" : "text-steel"}>#{row.rank_position}</span>
                  <span className={`truncate font-semibold ${isMe ? "text-[#4f7df3]" : "text-ink"}`}>{row.display_name}</span>
                  <span className="text-right font-semibold text-ink">{row.total_points} pts</span>
                  <span className="text-right text-xs text-steel">{row.exact_scores} E</span>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="mt-4 text-sm text-steel">El ranking aparecerá cuando existan puntos publicados.</p>
        )}
      </section>
    );
  }

  function renderRegularDashboardWidget(widget: DashboardWidgetConfig) {
    if (widget.widget_id === "memberships") {
      return renderGeneralWidget("memberships");
    }

    const { season, bundle, upcomingGroups } = resolveDashboardWidgetSeason(widget);
    if (!bundle && widget.widget_id !== "upcoming" && widget.widget_id !== "survivor_summary") {
      return (
        <section key={widget.id} className="rounded-[24px] border border-white/[0.06] bg-white/[0.03] px-4 py-5">
          {renderWidgetSeasonBadge(widget, season)}
          <p className="text-sm text-steel">Cargando widget para esta temporada...</p>
        </section>
      );
    }

    const widgetSummary = bundle?.summary;
    const widgetMatchdayPoints = bundle?.matchday_points ?? [];
    const widgetPerformanceRace = bundle?.performance_race ?? null;
    const widgetPickResults = bundle?.pick_results ?? [];
    const widgetPrizeRows = widgetMatchdayPoints.filter((row) => row.rank_position !== null && row.rank_position <= 3);
    const widgetWeeklyPrizeTotal = widgetPrizeRows.reduce((sum, row) => sum + row.weekly_prize_amount, 0);
    const widgetBestPrizeRank =
      widgetPrizeRows.length > 0 ? Math.min(...widgetPrizeRows.map((row) => row.rank_position ?? 99)) : null;
    const widgetUpcomingGroup = upcomingGroups[0] ?? null;
    const widgetSeasonMatchdays = season ? filterMatchdaysBySeason(state.matchdays, season.id) : [];
    const widgetMatchday =
      (widgetPickResults[0]?.matchday_id
        ? widgetSeasonMatchdays.find((row) => row.id === widgetPickResults[0]?.matchday_id) ?? null
        : null) ?? pickPreferredMatchday(widgetSeasonMatchdays);
    const widgetSurvivorBoard = season ? state.survivorBoardsBySeasonId[season.id] ?? null : null;
    const useWidgetWorldCupAbbreviation = isWorldCupSeason(season);
    const getWidgetMatchTeamLabel = (teamId: string | null, fallbackName: string) => {
      if (!useWidgetWorldCupAbbreviation || !teamId) {
        return fallbackName;
      }
      return teamShortNameById.get(teamId) ?? fallbackName;
    };

    if (widget.widget_id === "summary") {
      return (
        <section key={widget.id}>
          {renderWidgetSeasonBadge(widget, season)}
          <div className="grid grid-cols-5 gap-1 md:grid-cols-2 md:gap-3 xl:grid-cols-5">
            <div className={summaryTileClass}>
              <p className="text-[6px] uppercase tracking-[0.06em] text-steel sm:text-xs sm:tracking-[0.3em]">
                <span className="sm:hidden">Pts</span>
                <span className="hidden sm:inline">Puntos acumulados</span>
              </p>
              <p className="mt-1 text-[12px] font-semibold leading-none text-ink sm:mt-2 sm:text-xl">
                {widgetSummary?.total_points ?? 0}
              </p>
              <p className="mt-1 text-[8px] leading-tight text-steel sm:mt-1.5 sm:text-sm">
                <span className="sm:hidden">{formatCompactSeasonName(widgetSummary?.season_name ?? season?.name)}</span>
                <span className="hidden sm:inline">{widgetSummary?.season_name ?? season?.name ?? "Torneo"}</span>
              </p>
            </div>
            <div className={summaryTileClass}>
              <p className="text-[6px] uppercase tracking-[0.06em] text-steel sm:text-xs sm:tracking-[0.3em]">
                <span className="sm:hidden">Lugar</span>
                <span className="hidden sm:inline">Lugar general</span>
              </p>
              <p className="mt-1 text-[12px] font-semibold leading-none text-coral sm:mt-2 sm:text-xl">
                {widgetSummary?.overall_rank ? `#${widgetSummary.overall_rank}` : "-"}
              </p>
              <p className="mt-1 text-[8px] leading-tight text-steel sm:mt-1.5 sm:text-sm">
                <span className="sm:hidden">{widgetSummary?.completed_matchdays ?? 0} jds</span>
                <span className="hidden sm:inline">{widgetSummary?.completed_matchdays ?? 0} jornadas calificadas</span>
              </p>
            </div>
            <div className={summaryTileClass}>
              <p className="text-[6px] uppercase tracking-[0.06em] text-steel sm:text-xs sm:tracking-[0.3em]">
                <span className="sm:hidden">Podios</span>
                <span className="hidden sm:inline">Premios por jornada</span>
              </p>
              <p className="mt-1 text-[12px] font-semibold leading-none text-ink sm:mt-2 sm:text-xl">
                {widgetSummary?.weekly_prizes_count ?? 0}
              </p>
              <p className="mt-1 text-[8px] leading-tight text-steel sm:mt-1.5 sm:text-sm">
                <span className="sm:hidden">Top 3</span>
                <span className="hidden sm:inline">Top 3 por jornada</span>
              </p>
            </div>
            <div className={summaryTileClass}>
              <p className="text-[6px] uppercase tracking-[0.06em] text-steel sm:text-xs sm:tracking-[0.3em]">
                <span className="sm:hidden">Prom</span>
                <span className="hidden sm:inline">Puntos promedio</span>
              </p>
              <p className="mt-1 text-[12px] font-semibold leading-none text-ink sm:mt-2 sm:text-xl">
                {(widgetSummary?.average_points_per_matchday ?? 0).toFixed(1)}
              </p>
              <p className="mt-1 text-[8px] leading-tight text-steel sm:mt-1.5 sm:text-sm">
                <span className="sm:hidden">por jd</span>
                <span className="hidden sm:inline">Por jornada publicada</span>
              </p>
            </div>
            <div className={summaryTileClass}>
              <p className="text-[6px] uppercase tracking-[0.06em] text-steel sm:text-xs sm:tracking-[0.3em]">
                <span className="sm:hidden">Proy</span>
                <span className="hidden sm:inline">Cierre proyectado</span>
              </p>
              <p className="mt-1 text-[12px] font-semibold leading-none text-emerald-300 sm:mt-2 sm:text-xl">
                {(widgetSummary?.projected_total_points ?? 0).toFixed(1)}
              </p>
              <p className="mt-1 text-[8px] leading-tight text-steel sm:mt-1.5 sm:text-sm">
                <span className="sm:hidden">pts</span>
                <span className="hidden sm:inline">Puntos proyectados al cierre</span>
              </p>
            </div>
          </div>
        </section>
      );
    }

    if (widget.widget_id === "performance") {
      return (
        <section key={widget.id}>
          {renderWidgetSeasonBadge(widget, season)}
          <PerformanceRaceChart race={widgetPerformanceRace} userLabel={state.me?.display_name ?? "Tu desempeno"} />
        </section>
      );
    }

    if (widget.widget_id === "matchday_points") {
      return (
        <section key={widget.id}>
          {renderWidgetSeasonBadge(widget, season)}
          <MatchdayPointsTable rows={widgetMatchdayPoints} />
        </section>
      );
    }

    if (widget.widget_id === "matchday_results") {
      return (
        <section key={widget.id}>
          {renderWidgetSeasonBadge(widget, season)}
          <PickResultsTable
            rows={widgetPickResults}
            title={widgetMatchday?.name ?? "Resultados por jornada"}
            emptyMessage="No hay resultados de jornada disponibles para esta temporada."
            useWorldCupBubbles={useWidgetWorldCupAbbreviation}
          />
        </section>
      );
    }

    if (widget.widget_id === "prize_summary") {
      return (
        <section key={widget.id} className="rounded-[24px] border border-white/[0.06] bg-white/[0.03] px-4 py-5">
          {renderWidgetSeasonBadge(widget, season)}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-steel">Premios</p>
              <h2 className="mt-2 text-lg font-semibold text-ink">Resumen de premios</h2>
            </div>
            <Link href={buildHrefWithSeason("/dashboard/prizes")} className="app-pill px-4 text-xs">
              Ver detalle
            </Link>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <div className="rounded-[18px] border border-white/[0.06] bg-night/20 px-4 py-4">
              <p className="text-[10px] uppercase tracking-[0.14em] text-steel">Cobrado</p>
              <p className="mt-2 text-xl font-semibold text-ink">{formatCurrency(widgetWeeklyPrizeTotal)}</p>
            </div>
            <div className="rounded-[18px] border border-white/[0.06] bg-night/20 px-4 py-4">
              <p className="text-[10px] uppercase tracking-[0.14em] text-steel">Mejor lugar</p>
              <p className="mt-2 text-xl font-semibold text-emerald-300">{widgetBestPrizeRank ? `#${widgetBestPrizeRank}` : "-"}</p>
            </div>
            <div className="rounded-[18px] border border-white/[0.06] bg-night/20 px-4 py-4">
              <p className="text-[10px] uppercase tracking-[0.14em] text-steel">Podios</p>
              <p className="mt-2 text-xl font-semibold text-ink">{widgetPrizeRows.length}</p>
            </div>
          </div>
        </section>
      );
    }

    if (widget.widget_id === "upcoming") {
      return (
        <section key={widget.id} className="rounded-[24px] border border-white/[0.06] bg-white/[0.03] px-4 py-5">
          {renderWidgetSeasonBadge(widget, season)}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-steel">Agenda</p>
              <h2 className="mt-2 text-lg font-semibold text-ink">Proximos juegos</h2>
            </div>
            <button type="button" onClick={() => setActiveTab("proximos")} className="app-pill px-4 text-xs">
              Ver completos
            </button>
          </div>
          {widgetUpcomingGroup ? (
            <div className="mt-4 space-y-3">
              <div className="rounded-[18px] border border-white/[0.06] bg-night/20 px-4 py-4">
                <p className="text-sm font-semibold text-ink">{widgetUpcomingGroup.matchday.name}</p>
                <p className="mt-1 text-xs text-steel">
                  {formatMexicoCityDateTime(widgetUpcomingGroup.matchday.starts_at)} a {formatMexicoCityDateTime(widgetUpcomingGroup.matchday.ends_at)}
                </p>
              </div>
              <div className="space-y-2">
                {widgetUpcomingGroup.matches.slice(0, 3).map((match) => (
                  <div key={match.id} className="rounded-[18px] border border-white/[0.06] bg-night/20 px-4 py-3">
                    <MatchTeamsInline
                      homeName={getWidgetMatchTeamLabel(match.home_team_id, match.home_team_name)}
                      homeCrestUrl={match.home_team_id ? (teamCrestById.get(match.home_team_id) ?? null) : null}
                      awayName={getWidgetMatchTeamLabel(match.away_team_id, match.away_team_name)}
                      awayCrestUrl={match.away_team_id ? (teamCrestById.get(match.away_team_id) ?? null) : null}
                      useWorldCupBubbles={useWidgetWorldCupAbbreviation}
                    />
                    <p className="mt-2 text-[11px] text-steel">{formatMexicoCityDateTime(match.kickoff_at)}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="mt-4 text-sm text-steel">No encontramos una siguiente jornada lista para mostrar aqui.</p>
          )}
        </section>
      );
    }

    if (widget.widget_id === "survivor_summary") {
      return renderSurvivorSummarySection({
        sectionKey: widget.id,
        season,
        board: widgetSurvivorBoard,
        seasonBadge: renderWidgetSeasonBadge(widget, season),
      });
    }

    if (widget.widget_id === "ranking") {
      return renderRankingSection({
        sectionKey: widget.id,
        rows: bundle?.leaderboard ?? [],
        seasonBadge: renderWidgetSeasonBadge(widget, season),
      });
    }

    return renderGeneralWidget(widget.widget_id);
  }

  function renderGeneralWidget(widgetId: DashboardWidgetId) {
    if (widgetId === "summary") {
      return (
        <DashboardRuntimeBoundary key={widgetId} title="Resumen">
        <section>
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
                    ? `${vipMatchdaysCount} jornadas que cuentan`
                    : "Puntos proyectados al cierre"}
                </span>
              </p>
            </div>
          </div>
        </section>
        </DashboardRuntimeBoundary>
      );
    }

    if (widgetId === "performance") {
      return (
        <DashboardRuntimeBoundary key={widgetId} title="Performance">
        <section>
          <PerformanceRaceChart race={activePerformanceRace} userLabel={state.me?.display_name ?? "Tu desempeno"} />
        </section>
        </DashboardRuntimeBoundary>
      );
    }

    if (widgetId === "matchday_points") {
      return (
        <DashboardRuntimeBoundary key={widgetId} title="Puntos por jornada">
        <section>
          <MatchdayPointsTable rows={activeMatchdayPoints} />
        </section>
        </DashboardRuntimeBoundary>
      );
    }

    if (widgetId === "prize_summary") {
      return (
        <DashboardRuntimeBoundary key={widgetId} title="Premios">
        <section className="rounded-[24px] border border-white/[0.06] bg-white/[0.03] px-4 py-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-steel">Premios</p>
              <h2 className="mt-2 text-lg font-semibold text-ink">Resumen de premios</h2>
            </div>
            <Link href={buildHrefWithSeason("/dashboard/prizes")} className="app-pill px-4 text-xs">
              Ver detalle
            </Link>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <div className="rounded-[18px] border border-white/[0.06] bg-night/20 px-4 py-4">
              <p className="text-[10px] uppercase tracking-[0.14em] text-steel">Cobrado</p>
              <p className="mt-2 text-xl font-semibold text-ink">{formatCurrency(totalWeeklyPrizeAmount)}</p>
            </div>
            <div className="rounded-[18px] border border-white/[0.06] bg-night/20 px-4 py-4">
              <p className="text-[10px] uppercase tracking-[0.14em] text-steel">Mejor lugar</p>
              <p className="mt-2 text-xl font-semibold text-emerald-300">{bestPrizeRank ? `#${bestPrizeRank}` : "-"}</p>
            </div>
            <div className="rounded-[18px] border border-white/[0.06] bg-night/20 px-4 py-4">
              <p className="text-[10px] uppercase tracking-[0.14em] text-steel">Podios</p>
              <p className="mt-2 text-xl font-semibold text-ink">{prizeRows.length}</p>
            </div>
          </div>
        </section>
        </DashboardRuntimeBoundary>
      );
    }

    if (widgetId === "upcoming") {
      return (
        <DashboardRuntimeBoundary key={widgetId} title="Proximos juegos">
        <section className="rounded-[24px] border border-white/[0.06] bg-white/[0.03] px-4 py-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-steel">Agenda</p>
              <h2 className="mt-2 text-lg font-semibold text-ink">Proximos juegos</h2>
            </div>
            <button type="button" onClick={() => setActiveTab("proximos")} className="app-pill px-4 text-xs">
              Ver completos
            </button>
          </div>
          {nextUpcomingGroup ? (
            <div className="mt-4 space-y-3">
              <div className="rounded-[18px] border border-white/[0.06] bg-night/20 px-4 py-4">
                <p className="text-sm font-semibold text-ink">{nextUpcomingGroup.matchday.name}</p>
                <p className="mt-1 text-xs text-steel">
                  {formatMexicoCityDateTime(nextUpcomingGroup.matchday.starts_at)} a {formatMexicoCityDateTime(nextUpcomingGroup.matchday.ends_at)}
                </p>
              </div>
              <div className="space-y-2">
                {nextUpcomingGroup.matches.slice(0, 3).map((match) => (
                  <div key={match.id} className="rounded-[18px] border border-white/[0.06] bg-night/20 px-4 py-3">
                    <MatchTeamsInline
                      homeName={getMatchTeamLabel(match.home_team_id, match.home_team_name)}
                      homeCrestUrl={match.home_team_id ? (teamCrestById.get(match.home_team_id) ?? null) : null}
                      awayName={getMatchTeamLabel(match.away_team_id, match.away_team_name)}
                      awayCrestUrl={match.away_team_id ? (teamCrestById.get(match.away_team_id) ?? null) : null}
                      useWorldCupBubbles={useWorldCupAbbreviation}
                    />
                    <p className="mt-2 text-[11px] text-steel">{formatMexicoCityDateTime(match.kickoff_at)}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="mt-4 text-sm text-steel">No encontramos una siguiente jornada lista para mostrar aqui.</p>
          )}
        </section>
        </DashboardRuntimeBoundary>
      );
    }

    if (widgetId === "memberships") {
      return (
        <DashboardRuntimeBoundary key={widgetId} title="Membresias">
        <section className="rounded-[24px] border border-white/[0.06] bg-white/[0.03] px-4 py-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-steel">Membresias</p>
              <h2 className="mt-2 text-lg font-semibold text-ink">Estado de acceso</h2>
            </div>
            <Link href={buildHrefWithSeason("/dashboard/enrollments")} className="app-pill px-4 text-xs">
              Gestionar
            </Link>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <div className="rounded-[18px] border border-white/[0.06] bg-night/20 px-4 py-4">
              <p className="text-[10px] uppercase tracking-[0.14em] text-steel">Liga MX</p>
              <p className="mt-2 text-lg font-semibold text-ink">
                {hasActiveLigaMxMembership ? "Activa" : isPrePagoPendingApproval ? "Pendiente" : "Disponible"}
              </p>
              <p className="mt-1 text-xs text-steel">
                {hasActiveLigaMxMembership
                  ? "Ya puntuando en la temporada."
                  : isPrePagoPendingApproval
                    ? "Esperando aprobacion admin."
                    : "Todavia no completas tu alta regular."}
              </p>
            </div>
            <div className="rounded-[18px] border border-white/[0.06] bg-night/20 px-4 py-4">
              <p className="text-[10px] uppercase tracking-[0.14em] text-steel">Survivor</p>
              <p className="mt-2 text-lg font-semibold text-ink">
                {survivorMembershipSummary ? "Activo" : canJoinSurvivor ? "Disponible" : "No aplica"}
              </p>
              <p className="mt-1 text-xs text-steel">
                {survivorMembershipSummary
                  ? `${survivorMembershipSummary.remaining_lives}/${survivorMembershipSummary.max_lives} vidas restantes.`
                  : canJoinSurvivor
                    ? "Puedes darte de alta desde inscripciones con el mismo calendario y resultados oficiales."
                    : "Visible solo para Liga MX."}
              </p>
            </div>
            <div className="rounded-[18px] border border-white/[0.06] bg-night/20 px-4 py-4">
              <p className="text-[10px] uppercase tracking-[0.14em] text-steel">VIP</p>
              <p className="mt-2 text-lg font-semibold text-ink">{approvedVipCount}</p>
              <p className="mt-1 text-xs text-steel">
                {approvedVipCount > 0 ? "VIPs aprobadas para ti." : "Sin VIPs activas por ahora."}
              </p>
            </div>
          </div>
        </section>
        </DashboardRuntimeBoundary>
      );
    }

    if (widgetId === "matchday_results") {
      return (
        <DashboardRuntimeBoundary key={widgetId} title="Resultados por jornada">
          <section>
            <PickResultsTable
              rows={state.pickResults}
              title={state.selectedMatchday?.name ?? "Resultados por jornada"}
              emptyMessage="No hay resultados de jornada disponibles para esta temporada."
              useWorldCupBubbles={useWorldCupAbbreviation}
            />
          </section>
        </DashboardRuntimeBoundary>
      );
    }

    if (widgetId === "survivor_summary") {
      return (
        <DashboardRuntimeBoundary key={widgetId} title="Survivor">
          {renderSurvivorSummarySection({
            sectionKey: widgetId,
            season: state.selectedSeason,
            board: state.survivorBoard,
          })}
        </DashboardRuntimeBoundary>
      );
    }

    if (widgetId === "ranking") {
      return (
        <DashboardRuntimeBoundary key={widgetId} title="Ranking">
          {renderRankingSection({
            sectionKey: widgetId,
            rows: isVipDashboardContext ? selectedVipLeaderboard : state.leaderboard,
          })}
        </DashboardRuntimeBoundary>
      );
    }

    return null;
  }

  return (
    <div className="space-y-6 sm:space-y-8">
      <section className="relative px-1 py-2 sm:px-0 sm:py-1">
        <div>
          <div className="min-w-0">
            <div className="flex min-w-0 items-center">
              <h1 className="text-base font-semibold leading-tight text-ink sm:text-3xl">
                {state.me ? `Hola, ${state.me.display_name}` : "Dashboard"}
              </h1>
            </div>
            {state.me && state.seasons.length === 0 && !hasApprovedVipCompetition ? (
              <div className="mt-3 max-w-2xl border-l-2 border-[#4f7df3] px-4 py-2 text-sm text-ink">
                No tienes una quiniela activa. Revisa las inscripciones disponibles para entrar a un torneo.
                <div className="mt-2">
                  <Link href="/dashboard/enrollments" className="font-semibold text-[#4f7df3]">
                    Ver inscripciones
                  </Link>
                </div>
              </div>
            ) : shouldShowLigaMxActionPanel ? (
              <div className="mt-3 max-w-4xl rounded-2xl border border-coral/25 bg-coral/10 px-4 py-4 text-sm text-ink">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-coral">Inscripciones</p>
                    <p className="mt-2 text-sm text-sand/90">
                      Gestiona tus altas de Liga MX, Survivor y VIP desde la pestaña de inscripciones antes de seguir con picks y scores.
                    </p>
                  </div>
                  <Link href={buildHrefWithSeason("/dashboard/enrollments")} className="secondary-button text-center">
                    Abrir inscripciones
                  </Link>
                </div>
              </div>
            ) : state.me && state.selectedSeason && !selectedSeasonMembership?.can_participate && !hasApprovedVipCompetition ? (
              <div className="mt-3 max-w-2xl rounded-2xl border border-amber-300/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
                Tu cuenta esta activa y puedes entrar al dashboard, pero aun no estas dado de alta en
                {" "}{state.selectedSeason.name}. Cuando admin confirme tu acceso, te activa el torneo.
              </div>
            ) : null}
          </div>

          {dashboardEnrollmentProducts.length > 0 ? (
            <section className="mt-5 border-y border-white/10 py-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-steel">Inscripciones disponibles</p>
                  <p className="mt-1 text-sm text-ink">Torneos publicados por el administrador.</p>
                </div>
                <Link href="/dashboard/enrollments" className="text-xs font-semibold text-[#4f7df3]">Ver todas</Link>
              </div>
              <div className="mt-3 divide-y divide-white/[0.08] border-t border-white/[0.08]">
                {dashboardEnrollmentProducts.map((product) => {
                  const countdown = formatEnrollmentCountdown(product.lockAt, dashboardNow);
                  const isClosed = product.closed || countdown === "Inscripción cerrada";
                  return <div key={product.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ink">{product.name}</p>
                      <p className="mt-1 line-clamp-2 text-xs text-steel">{product.description}</p>
                      {countdown ? <p className={`mt-2 text-xs font-semibold tabular-nums ${isClosed ? "text-coral" : "text-gold"}`}>{isClosed ? "Inscripción cerrada" : `Cierra en ${countdown}`}</p> : null}
                    </div>
                    {isClosed ? <span className="shrink-0 text-sm font-semibold text-steel">Cerrado</span> : <Link href={buildHrefWithSeason("/dashboard/enrollments", product.season.id, product.season.competition_id ?? "")} className="shrink-0 text-sm font-semibold text-[#4f7df3]">{product.status}</Link>}
                  </div>
                })}
              </div>
            </section>
          ) : null}

          <div className="mt-5 flex w-full items-end gap-2 sm:gap-6">
            {computedLeagueOptions.length > 1 ? (
              <label className="hidden min-w-[180px] flex-1 space-y-1 text-xs sm:block">
                <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-steel">
                  Liga
                </span>
                <select
                  value={selectedLeagueValue}
                  onChange={(event) => handleLeagueChange(event.target.value)}
                  className={dashboardSelectClass}
                >
                  {computedLeagueOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            {selectableLeagueSeasons.length > 1 ? (
              <label className="hidden min-w-[220px] flex-1 space-y-1 text-xs sm:block">
                <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-steel">
                  Torneo
                </span>
                <select
                  value={state.selectedSeason?.id ?? ""}
                  onChange={(event) => {
                    const nextSeason = selectableLeagueSeasons.find((season) => season.id === event.target.value) ?? null;
                    if (!nextSeason) {
                      return;
                    }
                    setSeasonId(nextSeason.id, "");
                  }}
                  className={dashboardSelectClass}
                >
                  {selectableLeagueSeasons.map((season) => (
                    <option key={season.id} value={season.id}>
                      {season.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            {dashboardDefaultOptions.length > 1 ? (
              <label className="hidden min-w-[180px] flex-1 space-y-1 text-xs sm:block">
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

            <div className="flex shrink-0 flex-col items-center gap-2">
              {resolvedActiveTab === "general" ? (
                <button
                  type="button"
                  onClick={() => setIsWidgetEditorOpen((current) => !current)}
                  className={`text-[10px] font-semibold transition hover:text-[#4f7df3] active:text-[#4f7df3] sm:text-xs ${isWidgetEditorOpen ? "text-[#4f7df3]" : "text-ink"}`}
                >
                  {isWidgetEditorOpen ? "Cerrar" : "Personalizar"}
                </button>
              ) : null}
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

        {computedLeagueOptions.length > 1 || selectableLeagueSeasons.length > 1 || dashboardDefaultOptions.length > 1 ? (
          <div className="mt-3 grid gap-3 sm:hidden">
            {computedLeagueOptions.length > 1 ? (
              <label className="space-y-1 text-xs">
                <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-steel">
                  Liga
                </span>
                <select
                  value={selectedLeagueValue}
                  onChange={(event) => handleLeagueChange(event.target.value)}
                  className={dashboardSelectClass}
                >
                  {computedLeagueOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {selectableLeagueSeasons.length > 1 ? (
              <label className="space-y-1 text-xs">
                <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-steel">
                  Torneo
                </span>
                <select
                  value={state.selectedSeason?.id ?? ""}
                  onChange={(event) => {
                    const nextSeason = selectableLeagueSeasons.find((season) => season.id === event.target.value) ?? null;
                    if (!nextSeason) {
                      return;
                    }
                    setSeasonId(nextSeason.id, "");
                  }}
                  className={dashboardSelectClass}
                >
                  {selectableLeagueSeasons.map((season) => (
                    <option key={season.id} value={season.id}>
                      {season.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {dashboardDefaultOptions.length > 1 ? (
              <label className="space-y-1 text-xs">
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
          </div>
        ) : null}
      </section>

      <section className="space-y-3">
        <div className="sm:hidden">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.22em] text-steel">Menu dashboard</p>
              <p className="mt-1 truncate text-sm font-semibold text-ink">{computedActiveTabLabel}</p>
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
            <div className="mt-3 grid grid-cols-2 gap-1">
              {computedDashboardTabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setActiveTab(tab.id);
                    setIsTabMenuOpen(false);
                  }}
                  className={
                    resolvedActiveTab === tab.id
                      ? "tab-control tab-control-active"
                      : "tab-control"
                  }
                >
                  {tab.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="tab-list hidden sm:flex">
          {computedDashboardTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={
                resolvedActiveTab === tab.id
                  ? "tab-control tab-control-active"
                  : "tab-control"
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

      {resolvedActiveTab === "premios" ? (
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

      {resolvedActiveTab === "advanced" ? (
        <AdvancedStatsPanel stats={state.advancedStats} />
      ) : resolvedActiveTab === "jornada" ? (
        <PickResultsTable
          rows={state.pickResults}
          title={state.selectedMatchday ? state.selectedMatchday.name : "Jornada"}
          emptyMessage="No hay partidos cargados para la jornada seleccionada."
          useWorldCupBubbles={useWorldCupAbbreviation}
        />
      ) : resolvedActiveTab === "proximos" ? (
        <section className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-4">
            <div>
              <h2 className="text-sm font-semibold text-ink sm:text-2xl">Proximos juegos</h2>
            </div>
            <p className="text-xs text-steel sm:text-sm">Vista rapida de las siguientes jornadas del torneo.</p>
          </div>

          <div className="space-y-4">
            {(state.selectedSeason?.id ? state.upcomingMatchdayGroupsBySeasonId[state.selectedSeason.id] ?? [] : []).map((group) => (
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
            {(state.selectedSeason?.id ? state.upcomingMatchdayGroupsBySeasonId[state.selectedSeason.id] ?? [] : []).length === 0 ? (
              <p className="text-sm text-steel">No encontramos siguientes jornadas disponibles para esta temporada.</p>
            ) : null}
          </div>
        </section>
      ) : resolvedActiveTab === "survivor" ? (
        <SurvivorPageContent />
      ) : resolvedActiveTab === "probabilidades" ? (
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
      ) : resolvedActiveTab === "premios" ? (
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
                      {getMatchdayDisplayLabel(row.matchday_name, row.matchday_number)}
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
      ) : resolvedActiveTab === "general" ? (
        <>
          <section className={isWidgetEditorOpen ? "border-t border-white/[0.08] pt-5" : "hidden"}>
            {isWidgetEditorOpen ? (
              <div className="space-y-3">
                <div className="grid border-y border-white/[0.08] sm:grid-cols-2 xl:grid-cols-4">
                  {DASHBOARD_WIDGET_PRESETS.map((preset) => {
                    const isActivePreset = activePresetId === preset.id;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => handleApplyDashboardPreset(preset.widgetIds)}
                        className={
                          isActivePreset
                            ? "border-b-2 border-[#4f7df3] px-4 py-4 text-left text-[#4f7df3]"
                            : "border-b-2 border-transparent px-4 py-4 text-left text-ink transition hover:text-[#7196f7]"
                        }
                      >
                        <p className="text-sm font-semibold">{preset.label}</p>
                      </button>
                    );
                  })}
                </div>

                <div className="border-b border-white/[0.08] px-4 py-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-ink">{dashboardWidgetDraft.length} widgets activos</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleApplyDashboardPreset(DEFAULT_DASHBOARD_WIDGET_IDS)}
                      className="text-xs font-semibold text-ink transition hover:text-[#4f7df3] active:text-[#4f7df3]"
                    >
                      Reset estandar
                    </button>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
                    {dashboardWidgetDraft.map((widget) => {
                      const widgetOption = DASHBOARD_WIDGET_OPTIONS.find((option) => option.id === widget.widget_id);
                      const season = widget.season_id
                        ? state.seasons.find((seasonRow) => seasonRow.id === widget.season_id) ?? null
                        : null;
                      return (
                        <span key={widget.id} className="text-[11px] font-semibold text-ink">
                          {widgetOption?.label ?? widget.widget_id}
                          {season ? ` · ${season.competition_name ?? season.name}` : ""}
                        </span>
                      );
                    })}
                  </div>
                </div>

                {dashboardWidgetDraft.map((widget, currentIndex) => {
                  const widgetOption = DASHBOARD_WIDGET_OPTIONS.find((option) => option.id === widget.widget_id);
                  return (
                    <div
                      key={widget.id}
                      className="flex flex-col gap-4 border-b border-white/[0.08] px-4 py-5 md:grid md:grid-cols-[minmax(180px,0.65fr)_minmax(0,1.35fr)] md:items-center"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-ink">{widgetOption?.label ?? widget.widget_id}</p>
                      </div>
                      <div className="flex flex-1 flex-wrap items-center gap-2 md:justify-end">
                        <select
                          value={widget.widget_id}
                          onChange={(event) =>
                            handleUpdateDashboardWidget(widget.id, {
                              widget_id: event.target.value as DashboardWidgetId,
                              season_id: widgetSupportsSeasonContext(event.target.value as DashboardWidgetId)
                                ? widget.season_id ?? state.selectedSeason?.id ?? null
                                : null,
                            })
                          }
                          className="min-w-[180px] border-b border-white/[0.12] bg-transparent px-2 py-3 text-xs text-ink outline-none focus:border-[#4f7df3]"
                        >
                          {DASHBOARD_WIDGET_OPTIONS.map((option) => (
                            <option key={option.id} value={option.id}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        {widgetSupportsSeasonContext(widget.widget_id) ? (
                          <select
                            value={widget.season_id ?? state.selectedSeason?.id ?? ""}
                            onChange={(event) =>
                              handleUpdateDashboardWidget(widget.id, {
                                season_id: event.target.value || null,
                              })
                            }
                            className="min-w-[180px] border-b border-white/[0.12] bg-transparent px-2 py-3 text-xs text-ink outline-none focus:border-[#4f7df3]"
                          >
                            {state.seasons.filter((season) => season.visibility_status !== "archived").map((season) => (
                              <option key={season.id} value={season.id}>
                                {(season.competition_name ?? "Torneo") + " · " + season.name}
                              </option>
                            ))}
                          </select>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => handleMoveDashboardWidget(widget.id, -1)}
                          disabled={currentIndex <= 0}
                          className="px-2 py-2 text-xs font-semibold text-ink transition hover:text-[#4f7df3] active:text-[#4f7df3] disabled:opacity-30"
                        >
                          Subir
                        </button>
                        <button
                          type="button"
                          onClick={() => handleMoveDashboardWidget(widget.id, 1)}
                          disabled={currentIndex >= dashboardWidgetDraft.length - 1}
                          className="px-2 py-2 text-xs font-semibold text-ink transition hover:text-[#4f7df3] active:text-[#4f7df3] disabled:opacity-30"
                        >
                          Bajar
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemoveDashboardWidget(widget.id)}
                          disabled={dashboardWidgetDraft.length <= 1}
                          className="px-2 py-2 text-xs font-semibold text-steel transition hover:text-coral disabled:opacity-30"
                        >
                          Quitar
                        </button>
                      </div>
                    </div>
                  );
                })}
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => handleAddDashboardWidget()}
                    className="text-sm font-semibold text-ink transition hover:text-[#4f7df3] active:text-[#4f7df3]"
                  >
                    Agregar widget
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSaveDashboardWidgets()}
                    disabled={dashboardConfigSaving || !hasDashboardWidgetChanges}
                    className={`text-sm font-semibold transition hover:text-[#4f7df3] active:text-[#4f7df3] disabled:text-steel/45 ${dashboardConfigSaving ? "text-[#4f7df3]" : "text-ink"}`}
                  >
                    {dashboardConfigSaving ? "Guardando..." : hasDashboardWidgetChanges ? "Guardar configuracion" : "Sin cambios"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDashboardWidgetDraft(effectiveDashboardWidgets);
                      setIsWidgetEditorOpen(false);
                    }}
                    className="text-sm font-semibold text-steel transition hover:text-ink"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            ) : null}
          </section>

          <div className="space-y-6">
            {isVipDashboardContext
              ? visibleDashboardWidgetIds.map((widgetId) => renderGeneralWidget(widgetId))
              : canViewRegularDashboard
                ? visibleDashboardWidgetConfigs.map((widget) => renderRegularDashboardWidget(widget))
                : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
