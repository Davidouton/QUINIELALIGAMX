"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { backendFetch } from "@/lib/api/backend";
import { useDashboardSeasonParam } from "@/lib/dashboard-season";
import { getBrowserAccessToken } from "@/lib/supabase/session";
import type { GlobalPickBoard, Match, Matchday, Me, Pick, PickSelection, Season, Team } from "@/types/api";

type PickFormState = {
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
  error: string | null;
};

type PickBoardTab = "mine" | "global";

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

function isMatchReadyForPicks(match: Match) {
  return match.is_ready_for_picks;
}

function isPickFormComplete(match: Match, form: PickFormState | undefined) {
  if (!isMatchReadyForPicks(match)) {
    return false;
  }
  if (!form || form.predicted_home_score === "" || form.predicted_away_score === "") {
    return false;
  }
  if (isKnockoutMatch(match) && !form.advancing_team_id) {
    return false;
  }
  return true;
}

function deriveSelectionFromForm(form: PickFormState | undefined): PickSelection | null {
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

function getFormSignature(match: Match, form: PickFormState | undefined) {
  if (!isPickFormComplete(match, form)) {
    return "";
  }
  return `${form?.predicted_home_score}:${form?.predicted_away_score}:${form?.advancing_team_id ?? ""}`;
}

function getPickSignature(pick: Pick | undefined) {
  if (!pick) {
    return "";
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
  const [activeTab, setActiveTab] = useState<PickBoardTab>("mine");
  const [loading, setLoading] = useState(true);
  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const teamById = Object.fromEntries(teams.map((team) => [team.id, team]));
  const useWorldCupAbbreviation = isWorldCupSeason(state.selectedSeason);

  function getMatchTeamLabel(teamId: string | null, fallbackName: string) {
    if (!useWorldCupAbbreviation || !teamId) {
      return fallbackName;
    }
    return teamById[teamId]?.short_name ?? fallbackName;
  }
  const { seasonId: seasonIdParam, setSeasonId } = useDashboardSeasonParam();

  useEffect(() => {
    async function loadBoard() {
      try {
        const accessToken = await getBrowserAccessToken();
        const [me, activeMatchdays, seasons, matchdays, teamRows] = await Promise.all([
          backendFetch<Me>("/me", accessToken),
          backendFetch<Matchday[]>("/matchdays?status=active", accessToken),
          backendFetch<Season[]>("/seasons", accessToken),
          backendFetch<Matchday[]>("/matchdays", accessToken),
          backendFetch<Team[]>("/teams", accessToken),
        ]);
        const preferredSeason =
          seasons.find((season) => season.id === seasonIdParam) ??
          seasons.find((season) => season.is_active) ??
          seasons[0] ??
          null;
        const preferredSeasonMatchdays = preferredSeason
          ? matchdays.filter((matchday) => matchday.season_id === preferredSeason.id)
          : [];
        const activeMatchday =
          (preferredSeason
            ? activeMatchdays.find((matchday) => matchday.season_id === preferredSeason.id) ??
              pickPreferredMatchday(preferredSeasonMatchdays)
            : null) ??
          pickPreferredMatchday(activeMatchdays) ??
          pickPreferredMatchday(matchdays);
        const selectedMatchday =
          activeMatchday ??
          null;
        const selectedSeason =
          preferredSeason ??
          seasons.find((season) => season.id === selectedMatchday?.season_id) ??
          null;

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
            error: null,
          });
          setForms({});
          setAutoSave({});
          return;
        }

        const [matches, existingPicks, globalPickBoard] = await Promise.all([
          backendFetch<Match[]>(`/matches?matchday_id=${selectedMatchday.id}`, accessToken),
          backendFetch<Pick[]>(`/my-picks?matchday_id=${selectedMatchday.id}`, accessToken),
          backendFetch<GlobalPickBoard>(`/global-picks?matchday_id=${selectedMatchday.id}`, accessToken),
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
          globalPickBoard,
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
  }, [seasonIdParam]);

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
      const formSignature = getFormSignature(match, form);
      const savedSignature = getPickSignature(existingPick);
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
  }, [forms, state.existingPicks, state.matches]);

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

      const [seasons, matches, existingPicks, globalPickBoard] = await Promise.all([
        backendFetch<Season[]>("/seasons", accessToken),
        backendFetch<Match[]>(`/matches?matchday_id=${selectedMatchday.id}`, accessToken),
        backendFetch<Pick[]>(`/my-picks?matchday_id=${selectedMatchday.id}`, accessToken),
        backendFetch<GlobalPickBoard>(`/global-picks?matchday_id=${selectedMatchday.id}`, accessToken),
      ]);

      const selectedSeason =
        seasons.find((season) => season.id === selectedMatchday.season_id) ??
        seasons.find((season) => season.is_active) ??
        null;

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
        globalPickBoard,
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
    setSeasonId(seasonId);
    const seasonMatchdays = state.matchdays.filter((matchday) => !seasonId || matchday.season_id === seasonId);
    const nextMatchday = pickPreferredMatchday(seasonMatchdays);
    const selectedSeason = state.seasons.find((season) => season.id === seasonId) ?? null;

    if (!nextMatchday) {
      setState((current) => ({
        ...current,
        selectedSeason,
        selectedMatchday: null,
        matches: [],
        existingPicks: [],
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

  async function savePick(matchId: string) {
    try {
      const currentForm = forms[matchId];
      const match = state.matches.find((row) => row.id === matchId);
      const selection = deriveSelectionFromForm(currentForm);

      if (!match || !selection || !isPickFormComplete(match, currentForm)) {
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
      const body = existing
        ? {
            selection,
            predicted_home_score: Number(currentForm.predicted_home_score),
            predicted_away_score: Number(currentForm.predicted_away_score),
            advancing_team_id: currentForm.advancing_team_id || null,
          }
        : {
            match_id: matchId,
            selection,
            predicted_home_score: Number(currentForm.predicted_home_score),
            predicted_away_score: Number(currentForm.predicted_away_score),
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
  const showMembershipWarning =
    state.me !== null &&
    state.me.active_season_id === state.selectedSeason?.id &&
    !state.me.can_participate_active_season;
  const globalCellByKey = Object.fromEntries(
    (state.globalPickBoard?.cells ?? []).map((cell) => [getGlobalCellKey(cell.profile_id, cell.match_id), cell]),
  );

  return (
    <div className="space-y-6">
      <div className="space-y-4 px-1 py-1">
        <h1 className="text-sm font-semibold text-ink sm:text-3xl">{picksHeader}</h1>
        {showMembershipWarning ? (
          <div className="mt-4 rounded-2xl border border-amber-300/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
            Tu cuenta puede entrar al dashboard, pero todavia no esta dada de alta en este torneo.
            El admin debe activarte para capturar picks.
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
              {state.seasons.map((season) => (
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
      </div>

      {state.error ? <p className="text-sm text-coral">{state.error}</p> : null}

      {activeTab === "mine" && state.matches.length === 0 ? (
        <p className="text-sm text-steel">
          No hay partidos disponibles para capturar picks en la jornada seleccionada.
        </p>
      ) : null}

      {activeTab === "mine" && state.matches.length > 0 ? (
        <section className="space-y-3">
          <div className="flex justify-end">
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
            {state.matches.map((match) => {
              const form = forms[match.id];
              const existingPick = state.existingPicks.find((pick) => pick.match_id === match.id);
              const derivedSelection = deriveSelectionFromForm(form);
              const autoSaveState = autoSave[match.id];
              const homeTeam = match.home_team_id ? teamById[match.home_team_id] : undefined;
              const awayTeam = match.away_team_id ? teamById[match.away_team_id] : undefined;
              const autoSaveLabel = getAutoSaveShortLabel(
                match,
                autoSaveState,
                Boolean(existingPick),
              );
              const pickDisabled = match.is_locked || !match.is_ready_for_picks;

              return (
                <div key={match.id} className="border-b border-white/5 py-2 last:border-b-0">
                  <div className="grid grid-cols-[1.7fr_1fr_0.55fr_0.55fr_0.55fr_0.45fr_0.7fr] items-center gap-1.5 md:grid-cols-[1.5fr_1fr_1fr_0.55fr_0.55fr_0.55fr_0.45fr_0.8fr] md:gap-2">
                    <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-1">
                      <div className="flex min-w-0 flex-col items-center justify-start gap-1 self-start text-center">
                      <TeamBubble
                        crestUrl={homeTeam?.crest_url}
                        fallback={getTeamInitials(match.home_team_name)}
                        sizeClassName="h-7 w-7"
                        textClassName="text-[9px]"
                        useWorldCupBubbles={useWorldCupAbbreviation}
                      />
                      <span className="min-h-[20px] max-w-[58px] text-[8px] leading-tight text-steel">
                        {getMatchTeamLabel(match.home_team_id, match.home_team_name)}
                      </span>
                    </div>
                    <span className="self-start pt-2 text-[9px] font-semibold uppercase tracking-[0.12em] text-steel/70">
                      vs
                    </span>
                    <div className="flex min-w-0 flex-col items-center justify-start gap-1 self-start text-center">
                      <TeamBubble
                        crestUrl={awayTeam?.crest_url}
                        fallback={getTeamInitials(match.away_team_name)}
                        sizeClassName="h-7 w-7"
                        textClassName="text-[9px]"
                        useWorldCupBubbles={useWorldCupAbbreviation}
                      />
                      <span className="min-h-[20px] max-w-[58px] text-[8px] leading-tight text-steel">
                        {getMatchTeamLabel(match.away_team_id, match.away_team_name)}
                      </span>
                    </div>
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
                      <p className="text-[6px] uppercase tracking-[0.06em] text-steel/80 md:hidden">L</p>
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
                    </div>
                    <div className="text-center">
                      <p className="text-[6px] uppercase tracking-[0.06em] text-steel/80 md:hidden">V</p>
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
                    </div>
                    <div className="text-center">
                      <p className="text-[6px] uppercase tracking-[0.06em] text-steel/80 md:hidden">Pick</p>
                      <p className={`mt-1 text-[10px] font-semibold md:mt-0 ${derivedSelection ? "text-ink" : "text-steel"}`}>
                        <span className="md:hidden">{getSelectionShortLabel(derivedSelection)}</span>
                        <span className="hidden md:inline">{getSelectionLabel(derivedSelection)}</span>
                      </p>
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
                  {isKnockoutMatch(match) && match.is_ready_for_picks ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-steel">
                        Equipo que avanza
                      </p>
                      <button
                        type="button"
                        onClick={() => updateForm(match.id, { advancing_team_id: match.home_team_id ?? "" })}
                        disabled={pickDisabled}
                        className={`app-pill px-3 text-[10px] ${form?.advancing_team_id === match.home_team_id ? "app-pill-active text-ink" : ""}`}
                      >
                        {getMatchTeamLabel(match.home_team_id, match.home_team_name)}
                      </button>
                      <button
                        type="button"
                        onClick={() => updateForm(match.id, { advancing_team_id: match.away_team_id ?? "" })}
                        disabled={pickDisabled}
                        className={`app-pill px-3 text-[10px] ${form?.advancing_team_id === match.away_team_id ? "app-pill-active text-ink" : ""}`}
                      >
                        {getMatchTeamLabel(match.away_team_id, match.away_team_name)}
                      </button>
                      <p className="text-[10px] text-steel">
                        90 min + clasificado correcto = hasta 6 puntos.
                      </p>
                    </div>
                  ) : isKnockoutMatch(match) ? (
                    <div className="mt-2 rounded-xl border border-amber-300/20 bg-amber-400/10 px-3 py-2 text-[10px] text-amber-100">
                      Este cruce todavia esta sembrado con placeholders. Los picks se habilitan en cuanto queden definidos ambos equipos.
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
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[10px] uppercase tracking-[0.18em] text-steel/80">Picks Globales</p>
            <p className="text-[10px] text-steel">
              Los picks de otros jugadores se revelan en cuanto se cierra el pick de ese partido.
            </p>
          </div>

          {!state.globalPickBoard || state.globalPickBoard.players.length === 0 ? (
            <p className="text-sm text-steel">Todavia no hay jugadores activos para mostrar en esta jornada.</p>
          ) : (
            <div className="no-scrollbar overflow-x-auto touch-pan-x">
              <table className="min-w-[760px] table-fixed text-left text-[11px] text-steel">
                <colgroup>
                  <col className="w-[180px]" />
                  {state.globalPickBoard.matches.map((match) => (
                    <col key={match.match_id} className="w-[140px]" />
                  ))}
                </colgroup>
                <thead className="app-table-head">
                  <tr>
                    <th className="sticky left-0 z-10 bg-[rgba(12,24,42,0.72)] px-3 py-2 text-left backdrop-blur-sm">Jugador</th>
                    {state.globalPickBoard.matches.map((match) => (
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
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {state.globalPickBoard.players.map((player) => (
                    <tr key={player.profile_id} className="app-table-row border-b last:border-b-0">
                      <td className="sticky left-0 z-10 bg-[rgba(12,24,42,0.72)] px-3 py-2 text-left backdrop-blur-sm">
                        <p className="truncate font-medium text-ink">{player.display_name}</p>
                      </td>
                      {state.globalPickBoard?.matches.map((match) => {
                        const cell = globalCellByKey[getGlobalCellKey(player.profile_id, match.match_id)];
                        return (
                          <td key={match.match_id} className="px-3 py-2 text-center">
                            {!match.is_locked || !cell?.is_revealed ? (
                              <span className="text-[10px] font-semibold uppercase text-steel/65">Oculto</span>
                            ) : cell.has_pick && cell.predicted_home_score !== null && cell.predicted_away_score !== null ? (
                              <div className="space-y-1 text-center">
                                <p className="font-semibold text-ink">
                                  {cell.predicted_home_score}-{cell.predicted_away_score}
                                </p>
                                <p className="text-[10px] font-semibold uppercase text-steel">
                                  {getSelectionShortLabel(cell.selection)}
                                </p>
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
