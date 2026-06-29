"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { backendFetch, CATALOG_CACHE_TTL_MS } from "@/lib/api/backend";
import { VIP_SUMMARY_PATH } from "@/lib/api/vip";
import { filterMatchdaysBySeason, filterSeasonsByCompetition, resolveSeasonForContext, useDashboardSeasonParam } from "@/lib/dashboard-season";
import { getBrowserAccessToken } from "@/lib/supabase/session";
import type { AppBootstrap, GlobalPickBoard, Match, Matchday, Me, Pick, PickSelection, Season, Team, VipCompetition } from "@/types/api";

type PickFormState = {
  winner_selection: PickSelection | "";
  spread_selection: PickSelection | "";
  predicted_home_score: string;
  predicted_away_score: string;
  advancing_team_id: string;
};

type FormsMap = Record<string, PickFormState>;
type AutoSaveStatus = "idle" | "pending" | "saving" | "saved" | "error";

type AutoSaveState = {
  status: AutoSaveStatus;
  detail?: string;
};

type AutoSaveMap = Record<string, AutoSaveState>;

type PickBoardState = {
  me: Me | null;
  seasons: Season[];
  matchdays: Matchday[];
  selectedSeason: Season | null;
  selectedMatchday: Matchday | null;
  matches: Match[];
  existingPicks: Pick[];
  globalPickBoard: GlobalPickBoard | null;
  vipCompetitions: VipCompetition[];
  error: string | null;
};

type PickBoardTab = "mine" | "global";
type PickMatchScope = "matchday" | "today";
type PickContextOption = {
  value: string;
  label: string;
  helper: string;
};

const AUTO_SAVE_DELAY_MS = 2000;
const compactPickControlClass =
  "field-control compact-table-control h-8 min-w-0 rounded-md border-white/10 bg-white/[0.03] px-2 py-1 text-[11px] font-semibold";
const pickBoardButtonClass =
  "app-pill min-w-[10rem] px-3 disabled:cursor-not-allowed disabled:opacity-50";
const pickBoardButtonActiveClass =
  "app-pill-active min-w-[10rem] px-3 disabled:cursor-not-allowed disabled:opacity-50";

const initialState: PickBoardState = {
  me: null,
  seasons: [],
  matchdays: [],
  selectedSeason: null,
  selectedMatchday: null,
  matches: [],
  existingPicks: [],
  globalPickBoard: null,
  vipCompetitions: [],
  error: null,
};

function getSeasonTag(season: Season | null) {
  if (!season) {
    return "SIN TORNEO";
  }
  return season.slug?.toUpperCase() || season.name.toUpperCase();
}

function buildFormFromPick(pick?: Pick): PickFormState {
  return {
    winner_selection: pick?.selection ?? "",
    spread_selection: pick?.spread_selection ?? "",
    predicted_home_score: pick ? String(pick.predicted_home_score) : "",
    predicted_away_score: pick ? String(pick.predicted_away_score) : "",
    advancing_team_id: pick?.advancing_team_id ?? "",
  };
}

function isKnockoutMatch(match: Match) {
  return match.stage_type !== "regular" && match.stage_type !== "group";
}

function isWorldCupSeason(season: Season | null) {
  return season?.tournament_format === "world_cup";
}

function requiresAdvancingTeam(match: Match, season: Season | null) {
  return isWorldCupSeason(season) && isKnockoutMatch(match);
}

function isNflSeason(season: Season | null) {
  const haystack = `${season?.competition_name ?? ""} ${season?.competition_sport_name ?? ""}`.toLowerCase();
  return haystack.includes("nfl") || haystack.includes("football");
}

function isMatchReadyForPicks(match: Match) {
  return match.is_ready_for_picks;
}

function hasPredictedScore(form: PickFormState | undefined) {
  return Boolean(form && form.predicted_home_score !== "" && form.predicted_away_score !== "");
}

function isMissingAdvancingTeamSelection(
  match: Match,
  form: PickFormState | undefined,
  worldCupMode: boolean,
) {
  return worldCupMode && isKnockoutMatch(match) && hasPredictedScore(form) && !form?.advancing_team_id;
}

function isPickFormComplete(
  match: Match,
  form: PickFormState | undefined,
  nflMode: boolean,
  worldCupMode: boolean,
) {
  if (!isMatchReadyForPicks(match)) {
    return false;
  }
  if (nflMode) {
    return Boolean(form?.winner_selection && form?.spread_selection);
  }
  if (!form || form.predicted_home_score === "" || form.predicted_away_score === "") {
    return false;
  }
  if (worldCupMode && isKnockoutMatch(match) && !form.advancing_team_id) {
    return false;
  }
  return true;
}

function deriveSelectionFromForm(form: PickFormState | undefined, nflMode: boolean): PickSelection | null {
  if (nflMode) {
    return form?.winner_selection || null;
  }
  if (!form || form.predicted_home_score === "" || form.predicted_away_score === "") {
    return null;
  }

  const homeScore = Number(form.predicted_home_score);
  const awayScore = Number(form.predicted_away_score);

  if (Number.isNaN(homeScore) || Number.isNaN(awayScore)) {
    return null;
  }

  if (homeScore > awayScore) {
    return "home";
  }
  if (awayScore > homeScore) {
    return "away";
  }
  return "draw";
}

function TeamBubble({
  crestUrl,
  fallback,
  sizeClassName,
  textClassName,
  useWorldCupBubbles,
}: {
  crestUrl: string | null | undefined;
  fallback: string;
  sizeClassName: string;
  textClassName: string;
  useWorldCupBubbles: boolean;
}) {
  if (crestUrl) {
    if (!useWorldCupBubbles) {
      return <img src={crestUrl} alt={fallback} className={`${sizeClassName} object-contain`} />;
    }
    return (
      <span className={`inline-flex items-center justify-center overflow-hidden rounded-full border border-white/10 bg-white/[0.06] ${sizeClassName}`}>
        <img src={crestUrl} alt={fallback} className="h-full w-full object-cover" />
      </span>
    );
  }

  return (
    <span className={`inline-flex items-center justify-center rounded-full border border-white/10 bg-white/[0.04] font-semibold text-ink ${sizeClassName} ${textClassName}`}>
      {fallback}
    </span>
  );
}

function getSelectionLabel(selection: PickSelection | null) {
  if (selection === "home") {
    return "Local";
  }
  if (selection === "away") {
    return "Visitante";
  }
  if (selection === "draw") {
    return "Empate";
  }
  return "Pendiente";
}

function getSelectionShortLabel(selection: PickSelection | null) {
  if (selection === "home") {
    return "L";
  }
  if (selection === "away") {
    return "V";
  }
  if (selection === "draw") {
    return "E";
  }
  return "-";
}

function getOfficialResultLabel(match: GlobalPickBoard["matches"][number]) {
  if (!match.is_official || match.home_score === null || match.away_score === null) {
    return "Pendiente";
  }
  return `${match.home_score}-${match.away_score}`;
}

function getNflSideLabel(selection: PickSelection | "" | null, homeLabel: string, awayLabel: string) {
  if (selection === "home") {
    return homeLabel;
  }
  if (selection === "away") {
    return awayLabel;
  }
  return "Pendiente";
}

function getFormSignature(
  match: Match,
  form: PickFormState | undefined,
  nflMode: boolean,
  worldCupMode: boolean,
) {
  if (!isPickFormComplete(match, form, nflMode, worldCupMode)) {
    return "";
  }
  if (nflMode) {
    return `${form?.winner_selection ?? ""}:${form?.spread_selection ?? ""}`;
  }
  return `${form?.predicted_home_score}:${form?.predicted_away_score}:${form?.advancing_team_id ?? ""}`;
}

function getPickSignature(pick: Pick | undefined, nflMode: boolean) {
  if (!pick) {
    return "";
  }
  if (nflMode) {
    return `${pick.selection}:${pick.spread_selection ?? ""}`;
  }
  return `${pick.predicted_home_score}:${pick.predicted_away_score}:${pick.advancing_team_id ?? ""}`;
}

function getSelectionTone(selection: PickSelection | null) {
  if (selection === "home") {
    return "border-sky-300/50 bg-sky-400/15 text-sky-100";
  }
  if (selection === "away") {
    return "border-orange-300/50 bg-orange-400/15 text-orange-100";
  }
  if (selection === "draw") {
    return "border-amber-300/50 bg-amber-400/15 text-amber-100";
  }
  return "border-white/10 bg-white/[0.04] text-steel";
}

function getAutoSaveTone(status: AutoSaveStatus | undefined) {
  if (status === "saved") {
    return "border-emerald-300/50 bg-emerald-400/15 text-emerald-100";
  }
  if (status === "saving" || status === "pending") {
    return "border-amber-300/50 bg-amber-400/15 text-amber-100";
  }
  if (status === "error") {
    return "border-rose-300/50 bg-rose-400/15 text-rose-100";
  }
  return "border-white/10 bg-white/[0.04] text-steel";
}

function getAutoSaveShortLabel(match: Match, autoSaveState: AutoSaveState | undefined, hasSavedPick: boolean) {
  if (!match.is_ready_for_picks) {
    return hasSavedPick ? "G" : "PD";
  }
  if (match.is_locked) {
    return hasSavedPick ? "G" : "-";
  }
  if (autoSaveState?.status === "saved") {
    return "G";
  }
  if (autoSaveState?.status === "saving") {
    return "...";
  }
  if (autoSaveState?.status === "pending") {
    return "P";
  }
  if (autoSaveState?.status === "error") {
    return "E";
  }
  return "-";
}

function getAutoSaveDesktopLabel(match: Match, autoSaveState: AutoSaveState | undefined, hasSavedPick: boolean) {
  if (!match.is_ready_for_picks) {
    return hasSavedPick ? "Guardado" : "Pendiente";
  }
  if (match.is_locked) {
    return hasSavedPick ? "Guardado" : "Sin pick";
  }
  if (autoSaveState?.status === "saved") {
    return "Guardado";
  }
  if (autoSaveState?.status === "saving") {
    return "Guardando";
  }
  if (autoSaveState?.status === "pending") {
    return "Pendiente";
  }
  if (autoSaveState?.status === "error") {
    return "Error";
  }
  return "Vacio";
}

function sanitizeScoreInput(value: string) {
  return value.replace(/\D/g, "").slice(0, 2);
}

function getTeamInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((segment) => segment[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 3);
}

function getGlobalCellKey(profileId: string, matchId: string) {
  return `${profileId}:${matchId}`;
}

function buildGlobalPicksUrl(matchdayId: string, contextValue: string) {
  const params = new URLSearchParams({ matchday_id: matchdayId });
  const [contextType, contextId] = contextValue.split(":");
  if (contextType) {
    params.set("context_type", contextType);
  }
  if (contextId) {
    params.set("context_id", contextId);
  }
  return `/global-picks?${params.toString()}`;
}

function getStageLabel(match: Match) {
  if (match.stage_type === "group") {
    return match.group_label ? `Grupo ${match.group_label}` : "Grupo";
  }
  if (match.stage_type === "round_of_32") {
    return "Dieciseisavos";
  }
  if (match.stage_type === "round_of_16") {
    return "Octavos";
  }
  if (match.stage_type === "quarterfinal") {
    return "Cuartos";
  }
  if (match.stage_type === "semifinal") {
    return "Semifinal";
  }
  if (match.stage_type === "third_place") {
    return "3er lugar";
  }
  if (match.stage_type === "final") {
    return "Final";
  }
  return "Regular";
}

function formatMexicoCityCompactDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Fecha invalida";
  }

  const parts = new Intl.DateTimeFormat("es-MX", {
    timeZone: "America/Mexico_City",
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.day}/${values.month}/${values.year} ${values.hour}:${values.minute}`;
}

function getMexicoCityDateKey(value: Date | string) {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function isTodayMatch(match: Match) {
  return getMexicoCityDateKey(match.kickoff_at) === getMexicoCityDateKey(new Date());
}

function buildOverrideMessage(pick: Pick) {
  const base = pick.overridden_by_display_name
    ? `Pick ajustado por ${pick.overridden_by_display_name}.`
    : "Pick ajustado por admin.";
  if (pick.admin_override_note) {
    return `${base} ${pick.admin_override_note}`;
  }
  return base;
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

export function PickBoard() {
  const [state, setState] = useState<PickBoardState>(initialState);
  const [teams, setTeams] = useState<Team[]>([]);
  const [forms, setForms] = useState<FormsMap>({});
  const [autoSave, setAutoSave] = useState<AutoSaveMap>({});
  const [selectedGlobalContext, setSelectedGlobalContext] = useState("");
  const [activeTab, setActiveTab] = useState<PickBoardTab>("mine");
  const [matchScope, setMatchScope] = useState<PickMatchScope>("matchday");
  const [globalBoardLoading, setGlobalBoardLoading] = useState(false);
  const [globalPickError, setGlobalPickError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const teamById = Object.fromEntries(teams.map((team) => [team.id, team]));
  const useWorldCupAbbreviation = isWorldCupSeason(state.selectedSeason);
  const useWorldCupMode = isWorldCupSeason(state.selectedSeason);
  const useNflMode = isNflSeason(state.selectedSeason);

  function getMatchTeamLabel(teamId: string | null, fallbackName: string) {
    if (!useWorldCupAbbreviation || !teamId) {
      return fallbackName;
    }
    return teamById[teamId]?.short_name ?? fallbackName;
  }
  const { seasonId: seasonIdParam, competitionId, setSeasonId } = useDashboardSeasonParam();
  const visibleSeasons = filterSeasonsByCompetition(state.seasons, competitionId);

  useEffect(() => {
    async function loadBoard() {
      try {
        const accessToken = await getBrowserAccessToken();
        const bootstrap = await backendFetch<AppBootstrap>("/bootstrap", accessToken);
        const {
          me,
          active_matchdays: activeMatchdays,
          seasons,
          matchdays,
          teams: teamRows,
        } = bootstrap;
        const vipCompetitions = await backendFetch<VipCompetition[]>(VIP_SUMMARY_PATH, accessToken, {
          cacheTtlMs: CATALOG_CACHE_TTL_MS,
        });
        const preferredSeason = resolveSeasonForContext(seasons, seasonIdParam, competitionId);
        const preferredSeasonMatchdays = preferredSeason ? filterMatchdaysBySeason(matchdays, preferredSeason.id) : [];
        const activeMatchday =
          (preferredSeason
            ? activeMatchdays.find((matchday) => matchday.season_id === preferredSeason.id) ??
              pickPreferredMatchday(preferredSeasonMatchdays)
            : null) ??
          null;
        const selectedMatchday =
          activeMatchday ??
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

        if (!selectedMatchday) {
          setTeams(teamRows);
          setState({
            me,
            seasons,
            matchdays,
            selectedSeason,
            selectedMatchday: null,
            matches: [],
            existingPicks: [],
            globalPickBoard: null,
            vipCompetitions,
            error: null,
          });
          setForms({});
          setAutoSave({});
          return;
        }

        const [matches, existingPicks] = await Promise.all([
          backendFetch<Match[]>(`/matches?matchday_id=${selectedMatchday.id}`, accessToken),
          backendFetch<Pick[]>(`/my-picks?matchday_id=${selectedMatchday.id}`, accessToken),
        ]);

        const nextForms: FormsMap = {};
        matches.forEach((match) => {
          const existing = existingPicks.find((pick) => pick.match_id === match.id);
          nextForms[match.id] = buildFormFromPick(existing);
        });

        setForms(nextForms);
        setAutoSave({});
        setTeams(teamRows);
        setState({
          me,
          seasons,
          matchdays,
          selectedSeason,
          selectedMatchday,
          matches,
          existingPicks,
          globalPickBoard: null,
          vipCompetitions,
          error: null,
        });
      } catch (loadError) {
        setState((current) => ({
          ...current,
          error: loadError instanceof Error ? loadError.message : "No se pudo cargar la jornada",
        }));
      } finally {
        setLoading(false);
      }
    }

    void loadBoard();
  }, [competitionId, seasonIdParam, setSeasonId]);

  useEffect(() => {
    const timers = timersRef.current;

    state.matches.forEach((match) => {
      const existingTimer = timers[match.id];
      if (existingTimer) {
        clearTimeout(existingTimer);
        delete timers[match.id];
      }
    });

    const nextAutoSave: AutoSaveMap = {};

    state.matches.forEach((match) => {
      const form = forms[match.id];
      const existingPick = state.existingPicks.find((pick) => pick.match_id === match.id);
      const formSignature = getFormSignature(match, form, useNflMode, useWorldCupMode);
      const savedSignature = getPickSignature(existingPick, useNflMode);
      const currentState = autoSave[match.id];

      if (!match.is_ready_for_picks) {
        if (savedSignature) {
          nextAutoSave[match.id] = { status: "saved", detail: "Partido sembrado y pick ya guardado." };
        } else {
          nextAutoSave[match.id] = { status: "idle", detail: "Esperando definicion de equipos." };
        }
        return;
      }

      if (match.is_locked) {
        if (savedSignature) {
          nextAutoSave[match.id] = { status: "saved", detail: "Pick cerrado y guardado." };
        }
        return;
      }

      if (isMissingAdvancingTeamSelection(match, form, useWorldCupMode)) {
        nextAutoSave[match.id] = { status: "error", detail: "Falta seleccionar equipo que pasa." };
        return;
      }

      if (!formSignature) {
        nextAutoSave[match.id] = { status: "idle", detail: "No hay marcador registrado." };
        return;
      }

      if (formSignature === savedSignature) {
        nextAutoSave[match.id] = { status: "saved", detail: "Pick guardado." };
        return;
      }

      nextAutoSave[match.id] = { status: "pending", detail: "Guardado automatico en 2 s..." };
      timers[match.id] = setTimeout(() => {
        void savePick(match.id);
      }, AUTO_SAVE_DELAY_MS);

      if (currentState?.status === "saving") {
        nextAutoSave[match.id] = currentState;
      }
    });

    setAutoSave((current) => {
      const hasChanged =
        JSON.stringify(current) !== JSON.stringify(nextAutoSave);
      return hasChanged ? nextAutoSave : current;
    });

    return () => {
      Object.values(timers).forEach((timer) => clearTimeout(timer));
      Object.keys(timers).forEach((key) => delete timers[key]);
    };
  }, [forms, state.existingPicks, state.matches, useNflMode, useWorldCupMode]);

  async function loadSelectedMatchday(matchdayId: string) {
    try {
      setLoading(true);
      const accessToken = await getBrowserAccessToken();
      const selectedMatchday = state.matchdays.find((matchday) => matchday.id === matchdayId) ?? null;

      if (!selectedMatchday) {
        setState((current) => ({
          ...current,
          selectedMatchday: null,
          matches: [],
          existingPicks: [],
          globalPickBoard: null,
          error: null,
        }));
        setForms({});
        setAutoSave({});
        return;
      }

      const [seasons, matches, existingPicks] = await Promise.all([
        backendFetch<Season[]>("/seasons", accessToken, { cacheTtlMs: CATALOG_CACHE_TTL_MS }),
        backendFetch<Match[]>(`/matches?matchday_id=${selectedMatchday.id}`, accessToken),
        backendFetch<Pick[]>(`/my-picks?matchday_id=${selectedMatchday.id}`, accessToken),
      ]);

      const selectedSeason =
        seasons.find((season) => season.id === selectedMatchday.season_id) ??
        resolveSeasonForContext(seasons, seasonIdParam, competitionId);

      const nextForms: FormsMap = {};
      matches.forEach((match) => {
        const existing = existingPicks.find((pick) => pick.match_id === match.id);
        nextForms[match.id] = buildFormFromPick(existing);
      });

      setForms(nextForms);
      setAutoSave({});
      setState((current) => ({
        ...current,
        seasons,
        selectedSeason,
        selectedMatchday,
        matches,
        existingPicks,
        globalPickBoard: null,
        error: null,
      }));
    } catch (loadError) {
      setState((current) => ({
        ...current,
        error:
          loadError instanceof Error ? loadError.message : "No se pudo cargar la jornada seleccionada",
      }));
    } finally {
      setLoading(false);
    }
  }

  async function handleSeasonChange(seasonId: string) {
    const selectedSeason = state.seasons.find((season) => season.id === seasonId) ?? null;
    setSeasonId(seasonId, selectedSeason?.competition_id ?? competitionId);
    const seasonMatchdays = filterMatchdaysBySeason(state.matchdays, seasonId);
    const nextMatchday = pickPreferredMatchday(seasonMatchdays);

    if (!nextMatchday) {
      setState((current) => ({
        ...current,
        selectedSeason,
        selectedMatchday: null,
        matches: [],
        existingPicks: [],
        globalPickBoard: null,
        vipCompetitions: current.vipCompetitions,
        error: null,
      }));
      setForms({});
      setAutoSave({});
      return;
    }

    await loadSelectedMatchday(nextMatchday.id);
  }

  function updateForm(matchId: string, patch: Partial<PickFormState>) {
    setForms((current) => ({
      ...current,
      [matchId]: { ...current[matchId], ...patch },
    }));
  }

  const selectedSeasonMembership =
    state.selectedSeason && state.me
      ? state.me.season_memberships.find((membership) => membership.season_id === state.selectedSeason?.id) ?? null
      : null;
  const approvedVipForSelectedMatchday =
    state.selectedMatchday
      ? state.vipCompetitions.find(
          (vip) =>
            vip.my_membership?.status === "approved" &&
            vip.matchdays.some((matchday) => matchday.id === state.selectedMatchday?.id),
        ) ?? null
      : null;
  const approvedVipContextsForSelectedMatchday = useMemo(
    () =>
      state.selectedMatchday
        ? state.vipCompetitions.filter(
            (vip) =>
              vip.competition_kind === "matchday" &&
              vip.my_membership?.status === "approved" &&
              vip.matchdays.some((matchday) => matchday.id === state.selectedMatchday?.id),
          )
        : [],
    [state.selectedMatchday, state.vipCompetitions],
  );
  const globalContextOptions = useMemo<PickContextOption[]>(() => {
    const options: PickContextOption[] = [];

    if (state.selectedSeason && selectedSeasonMembership?.can_participate) {
      options.push({
        value: `season:${state.selectedSeason.id}`,
        label: `Torneo regular · ${state.selectedSeason.name}`,
        helper: "Todos los jugadores activos de la temporada",
      });
    }

    options.push(
      ...approvedVipContextsForSelectedMatchday.map((vip) => ({
        value: `vip:${vip.id}`,
        label: `VIP · ${vip.name}`,
        helper: `Participantes aprobados en ${vip.name}`,
      })),
    );

    return options;
  }, [approvedVipContextsForSelectedMatchday, selectedSeasonMembership?.can_participate, state.selectedSeason]);
  const activeGlobalContext =
    globalContextOptions.find((option) => option.value === selectedGlobalContext)?.value ??
    globalContextOptions[0]?.value ??
    "";
  const activeGlobalContextOption =
    globalContextOptions.find((option) => option.value === activeGlobalContext) ?? null;

  useEffect(() => {
    setSelectedGlobalContext((current) => {
      if (globalContextOptions.some((option) => option.value === current)) {
        return current;
      }
      return globalContextOptions[0]?.value ?? "";
    });
  }, [globalContextOptions]);

  useEffect(() => {
    async function loadGlobalPickBoard() {
      if (!state.selectedMatchday || !activeGlobalContext) {
        setGlobalBoardLoading(false);
        setGlobalPickError(null);
        setState((current) =>
          current.globalPickBoard === null ? current : { ...current, globalPickBoard: null },
        );
        return;
      }

      try {
        setGlobalBoardLoading(true);
        const accessToken = await getBrowserAccessToken();
        const globalPickBoard = await backendFetch<GlobalPickBoard>(
          buildGlobalPicksUrl(state.selectedMatchday.id, activeGlobalContext),
          accessToken,
        );
        setGlobalPickError(null);
        setState((current) => ({
          ...current,
          globalPickBoard,
        }));
      } catch (loadError) {
        setGlobalPickError(
          loadError instanceof Error ? loadError.message : "No se pudieron cargar los picks globales",
        );
        setState((current) => ({
          ...current,
          globalPickBoard: null,
        }));
      } finally {
        setGlobalBoardLoading(false);
      }
    }

    void loadGlobalPickBoard();
  }, [activeGlobalContext, state.selectedMatchday]);

  async function savePick(matchId: string) {
    try {
      const currentForm = forms[matchId];
      const match = state.matches.find((row) => row.id === matchId);
      const selection = deriveSelectionFromForm(currentForm, useNflMode);

      if (match && isMissingAdvancingTeamSelection(match, currentForm, useWorldCupMode)) {
        setAutoSave((current) => ({
          ...current,
          [matchId]: { status: "error", detail: "Falta seleccionar equipo que pasa." },
        }));
        return;
      }

      if (!match || !selection || !isPickFormComplete(match, currentForm, useNflMode, useWorldCupMode)) {
        return;
      }

      setAutoSave((current) => ({
        ...current,
        [matchId]: { status: "saving", detail: "Guardando..." },
      }));

      const accessToken = await getBrowserAccessToken();
      const existing = state.existingPicks.find((pick) => pick.match_id === matchId);
      const method = existing ? "PUT" : "POST";
      const path = existing ? `/picks/${existing.id}` : "/picks";
      const predictedHomeScore = useNflMode
        ? (selection === "home" ? 1 : 0)
        : Number(currentForm.predicted_home_score);
      const predictedAwayScore = useNflMode
        ? (selection === "away" ? 1 : 0)
        : Number(currentForm.predicted_away_score);
      const body = existing
        ? {
            selection,
            spread_selection: useNflMode ? currentForm.spread_selection || null : null,
            predicted_home_score: predictedHomeScore,
            predicted_away_score: predictedAwayScore,
            advancing_team_id: currentForm.advancing_team_id || null,
          }
        : {
            match_id: matchId,
            selection,
            spread_selection: useNflMode ? currentForm.spread_selection || null : null,
            predicted_home_score: predictedHomeScore,
            predicted_away_score: predictedAwayScore,
            advancing_team_id: currentForm.advancing_team_id || null,
          };

      const savedPick = await backendFetch<Pick>(path, accessToken, {
        method,
        body: JSON.stringify(body),
      });

      setState((current) => {
        const next = current.existingPicks.filter((pick) => pick.match_id !== matchId);
        return {
          ...current,
          existingPicks: [...next, savedPick],
          error: null,
        };
      });
      setAutoSave((current) => ({
        ...current,
        [matchId]: { status: "saved", detail: "Pick guardado automaticamente." },
      }));
    } catch (submitError) {
      setAutoSave((current) => ({
        ...current,
        [matchId]: {
          status: "error",
          detail: submitError instanceof Error ? submitError.message : "No se pudo guardar el pick",
        },
      }));
      setState((current) => ({
        ...current,
        error: submitError instanceof Error ? submitError.message : "No se pudo guardar el pick",
      }));
    }
  }

  if (loading) {
    return <p className="text-sm text-ink/60">Cargando jornada de picks...</p>;
  }

  const seasonTag = getSeasonTag(state.selectedSeason);
  const picksHeader = state.selectedMatchday
    ? `Jornada ${state.selectedMatchday.number} - ${seasonTag}`
    : "Sin jornada seleccionada";
  const selectedSeasonId = state.selectedSeason?.id;
  const seasonMatchdays = selectedSeasonId
    ? state.matchdays
        .filter((matchday) => matchday.season_id === selectedSeasonId)
        .sort((left, right) => left.number - right.number)
    : state.matchdays.slice().sort((left, right) => left.number - right.number);
  const selectedIndex = seasonMatchdays.findIndex((matchday) => matchday.id === state.selectedMatchday?.id);
  const previousMatchday = selectedIndex > 0 ? seasonMatchdays[selectedIndex - 1] : null;
  const nextMatchday =
    selectedIndex >= 0 && selectedIndex < seasonMatchdays.length - 1 ? seasonMatchdays[selectedIndex + 1] : null;
  const canPickSelectedMatchday = Boolean(selectedSeasonMembership?.can_participate || approvedVipForSelectedMatchday);
  const globalCellByKey = Object.fromEntries(
    (state.globalPickBoard?.cells ?? []).map((cell) => [getGlobalCellKey(cell.profile_id, cell.match_id), cell]),
  );
  const visibleMatches = matchScope === "today" ? state.matches.filter(isTodayMatch) : state.matches;
  const visibleMatchIds = new Set(visibleMatches.map((match) => match.id));
  const visibleGlobalMatches =
    matchScope === "today"
      ? state.globalPickBoard?.matches.filter((match) => visibleMatchIds.has(match.match_id)) ?? []
      : state.globalPickBoard?.matches ?? [];
  const hasAdvancingTeamPicks = visibleMatches.some((match) => requiresAdvancingTeam(match, state.selectedSeason));

  return (
    <div className="space-y-6">
      <div className="space-y-4 px-1 py-1">
        <h1 className="text-sm font-semibold text-ink sm:text-3xl">{picksHeader}</h1>
        {approvedVipForSelectedMatchday && !selectedSeasonMembership?.can_participate ? (
          <div className="mt-4 rounded-2xl border border-mint/30 bg-mint/10 px-4 py-3 text-sm text-mint">
            Estas capturando picks para {approvedVipForSelectedMatchday.name}. No cuentan para el ranking general.
          </div>
        ) : null}
        <div className="grid gap-2 lg:grid-cols-[minmax(0,220px)_minmax(0,220px)_auto] lg:items-end">
          <label className="space-y-1.5 text-xs">
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-steel">Temporada</span>
            <select
              value={state.selectedSeason?.id ?? ""}
              onChange={(event) => void handleSeasonChange(event.target.value)}
              className="field-control text-xs"
            >
              <option value="">Selecciona temporada</option>
              {visibleSeasons.map((season) => (
                <option key={season.id} value={season.id}>
                  {season.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1.5 text-xs">
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-steel">Jornada</span>
            <select
              value={state.selectedMatchday?.id ?? ""}
              onChange={(event) => void loadSelectedMatchday(event.target.value)}
              className="field-control text-xs"
            >
              <option value="">Selecciona jornada</option>
              {seasonMatchdays.map((matchday) => (
                <option key={matchday.id} value={matchday.id}>
                  Jornada {matchday.number} ·{" "}
                  {state.selectedSeason?.slug?.toUpperCase() ?? state.selectedSeason?.name ?? "Torneo"}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => previousMatchday && void loadSelectedMatchday(previousMatchday.id)}
              disabled={!previousMatchday}
              className={pickBoardButtonClass}
            >
              Anterior
            </button>
            <button
              type="button"
              onClick={() => nextMatchday && void loadSelectedMatchday(nextMatchday.id)}
              disabled={!nextMatchday}
              className={pickBoardButtonClass}
            >
              Siguiente
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setActiveTab("mine")}
            className={activeTab === "mine" ? pickBoardButtonActiveClass : pickBoardButtonClass}
          >
            Tus picks
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("global")}
            className={activeTab === "global" ? pickBoardButtonActiveClass : pickBoardButtonClass}
          >
            Picks Globales
          </button>
          <Link
            href="/dashboard/vip"
            prefetch={false}
            className={pickBoardButtonClass}
          >
            VIP
          </Link>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-steel">Mostrar</span>
          <button
            type="button"
            onClick={() => setMatchScope("matchday")}
            className={matchScope === "matchday" ? pickBoardButtonActiveClass : pickBoardButtonClass}
          >
            Toda la jornada
          </button>
          <button
            type="button"
            onClick={() => setMatchScope("today")}
            className={matchScope === "today" ? pickBoardButtonActiveClass : pickBoardButtonClass}
          >
            Juegos de hoy
          </button>
        </div>
      </div>

      {state.error ? <p className="text-sm text-coral">{state.error}</p> : null}

      {activeTab === "mine" && visibleMatches.length === 0 ? (
        <p className="text-sm text-steel">
          {matchScope === "today"
            ? "No hay juegos programados para hoy en la jornada seleccionada."
            : "No hay partidos disponibles para capturar picks en la jornada seleccionada."}
        </p>
      ) : null}

      {activeTab === "mine" && visibleMatches.length > 0 ? (
        <section className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            {hasAdvancingTeamPicks ? (
              <div className="flex flex-wrap items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-steel">
                <span className="text-mint">Escoge el equipo que califica</span>
                <span className="text-steel">Resultado oficial: 90 mins + TE</span>
              </div>
            ) : <span />}
            <p className="text-[10px] text-steel">Se guarda automatico 2 segundos despues del ultimo cambio.</p>
          </div>
          <div className="hidden grid-cols-[1.5fr_1fr_1fr_0.55fr_0.55fr_0.55fr_0.45fr_0.8fr] gap-2 border-b border-white/10 pb-2 text-[10px] uppercase tracking-[0.14em] text-steel/80 md:grid">
            <p>Partido</p>
            <p className="text-center">Inicio</p>
            <p className="text-center">Cierre</p>
            <p className="text-center">Local</p>
            <p className="text-center">Visitante</p>
            <p className="text-center">Pick</p>
            <p className="text-center">Estado</p>
            <p className="text-center">Guardado</p>
          </div>
          <div className="space-y-2 md:space-y-0">
            {visibleMatches.map((match) => {
              const form = forms[match.id];
              const existingPick = state.existingPicks.find((pick) => pick.match_id === match.id);
              const derivedSelection = deriveSelectionFromForm(form, useNflMode);
              const autoSaveState = autoSave[match.id];
              const homeTeam = match.home_team_id ? teamById[match.home_team_id] : undefined;
              const awayTeam = match.away_team_id ? teamById[match.away_team_id] : undefined;
              const autoSaveLabel = getAutoSaveShortLabel(
                match,
                autoSaveState,
                Boolean(existingPick),
              );
              const pickDisabled = match.is_locked || !match.is_ready_for_picks || !canPickSelectedMatchday;
              const canPickAdvancingTeam = requiresAdvancingTeam(match, state.selectedSeason) && match.is_ready_for_picks;
              const missingAdvancingTeamSelection = isMissingAdvancingTeamSelection(match, form, useWorldCupMode);
              const homeAdvances = canPickAdvancingTeam && form?.advancing_team_id === match.home_team_id;
              const awayAdvances = canPickAdvancingTeam && form?.advancing_team_id === match.away_team_id;
              const teamPickBaseClass =
                "mx-auto flex min-w-0 max-w-[74px] flex-col items-center justify-start gap-1 self-start rounded-full border-2 px-2 py-1 text-center transition";
              const teamPickIdleClass = canPickAdvancingTeam
                ? "border-transparent hover:border-mint/50 hover:bg-mint/10"
                : "border-transparent";
              const teamPickSelectedClass = "border-mint bg-mint/15 text-mint shadow-[0_0_0_1px_rgba(74,222,128,0.25)]";

              return (
                <div key={match.id} className="border-b border-white/5 py-2 last:border-b-0">
                  <div className="grid grid-cols-[1.7fr_1fr_0.55fr_0.55fr_0.55fr_0.45fr_0.7fr] items-center gap-1.5 md:grid-cols-[1.5fr_1fr_1fr_0.55fr_0.55fr_0.55fr_0.45fr_0.8fr] md:gap-2">
                    <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-1">
                      <button
                        type="button"
                        onClick={() => canPickAdvancingTeam && updateForm(match.id, { advancing_team_id: match.home_team_id ?? "" })}
                        disabled={!canPickAdvancingTeam || pickDisabled}
                        aria-pressed={homeAdvances}
                        aria-label={`Escoge ${match.home_team_name} como equipo que califica`}
                        className={`${teamPickBaseClass} ${homeAdvances ? teamPickSelectedClass : teamPickIdleClass} disabled:cursor-default`}
                      >
                        <TeamBubble
                          crestUrl={homeTeam?.crest_url}
                          fallback={getTeamInitials(match.home_team_name)}
                          sizeClassName="h-7 w-7"
                          textClassName="text-[9px]"
                          useWorldCupBubbles={useWorldCupAbbreviation}
                        />
                        <span className={`min-h-[20px] max-w-[58px] text-[8px] leading-tight ${homeAdvances ? "text-mint" : "text-steel"}`}>
                          {getMatchTeamLabel(match.home_team_id, match.home_team_name)}
                        </span>
                      </button>
                    <span className="self-start pt-2 text-[9px] font-semibold uppercase tracking-[0.12em] text-steel/70">
                      vs
                    </span>
                      <button
                        type="button"
                        onClick={() => canPickAdvancingTeam && updateForm(match.id, { advancing_team_id: match.away_team_id ?? "" })}
                        disabled={!canPickAdvancingTeam || pickDisabled}
                        aria-pressed={awayAdvances}
                        aria-label={`Escoge ${match.away_team_name} como equipo que califica`}
                        className={`${teamPickBaseClass} ${awayAdvances ? teamPickSelectedClass : teamPickIdleClass} disabled:cursor-default`}
                      >
                        <TeamBubble
                          crestUrl={awayTeam?.crest_url}
                          fallback={getTeamInitials(match.away_team_name)}
                          sizeClassName="h-7 w-7"
                          textClassName="text-[9px]"
                          useWorldCupBubbles={useWorldCupAbbreviation}
                        />
                        <span className={`min-h-[20px] max-w-[58px] text-[8px] leading-tight ${awayAdvances ? "text-mint" : "text-steel"}`}>
                          {getMatchTeamLabel(match.away_team_id, match.away_team_name)}
                        </span>
                      </button>
                    </div>
                    <div className="text-center">
                      <p className="text-[6px] uppercase tracking-[0.06em] text-steel/80 md:hidden">Inicio</p>
                      <p className="mt-1 text-[9px] text-ink md:mt-0">{formatMexicoCityCompactDateTime(match.kickoff_at)}</p>
                      <p className="mt-1 hidden text-[8px] text-steel md:block">
                        {getStageLabel(match)}{match.bracket_slot ? ` · ${match.bracket_slot}` : ""}
                      </p>
                    </div>
                    <div className="hidden text-center md:block">
                      <p className="text-[6px] uppercase tracking-[0.06em] text-steel/80 md:hidden">Cierre</p>
                      <p className="mt-1 text-[9px] text-ink md:mt-0">{formatMexicoCityCompactDateTime(match.picks_lock_at)}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-[6px] uppercase tracking-[0.06em] text-steel/80 md:hidden">
                        {useNflMode ? "ML" : "L"}
                      </p>
                      {useNflMode ? (
                        <div className="flex flex-col items-center gap-1">
                          <button
                            type="button"
                            onClick={() => updateForm(match.id, { winner_selection: "home" })}
                            disabled={pickDisabled}
                            className={`app-pill h-7 min-w-[52px] px-2 text-[9px] ${form?.winner_selection === "home" ? "app-pill-active text-ink" : ""}`}
                          >
                            {getMatchTeamLabel(match.home_team_id, match.home_team_name)}
                          </button>
                          <button
                            type="button"
                            onClick={() => updateForm(match.id, { winner_selection: "away" })}
                            disabled={pickDisabled}
                            className={`app-pill h-7 min-w-[52px] px-2 text-[9px] ${form?.winner_selection === "away" ? "app-pill-active text-ink" : ""}`}
                          >
                            {getMatchTeamLabel(match.away_team_id, match.away_team_name)}
                          </button>
                        </div>
                      ) : (
                        <input
                          type="text"
                          inputMode="numeric"
                          value={form?.predicted_home_score ?? ""}
                          onChange={(event) =>
                            updateForm(match.id, {
                              predicted_home_score: sanitizeScoreInput(event.target.value),
                            })
                          }
                          onFocus={(event) => event.currentTarget.select()}
                          disabled={pickDisabled}
                          placeholder="-"
                          className={`${compactPickControlClass} mx-auto w-9 [appearance:textfield]`}
                        />
                      )}
                    </div>
                    <div className="text-center">
                      <p className="text-[6px] uppercase tracking-[0.06em] text-steel/80 md:hidden">
                        {useNflMode ? "ATS" : "V"}
                      </p>
                      {useNflMode ? (
                        <div className="flex flex-col items-center gap-1">
                          <button
                            type="button"
                            onClick={() => updateForm(match.id, { spread_selection: "home" })}
                            disabled={pickDisabled || !match.spread_home_line}
                            className={`app-pill h-7 min-w-[52px] px-2 text-[9px] ${form?.spread_selection === "home" ? "app-pill-active text-ink" : ""}`}
                          >
                            {match.spread_home_line ? `${getMatchTeamLabel(match.home_team_id, match.home_team_name)} ${match.spread_home_line}` : "Sin linea"}
                          </button>
                          <button
                            type="button"
                            onClick={() => updateForm(match.id, { spread_selection: "away" })}
                            disabled={pickDisabled || !match.spread_away_line}
                            className={`app-pill h-7 min-w-[52px] px-2 text-[9px] ${form?.spread_selection === "away" ? "app-pill-active text-ink" : ""}`}
                          >
                            {match.spread_away_line ? `${getMatchTeamLabel(match.away_team_id, match.away_team_name)} ${match.spread_away_line}` : "Sin linea"}
                          </button>
                        </div>
                      ) : (
                        <input
                          type="text"
                          inputMode="numeric"
                          value={form?.predicted_away_score ?? ""}
                          onChange={(event) =>
                            updateForm(match.id, {
                              predicted_away_score: sanitizeScoreInput(event.target.value),
                            })
                          }
                          onFocus={(event) => event.currentTarget.select()}
                          disabled={pickDisabled}
                          placeholder="-"
                          className={`${compactPickControlClass} mx-auto w-9 [appearance:textfield]`}
                        />
                      )}
                    </div>
                    <div className="text-center">
                      <p className="text-[6px] uppercase tracking-[0.06em] text-steel/80 md:hidden">Pick</p>
                      <p className={`mt-1 text-[10px] font-semibold md:mt-0 ${derivedSelection ? "text-ink" : "text-steel"}`}>
                        <span className="md:hidden">
                          {useNflMode
                            ? getSelectionShortLabel(derivedSelection)
                            : getSelectionShortLabel(derivedSelection)}
                        </span>
                        <span className="hidden md:inline">
                          {useNflMode
                            ? getNflSideLabel(derivedSelection, match.home_team_name, match.away_team_name)
                            : getSelectionLabel(derivedSelection)}
                        </span>
                      </p>
                      {useNflMode ? (
                        <p className="mt-1 text-[8px] text-steel">
                          {getNflSideLabel(form?.spread_selection ?? null, `${match.home_team_name} ${match.spread_home_line ?? ""}`.trim(), `${match.away_team_name} ${match.spread_away_line ?? ""}`.trim())}
                        </p>
                      ) : null}
                    </div>
                    <div className="text-center">
                      <p className="text-[6px] uppercase tracking-[0.06em] text-steel/80 md:hidden">Estado</p>
                      <p
                        className={`mt-1 text-[10px] font-semibold md:mt-0 ${
                          !match.is_ready_for_picks
                            ? "text-amber-100"
                            : match.is_locked
                              ? "text-rose-100"
                              : "text-emerald-100"
                        }`}
                      >
                        <span className="md:hidden">
                          {!match.is_ready_for_picks ? "PD" : match.is_locked ? "C" : "A"}
                        </span>
                        <span className="hidden md:inline">
                          {!match.is_ready_for_picks ? "Pendiente" : match.is_locked ? "Cerrado" : "Abierto"}
                        </span>
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="text-[6px] uppercase tracking-[0.06em] text-steel/80 md:hidden">Guardado</p>
                      <p
                        title={autoSaveState?.detail}
                        className={`mt-1 text-[10px] font-semibold md:mt-0 ${
                          autoSaveState?.status === "saved"
                            ? "text-emerald-100"
                            : autoSaveState?.status === "saving" || autoSaveState?.status === "pending"
                              ? "text-amber-100"
                              : autoSaveState?.status === "error"
                                ? "text-rose-100"
                                : "text-steel"
                        }`}
                      >
                        <span className="md:hidden">{autoSaveLabel}</span>
                        <span className="hidden md:inline">{getAutoSaveDesktopLabel(match, autoSaveState, Boolean(existingPick))}</span>
                      </p>
                    </div>
                  </div>
                  {requiresAdvancingTeam(match, state.selectedSeason) && !match.is_ready_for_picks ? (
                    <div className="mt-2 rounded-xl border border-amber-300/20 bg-amber-400/10 px-3 py-2 text-[10px] text-amber-100">
                      Este cruce todavia esta sembrado con placeholders. Los picks se habilitan en cuanto queden definidos ambos equipos.
                    </div>
                  ) : null}
                  {missingAdvancingTeamSelection ? (
                    <div className="mt-2 rounded-xl border border-rose-300/20 bg-rose-400/10 px-3 py-2 text-[10px] text-rose-100">
                      Falta seleccionar equipo que pasa para guardar este pick.
                    </div>
                  ) : null}
                  {existingPick?.is_admin_override ? (
                    <div className="mt-2 rounded-xl border border-amber-300/20 bg-amber-400/10 px-3 py-2 text-[10px] text-amber-100">
                      {buildOverrideMessage(existingPick)}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {activeTab === "global" ? (
        <section className="space-y-3">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,320px)] lg:items-end">
            <div className="space-y-1">
              <p className="text-[10px] uppercase tracking-[0.18em] text-steel/80">Picks Globales</p>
              <p className="text-[10px] text-steel">
                Los picks de otros jugadores se revelan en cuanto se cierra el pick de ese partido.
              </p>
            </div>
            {globalContextOptions.length > 1 ? (
              <label className="space-y-1 text-xs">
                <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-steel">Contexto</span>
                <select
                  value={activeGlobalContext}
                  onChange={(event) => setSelectedGlobalContext(event.target.value)}
                  className="field-control text-xs"
                >
                  {globalContextOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>

          {activeGlobalContextOption ? (
            <p className="text-[10px] text-steel">{activeGlobalContextOption.helper}</p>
          ) : null}

          {globalPickError ? <p className="text-sm text-coral">{globalPickError}</p> : null}

          {globalBoardLoading ? (
            <p className="text-sm text-steel">Cargando picks globales...</p>
          ) : globalContextOptions.length === 0 ? (
            <p className="text-sm text-steel">
              No tienes acceso a picks globales para esta jornada. Si te activan en el torneo regular o en una VIP,
              aparecera aqui.
            </p>
          ) : !state.globalPickBoard || state.globalPickBoard.players.length === 0 || visibleGlobalMatches.length === 0 ? (
            <p className="text-sm text-steel">
              {matchScope === "today"
                ? "No hay juegos de hoy para mostrar en picks globales."
                : "Todavia no hay jugadores activos para mostrar en esta jornada."}
            </p>
          ) : (
            <div className="no-scrollbar overflow-x-auto touch-pan-x">
              <table className="min-w-[760px] table-fixed text-left text-[11px] text-steel">
                <colgroup>
                  <col className="w-[180px]" />
                  {visibleGlobalMatches.map((match) => (
                    <col key={match.match_id} className="w-[140px]" />
                  ))}
                </colgroup>
                <thead className="app-table-head">
                  <tr>
                    <th className="sticky left-0 z-10 bg-[rgba(12,24,42,0.72)] px-3 py-2 text-left backdrop-blur-sm">Jugador</th>
                    {visibleGlobalMatches.map((match) => (
                      <th key={match.match_id} className="px-3 py-2 text-center">
                        <div className="space-y-1">
                          <div className="flex items-center justify-center gap-2">
                            <TeamBubble
                              crestUrl={match.home_team_crest_url}
                              fallback={getTeamInitials(match.home_team_name)}
                              sizeClassName="h-5 w-5"
                              textClassName="text-[8px]"
                              useWorldCupBubbles={useWorldCupAbbreviation}
                            />
                            <span className="text-[10px] font-medium text-ink">vs</span>
                            <TeamBubble
                              crestUrl={match.away_team_crest_url}
                              fallback={getTeamInitials(match.away_team_name)}
                              sizeClassName="h-5 w-5"
                              textClassName="text-[8px]"
                              useWorldCupBubbles={useWorldCupAbbreviation}
                            />
                          </div>
                          {useNflMode ? (
                            <p className="text-[9px] text-steel">
                              {match.spread_home_line ?? "-"} / {match.spread_away_line ?? "-"}
                            </p>
                          ) : null}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-white/[0.06] bg-white/[0.025]">
                    <td className="sticky left-0 z-10 bg-[rgba(12,24,42,0.82)] px-3 py-2 text-left backdrop-blur-sm">
                      <p className="truncate text-[10px] font-semibold uppercase tracking-[0.14em] text-steel">
                        Resultado oficial
                      </p>
                    </td>
                    {visibleGlobalMatches.map((match) => (
                      <td key={match.match_id} className="px-3 py-2 text-center">
                        {match.is_official && match.home_score !== null && match.away_score !== null ? (
                          <span className="inline-flex min-w-14 justify-center rounded-md border border-emerald-300/30 bg-emerald-400/10 px-2 py-1 text-[11px] font-semibold text-emerald-100">
                            {getOfficialResultLabel(match)}
                          </span>
                        ) : (
                          <span className="text-[10px] font-semibold uppercase text-steel/65">Pendiente</span>
                        )}
                      </td>
                    ))}
                  </tr>
                  {state.globalPickBoard.players.map((player) => (
                    <tr key={player.profile_id} className="app-table-row border-b last:border-b-0">
                      <td className="sticky left-0 z-10 bg-[rgba(12,24,42,0.72)] px-3 py-2 text-left backdrop-blur-sm">
                        <p className="truncate font-medium text-ink">{player.display_name}</p>
                      </td>
                      {visibleGlobalMatches.map((match) => {
                        const cell = globalCellByKey[getGlobalCellKey(player.profile_id, match.match_id)];
                        return (
                          <td key={match.match_id} className="px-3 py-2 text-center">
                            {!match.is_locked || !cell?.is_revealed ? (
                              <span className="text-[10px] font-semibold uppercase text-steel/65">Oculto</span>
                            ) : cell.has_pick && cell.selection ? (
                              <div className="space-y-1 text-center">
                                {useNflMode ? (
                                  <>
                                    <p className="font-semibold text-ink">
                                      ML {getSelectionShortLabel(cell.selection)}
                                    </p>
                                    <p className="text-[10px] font-semibold uppercase text-steel">
                                      ATS {getSelectionShortLabel(cell.spread_selection ?? null)}
                                    </p>
                                  </>
                                ) : (
                                  <>
                                    <p className="font-semibold text-ink">
                                      {cell.predicted_home_score}-{cell.predicted_away_score}
                                    </p>
                                    <p className="text-[10px] font-semibold uppercase text-steel">
                                      {getSelectionShortLabel(cell.selection)}
                                    </p>
                                  </>
                                )}
                              </div>
                            ) : (
                              <span className="text-[10px] font-semibold uppercase text-steel/65">Sin pick</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
