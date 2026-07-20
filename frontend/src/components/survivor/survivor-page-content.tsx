"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { backendFetch, CATALOG_CACHE_TTL_MS } from "@/lib/api/backend";
import { isSurvivorAvailableForSeason, resolveSurvivorSeason, useDashboardSeasonParam } from "@/lib/dashboard-season";
import { formatMexicoCityDateTime } from "@/lib/datetime/mexico-city";
import { getBrowserAccessToken } from "@/lib/supabase/session";
import type { Season, SurvivorBoard } from "@/types/api";

const initialBoard: SurvivorBoard = {
  season: {
    season_id: "",
    season_name: "",
    competition_id: null,
    competition_name: null,
    survivor_enabled: false,
    survivor_name: "Survivor",
    survivor_max_lives: 1,
    registration_lock_at: null,
    registration_open: true,
    total_entries: 0,
  },
  current_matchday: null,
  my_membership: null,
  my_picks: [],
  available_teams: [],
  leaderboard: [],
};

function renderLives(remainingLives: number, maxLives: number, compact = false) {
  return (
    <span
      className="inline-flex items-center gap-1"
      title={`${remainingLives} de ${maxLives} vidas disponibles`}
      aria-label={`${remainingLives} de ${maxLives} vidas disponibles`}
    >
      {Array.from({ length: maxLives }, (_, index) => {
        const active = index < remainingLives;
        return (
          <svg
            key={index}
            viewBox="0 0 24 24"
            aria-hidden="true"
            className={compact ? "h-4 w-4" : "h-6 w-6"}
            fill={active ? "#ef4444" : "#541f2a"}
          >
            <path d="M12 21s-7.2-4.35-9.55-8.36C.3 8.96 2.18 4.5 6.5 4.5c2.22 0 3.68 1.24 4.5 2.42.82-1.18 2.28-2.42 4.5-2.42 4.32 0 6.2 4.46 4.05 8.14C19.2 16.65 12 21 12 21Z" />
          </svg>
        );
      })}
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

function getSurvivorResultPillClassName(resultStatus: "pending" | "won" | "lost" | "draw") {
  if (resultStatus === "won") {
    return "app-pill-active px-3 text-[10px] text-ink";
  }
  if (resultStatus === "lost") {
    return "app-pill px-3 text-[10px] text-coral";
  }
  if (resultStatus === "draw") {
    return "app-pill px-3 text-[10px] text-gold";
  }
  return "app-pill px-3 text-[10px]";
}

function getSurvivorLifeStateLabel(alive: boolean, remainingLives: number) {
  if (!alive || remainingLives <= 0) {
    return "Eliminado";
  }
  return "Vivo";
}

function getSurvivorLifeStatePillClassName(alive: boolean, remainingLives: number) {
  if (!alive || remainingLives <= 0) {
    return "app-pill px-3 text-[10px] text-coral";
  }
  return "app-pill-active px-3 text-[10px] text-ink";
}

function getSurvivorResultSurfaceClassName(resultStatus: "pending" | "won" | "lost" | "draw") {
  if (resultStatus === "won") {
    return "border-emerald-400/35 bg-emerald-500/8";
  }
  if (resultStatus === "lost") {
    return "border-coral/35 bg-coral/8";
  }
  if (resultStatus === "draw") {
    return "border-gold/35 bg-gold/8";
  }
  return "border-white/[0.08] bg-white/[0.03]";
}

function renderTeamLogo(
  teamName: string,
  teamShortName: string,
  teamCrestUrl: string | null,
  sizeClassName = "h-14 w-14",
) {
  if (teamCrestUrl) {
    const crestScale = /cruz azul/i.test(teamName) ? 1.38 : 1;
    return (
      <span className={`relative inline-flex shrink-0 ${sizeClassName}`}>
        <img
          src={teamCrestUrl}
          alt={teamName}
          className="absolute inset-0 h-full w-full object-contain"
          style={{ transform: `scale(${crestScale})` }}
        />
      </span>
    );
  }
  return (
    <span
      className={`inline-flex ${sizeClassName} items-center justify-center text-sm font-semibold text-ink`}
    >
      {teamShortName.slice(0, 3).toUpperCase()}
    </span>
  );
}

function buildSeasonBoardFallback(season: Season): SurvivorBoard {
  return {
    ...initialBoard,
    season: {
      season_id: season.id,
      season_name: season.name,
      competition_id: season.competition_id,
      competition_name: season.competition_name,
      survivor_enabled: isSurvivorAvailableForSeason(season),
      survivor_name: season.survivor_name ?? "Survivor",
      survivor_max_lives: season.survivor_max_lives,
      registration_lock_at: season.survivor_registration_lock_at,
      registration_open: !isNaN(Date.parse(season.survivor_registration_lock_at ?? "")) ? new Date(season.survivor_registration_lock_at!).getTime() > Date.now() : true,
      total_entries: 0,
    },
  };
}

export function SurvivorPageContent() {
  const { seasonId: seasonIdParam, competitionId } = useDashboardSeasonParam();
  const [selectedSeason, setSelectedSeason] = useState<Season | null>(null);
  const [board, setBoard] = useState<SurvivorBoard>(initialBoard);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [journeyScroll, setJourneyScroll] = useState(0);
  const leaderboardScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function load() {
      try {
        const accessToken = await getBrowserAccessToken();
        const seasonsResponse = await backendFetch<Season[]>("/seasons", accessToken, { cacheTtlMs: CATALOG_CACHE_TTL_MS });
        const seasons = Array.isArray(seasonsResponse) ? seasonsResponse : [];
        const resolvedSeason = resolveSurvivorSeason(seasons, seasonIdParam, competitionId);
        if (!resolvedSeason) {
          setSelectedSeason(null);
          setBoard(initialBoard);
          setError("No hay temporadas disponibles");
          return;
        }
        setSelectedSeason(resolvedSeason);
        if (!isSurvivorAvailableForSeason(resolvedSeason)) {
          setBoard({
            ...buildSeasonBoardFallback(resolvedSeason),
            season: {
              ...buildSeasonBoardFallback(resolvedSeason).season,
              survivor_enabled: false,
              registration_open: false,
            },
          });
          setError(null);
          return;
        }
        setBoard(buildSeasonBoardFallback(resolvedSeason));
        const boardResponse = await backendFetch<SurvivorBoard>(`/survivor/board?season_id=${resolvedSeason.id}`, accessToken);
        setBoard(boardResponse);
        setError(null);
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "No se pudo cargar survivor");
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, [competitionId, seasonIdParam]);

  const canSubmitPick = useMemo(
    () => Boolean(board.my_membership?.alive && board.current_matchday && board.available_teams.length > 0),
    [board.available_teams.length, board.current_matchday, board.my_membership?.alive],
  );
  const availableMatches = useMemo(() => {
    const grouped = new Map<
      string,
      {
        matchId: string;
        kickoffAt: string;
        options: typeof board.available_teams;
        homeOption: (typeof board.available_teams)[number] | null;
        awayOption: (typeof board.available_teams)[number] | null;
      }
    >();

    for (const option of board.available_teams) {
      const existing = grouped.get(option.match_id);
      if (existing) {
        existing.options.push(option);
        if (option.is_home_team) {
          existing.homeOption = option;
        } else {
          existing.awayOption = option;
        }
        continue;
      }
      grouped.set(option.match_id, {
        matchId: option.match_id,
        kickoffAt: option.kickoff_at,
        options: [option],
        homeOption: option.is_home_team ? option : null,
        awayOption: option.is_home_team ? null : option,
      });
    }

    return Array.from(grouped.values())
      .map((entry) => ({
        ...entry,
        options: entry.options.slice(),
      }))
      .sort((left, right) => new Date(left.kickoffAt).getTime() - new Date(right.kickoffAt).getTime());
  }, [board.available_teams]);
  const survivorJourneySlots = useMemo(() => {
    const picksByMatchdayNumber = new Map(board.my_picks.map((pick) => [pick.matchday_number, pick]));
    return Array.from({ length: 17 }, (_, index) => ({
      matchdayNumber: index + 1,
      pick: picksByMatchdayNumber.get(index + 1) ?? null,
      isCurrent: board.current_matchday?.number === index + 1,
    }));
  }, [board.current_matchday?.number, board.my_picks]);

  async function handleJoin() {
    if (!selectedSeason) {
      return;
    }
    setSubmitting("join");
    try {
      const accessToken = await getBrowserAccessToken();
      const response = await backendFetch<SurvivorBoard>(`/survivor/seasons/${selectedSeason.id}/join`, accessToken, {
        method: "POST",
      });
      setBoard(response);
      setError(null);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo completar la inscripcion");
    } finally {
      setSubmitting(null);
    }
  }

  async function handlePick(teamId: string) {
    if (!selectedSeason || !board.current_matchday) {
      return;
    }
    setSubmitting(`pick:${teamId}`);
    try {
      const accessToken = await getBrowserAccessToken();
      const response = await backendFetch<SurvivorBoard>("/survivor/picks", accessToken, {
        method: "PUT",
        body: JSON.stringify({
          season_id: selectedSeason.id,
          matchday_id: board.current_matchday.id,
          team_id: teamId,
        }),
      });
      setBoard(response);
      setError(null);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo guardar el pick");
    } finally {
      setSubmitting(null);
    }
  }

  function handleJourneySlider(value: number) {
    setJourneyScroll(value);
    const container = leaderboardScrollRef.current;
    if (!container) return;
    const maxScroll = container.scrollWidth - container.clientWidth;
    container.scrollLeft = maxScroll * (value / 100);
  }

  function syncJourneySlider() {
    const container = leaderboardScrollRef.current;
    if (!container) return;
    const maxScroll = container.scrollWidth - container.clientWidth;
    setJourneyScroll(maxScroll > 0 ? (container.scrollLeft / maxScroll) * 100 : 0);
  }

  if (loading) {
    return <p className="text-sm text-ink/60">Cargando survivor...</p>;
  }

  async function handleReload() {
    setLoading(true);
    setError(null);
    try {
      const accessToken = await getBrowserAccessToken();
      const seasonsResponse = await backendFetch<Season[]>("/seasons", accessToken, { cacheTtlMs: CATALOG_CACHE_TTL_MS });
      const seasons = Array.isArray(seasonsResponse) ? seasonsResponse : [];
      const resolvedSeason = resolveSurvivorSeason(seasons, seasonIdParam, competitionId);
      if (!resolvedSeason) {
        setSelectedSeason(null);
        setBoard(initialBoard);
        setError("No hay temporadas disponibles");
        return;
      }
      setSelectedSeason(resolvedSeason);
      setBoard(buildSeasonBoardFallback(resolvedSeason));
      if (!isSurvivorAvailableForSeason(resolvedSeason)) {
        setError(null);
        return;
      }
      const boardResponse = await backendFetch<SurvivorBoard>(`/survivor/board?season_id=${resolvedSeason.id}`, accessToken);
      setBoard(boardResponse);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo recargar survivor");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      {error && !selectedSeason ? (
        <section className="rounded-[18px] border border-coral/20 bg-coral/10 px-4 py-4">
          <p className="text-sm text-coral">No se pudo cargar Survivor en este momento.</p>
          <button type="button" onClick={() => void handleReload()} className="secondary-button mt-4">
            Reintentar
          </button>
        </section>
      ) : null}

      <section>
        <header className="page-header">
          <h1 className="page-title">
            {board.season.survivor_name || selectedSeason?.survivor_name || "Survivor"}
          </h1>
          <div className="max-w-md">
            <p className="text-xs text-steel">Torneo</p>
            <p className="mt-1 border-b border-white/[0.12] pb-2 text-sm font-medium text-ink">
              {board.season.season_name || selectedSeason?.name || board.season.competition_name || "Liga MX"}
            </p>
          </div>
        </header>
        <div className="mt-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            {renderLives(board.my_membership?.remaining_lives ?? board.season.survivor_max_lives, board.season.survivor_max_lives)}
          </div>

          <div className="flex flex-wrap gap-3">
            <div className="text-sm font-semibold text-ink">
              {board.leaderboard.filter((entry) => entry.alive && entry.remaining_lives > 0).length}
              <span className="font-normal text-steel"> de {board.season.total_entries} vivos</span>
            </div>
            {board.current_matchday ? (
              <div className="app-pill px-4 text-sm">
                {board.current_matchday.name}
              </div>
            ) : null}
          </div>
        </div>

        {!isSurvivorAvailableForSeason(selectedSeason) ? (
          <p className="mt-5 text-sm text-steel">Survivor todavia no esta habilitado en esta temporada.</p>
        ) : null}

        {isSurvivorAvailableForSeason(selectedSeason) && !board.my_membership ? (
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void handleJoin()}
              disabled={submitting === "join" || !board.season.registration_open}
              className="primary-button disabled:opacity-60"
            >
              {submitting === "join" ? "Inscribiendo..." : "Inscribirme al Survivor"}
            </button>
            <p className="text-sm text-steel">
              {board.season.registration_open
                ? "Tu registro queda activo para la temporada elegida."
                : "La ventana de inscripcion ya cerro para este survivor."}
            </p>
          </div>
        ) : null}

        {error && selectedSeason ? (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <p className="text-sm text-coral">{error}</p>
            <button type="button" onClick={() => void handleReload()} className="secondary-button">
              Reintentar
            </button>
          </div>
        ) : null}
      </section>

      <section className="surface-card overflow-hidden px-5 py-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-ink">Participantes por jornada</h2>
          </div>
          <div className="flex flex-wrap gap-3 text-[10px] uppercase tracking-wide text-steel">
            <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-emerald-400" /> Ganó</span>
            <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-coral" /> Perdió</span>
            <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-gold" /> Empate</span>
          </div>
        </div>
        {board.leaderboard.length > 0 ? (
          <div className="mt-5 flex items-center gap-3 text-xs font-semibold text-steel">
            <span>J1</span>
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value={journeyScroll}
              onChange={(event) => handleJourneySlider(Number(event.target.value))}
              aria-label="Navegar entre jornadas"
              className="h-1.5 min-w-0 flex-1 cursor-ew-resize accent-[#4f7df3]"
            />
            <span>J17</span>
          </div>
        ) : null}
        <div
          ref={leaderboardScrollRef}
          onScroll={syncJourneySlider}
          className="no-scrollbar mt-3 overflow-x-auto scroll-smooth touch-pan-x"
        >
          {board.leaderboard.length === 0 ? <p className="text-sm text-steel">Aún no hay participantes inscritos.</p> : (
            <table className="min-w-[1240px] border-separate border-spacing-0 text-center text-[11px]">
              <thead><tr className="text-[10px] uppercase tracking-wider text-steel">
                <th className="sticky left-0 z-20 min-w-[250px] border-b border-white/10 bg-[#0c1727] px-3 py-3 text-left">Participante</th>
                {Array.from({ length: 17 }, (_, index) => <th key={index} className={`w-[58px] border-b border-white/10 px-1 py-3 ${board.current_matchday?.number === index + 1 ? "text-coral" : ""}`}>J{index + 1}</th>)}
              </tr></thead>
              <tbody>{board.leaderboard.map((entry, index) => {
                const picksByJourney = new Map((entry.picks ?? []).map((pick) => [pick.matchday_number, pick]));
                return <tr key={entry.profile_id} className="group">
                  <td className="sticky left-0 z-10 border-b border-white/[0.07] bg-[#0c1727] px-3 py-3 text-left group-hover:bg-[#101d30]">
                    <div className="grid grid-cols-[minmax(0,1fr)_44px_52px] items-center gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-ink">{index + 1}. {entry.display_name}</p>
                        <p className="mt-0.5 text-[10px] text-steel">{entry.total_picks} picks</p>
                      </div>
                      <span className="justify-self-start">{renderLives(entry.remaining_lives, board.season.survivor_max_lives, true)}</span>
                      <span className={`justify-self-start text-[10px] font-semibold ${entry.alive && entry.remaining_lives > 0 ? "text-ink" : "text-coral"}`}>
                        {getSurvivorLifeStateLabel(entry.alive, entry.remaining_lives)}
                      </span>
                    </div>
                  </td>
                  {Array.from({ length: 17 }, (_, journeyIndex) => {
                    const pick = picksByJourney.get(journeyIndex + 1);
                    const visiblePick = pick && (pick.is_revealed || board.my_picks.some((myPick) => myPick.id === pick.id)) ? pick : null;
                    const stateClass = visiblePick?.result_status === "won" ? "drop-shadow-[0_0_5px_rgba(52,211,153,0.75)]" : visiblePick?.result_status === "lost" ? "drop-shadow-[0_0_5px_rgba(255,107,107,0.7)]" : visiblePick?.result_status === "draw" ? "drop-shadow-[0_0_5px_rgba(255,228,92,0.7)]" : "";
                    return <td key={journeyIndex} className={`border-b border-white/[0.07] px-1 py-2 ${board.current_matchday?.number === journeyIndex + 1 ? "bg-coral/[0.035]" : ""}`}>
                      {visiblePick ? <span className="relative inline-flex" title={`J${journeyIndex + 1}: ${visiblePick.team_name} · ${getSurvivorResultLabel(visiblePick.result_status)}`}>
                        {renderTeamLogo(visiblePick.team_name, visiblePick.team_short_name, visiblePick.team_crest_url, `h-9 w-9 ${stateClass}`)}
                        {visiblePick.is_admin_override ? <i className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border border-[#0c1727] bg-violet-400" title="Override administrativo" /> : null}
                      </span> : <span className="inline-flex h-9 w-9 rounded-full border border-white/[0.07] bg-black/55" title={pick ? "Pick oculto hasta el cierre" : `J${journeyIndex + 1}: pendiente`} />}
                    </td>;
                  })}
                </tr>;
              })}</tbody>
            </table>
          )}
        </div>
      </section>

      {board.my_membership ? (
        <section className="surface-card px-5 py-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.22em] text-steel">Pick semanal</p>
              <h2 className="mt-2 text-lg font-semibold text-ink">
                {board.current_matchday?.name ?? "Sin jornada activa"}
              </h2>
            </div>

            <div className="flex flex-wrap gap-2 text-xs">
              {board.my_membership.current_pick ? (
                <span className="app-pill-success px-3 text-[10px]">
                  Pick actual: {board.my_membership.current_pick.team_short_name}
                </span>
              ) : null}
              {renderLives(board.my_membership.remaining_lives, board.my_membership.max_lives)}
              <span className="app-pill px-3 text-[10px]">
                Usados: {board.my_membership.used_team_names.length}
              </span>
              {board.season.registration_lock_at ? (
                <span className="app-pill px-3 text-[10px]">
                  Cierre: {formatMexicoCityDateTime(board.season.registration_lock_at)}
                </span>
              ) : null}
            </div>
          </div>

          {!board.current_matchday ? (
            <p className="mt-4 text-sm text-steel">Aun no hay jornada lista para capturar survivor.</p>
          ) : null}

          {board.current_matchday && !canSubmitPick ? (
            <p className="mt-4 text-sm text-steel">
              {board.my_membership.alive
                ? "No hay equipos disponibles para esta jornada o todos los partidos ya cerraron."
                : "Te quedaste sin vidas en esta temporada."}
            </p>
          ) : null}

          {canSubmitPick ? (
            <div className="mt-5 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.22em] text-steel">Pick Center Survivor</p>
                </div>
                <div className="app-pill px-3 text-[10px]">
                  Jornada {board.current_matchday?.number ?? "-"}
                </div>
              </div>

              <div className="hidden grid-cols-[1.5fr_1fr_1fr_.7fr] gap-2 border-b border-white/10 pb-2 text-[10px] uppercase tracking-[0.14em] text-steel/80 md:grid">
                <p>Partido</p><p className="text-center">Inicio</p><p className="text-center">Cierre</p><p className="text-center">Estado</p>
              </div>
              <div className="space-y-2 md:space-y-0">
                {availableMatches.map((match) => {
                  const home = match.homeOption ? {
                    name: match.homeOption.team_name, shortName: match.homeOption.team_short_name,
                    crestUrl: match.homeOption.team_crest_url, option: match.homeOption,
                  } : match.awayOption ? {
                    name: match.awayOption.opponent_team_name, shortName: match.awayOption.opponent_team_short_name,
                    crestUrl: match.awayOption.opponent_team_crest_url, option: null,
                  } : null;
                  const away = match.awayOption ? {
                    name: match.awayOption.team_name, shortName: match.awayOption.team_short_name,
                    crestUrl: match.awayOption.team_crest_url, option: match.awayOption,
                  } : match.homeOption ? {
                    name: match.homeOption.opponent_team_name, shortName: match.homeOption.opponent_team_short_name,
                    crestUrl: match.homeOption.opponent_team_crest_url, option: null,
                  } : null;
                  const selected = match.options.find((option) => option.is_current_pick) ?? null;
                  const teamButton = (team: typeof home, side: "local" | "visitante") => team ? (
                    <button type="button" onClick={() => team.option && void handlePick(team.option.team_id)}
                      disabled={!team.option || team.option.is_locked || Boolean(submitting)} aria-pressed={Boolean(team.option?.is_current_pick)}
                      aria-label={`Seleccionar ${team.name}`} title={!team.option ? `${team.name} ya fue utilizado` : `Seleccionar ${team.name}`}
                      className={`relative mx-auto flex min-w-0 max-w-[74px] flex-col items-center justify-start gap-1 self-start px-2 py-1 text-center transition disabled:cursor-default ${team.option?.is_current_pick ? "text-mint" : team.option ? "hover:scale-105" : "opacity-35"}`}>
                      {renderTeamLogo(team.name, team.shortName, team.crestUrl, `${team.option?.is_current_pick ? "h-9 w-9 drop-shadow-[0_0_8px_rgba(74,222,128,0.45)]" : "h-8 w-8"}`)}
                      <span className={`min-h-[20px] max-w-[58px] text-[8px] leading-tight ${team.option?.is_current_pick ? "text-mint" : "text-steel"}`}>{team.shortName}</span>
                      <span className="sr-only">{side}</span>
                    </button>
                  ) : null;
                  return <div key={match.matchId} className="border-b border-white/5 py-2 last:border-b-0">
                    <div className="grid grid-cols-[1.5fr_1fr_.7fr] items-center gap-2 md:grid-cols-[1.5fr_1fr_1fr_.7fr]">
                      <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-1">
                        {teamButton(home, "local")}<span className="self-start pt-2 text-[9px] font-semibold uppercase tracking-[.12em] text-steel/70">vs</span>{teamButton(away, "visitante")}
                      </div>
                      <div className="text-center"><p className="text-[6px] uppercase text-steel/80 md:hidden">Inicio</p><p className="mt-1 text-[9px] text-ink md:mt-0">{formatMexicoCityDateTime(match.kickoffAt)}</p></div>
                      <div className="hidden text-center md:block"><p className="text-[9px] text-ink">{board.current_matchday ? formatMexicoCityDateTime(board.current_matchday.ends_at) : "-"}</p></div>
                      <div className="text-center">{selected ? <span className="text-[10px] font-semibold text-[#3ff28a]">{submitting ? "Guardando" : <><span className="sm:hidden">G</span><span className="hidden sm:inline">Guardado</span></>}</span> : <span className="text-[10px] text-steel">Elegir</span>}</div>
                    </div>
                  </div>;
                })}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {board.my_membership ? (
        <section className="hidden surface-card px-5 py-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.22em] text-steel">Ruta survivor</p>
              <h2 className="mt-2 text-lg font-semibold text-ink">Tus jornadas</h2>
              <p className="mt-1 text-sm text-steel">Una lista simple por jornada con el equipo usado y su resultado.</p>
            </div>
            {board.current_matchday ? (
              <div className="rounded-[18px] border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-right">
                <p className="text-[10px] uppercase tracking-[0.22em] text-steel">Jornada de la semana</p>
                <p className="mt-1 font-semibold text-ink">
                  {board.current_matchday.name}
                </p>
                <p className="text-xs text-steel">
                  {formatMexicoCityDateTime(board.current_matchday.starts_at)} a {formatMexicoCityDateTime(board.current_matchday.ends_at)}
                </p>
              </div>
            ) : null}
          </div>

          <div className="mt-5 space-y-3">
            {survivorJourneySlots.map((slot) => (
              <article
                key={slot.matchdayNumber}
                className={`rounded-[18px] border px-4 py-4 ${
                  slot.pick ? getSurvivorResultSurfaceClassName(slot.pick.result_status) : "border-white/[0.08] bg-white/[0.02]"
                } ${slot.isCurrent ? "ring-1 ring-coral/40" : ""}`}
              >
                <div className="grid gap-3 md:grid-cols-[84px_minmax(0,1fr)_auto] md:items-center">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.22em] text-steel">Jornada</p>
                    <p className="mt-1 text-lg font-semibold text-ink">J{slot.matchdayNumber}</p>
                  </div>

                  {slot.pick ? (
                    <div className="flex items-center gap-3">
                      {slot.pick.team_crest_url ? (
                        <img
                          src={slot.pick.team_crest_url}
                          alt={slot.pick.team_name}
                          className="h-12 w-12 rounded-full border border-white/10 bg-white object-cover"
                        />
                      ) : (
                        <span className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-[11px] font-semibold text-ink">
                          {slot.pick.team_short_name.slice(0, 3).toUpperCase()}
                        </span>
                      )}
                      <div>
                        <p className="font-semibold text-ink">{slot.pick.team_name}</p>
                        <p className="text-sm text-steel">
                          {slot.pick.team_short_name} vs {slot.pick.opponent_team_short_name}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <p className="font-medium text-ink/70">{slot.isCurrent ? "Semana actual" : "Sin pick"}</p>
                      <p className="text-sm text-steel">
                        {slot.isCurrent ? "Aun no capturas equipo para esta jornada." : "Todavia no hay equipo registrado aqui."}
                      </p>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-2 md:justify-end">
                    {slot.pick ? (
                      <>
                        <span className={getSurvivorResultPillClassName(slot.pick.result_status)}>
                          {getSurvivorResultLabel(slot.pick.result_status)}
                        </span>
                        <span className={slot.pick.consumed_life ? "app-pill px-3 text-[10px] text-coral" : "app-pill px-3 text-[10px]"}>
                          {slot.pick.consumed_life ? "Vida -" : "OK"}
                        </span>
                      </>
                    ) : (
                      <span className="app-pill px-3 text-[10px]">{slot.isCurrent ? "Activa" : "Pendiente"}</span>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className="hidden surface-card px-5 py-5">
        <p className="text-xs uppercase tracking-[0.22em] text-steel">Tablero survivor</p>
        <div className="mt-4 no-scrollbar overflow-x-auto touch-pan-x">
          {board.leaderboard.length === 0 ? (
            <p className="text-sm text-steel">Aun no hay participantes inscritos.</p>
          ) : (
            <table className="min-w-[860px] table-fixed text-left text-[11px] text-steel">
              <colgroup>
                <col className="w-[220px]" />
                <col className="w-[170px]" />
                <col className="w-[150px]" />
                <col className="w-[140px]" />
                <col className="w-[90px]" />
                <col className="w-[120px]" />
              </colgroup>
              <thead className="app-table-head">
                <tr>
                  <th className="px-3 py-2 text-left">Participante</th>
                  <th className="px-3 py-2 text-left">Equipo</th>
                  <th className="px-3 py-2 text-left">Rival</th>
                  <th className="px-3 py-2 text-left">Resultado</th>
                  <th className="px-3 py-2 text-left">Vidas</th>
                  <th className="px-3 py-2 text-left">Estado</th>
                </tr>
              </thead>
              <tbody>
                {board.leaderboard.map((entry, index) => (
                  <tr key={entry.profile_id} className="app-table-row border-b last:border-b-0">
                    <td className="px-3 py-3">
                      <div className="space-y-1">
                        <p className="font-semibold text-ink">{index + 1}. {entry.display_name}</p>
                        <p className="text-[10px] text-steel">{entry.total_picks} picks capturados</p>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      {entry.current_pick && entry.current_pick.is_revealed ? (
                        <div className="flex items-center gap-2">
                          {entry.current_pick.team_crest_url ? (
                            <img
                              src={entry.current_pick.team_crest_url}
                              alt={entry.current_pick.team_name}
                              className="h-7 w-7 rounded-full border border-white/10 object-cover"
                            />
                          ) : (
                            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-[9px] font-semibold text-ink">
                              {entry.current_pick.team_short_name.slice(0, 3).toUpperCase()}
                            </span>
                          )}
                          <div>
                            <p className="font-semibold text-ink">{entry.current_pick.team_short_name}</p>
                            <p className="text-[10px] text-steel">{entry.current_pick.team_name}</p>
                          </div>
                        </div>
                      ) : entry.current_pick ? (
                        <span className="text-[10px] font-semibold uppercase text-steel/65">Oculto</span>
                      ) : (
                        <span className="text-[10px] font-semibold uppercase text-steel/65">
                          {entry.last_pick_team_name ?? "Sin pick"}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      {entry.current_pick && entry.current_pick.is_revealed ? (
                        <div>
                          <p className="font-medium text-ink">{entry.current_pick.opponent_team_short_name}</p>
                          <p className="text-[10px] text-steel">{entry.current_pick.opponent_team_name}</p>
                        </div>
                      ) : (
                        <span className="text-[10px] font-semibold uppercase text-steel/65">
                          {entry.current_pick ? "Oculto" : "Pendiente"}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      {entry.current_pick && entry.current_pick.is_revealed ? (
                        <span className={getSurvivorResultPillClassName(entry.current_pick.result_status)}>
                          {getSurvivorResultLabel(entry.current_pick.result_status)}
                        </span>
                      ) : entry.current_pick ? (
                        <span className="app-pill px-3 text-[10px]">Oculto</span>
                      ) : (
                        <span className="app-pill px-3 text-[10px]">Sin pick</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <span className="font-semibold text-ink">{entry.remaining_lives}</span>
                    </td>
                    <td className="px-3 py-3">
                      <span className={getSurvivorLifeStatePillClassName(entry.alive, entry.remaining_lives)}>
                        {getSurvivorLifeStateLabel(entry.alive, entry.remaining_lives)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section className="hidden surface-card px-5 py-5">
        <p className="text-xs uppercase tracking-[0.22em] text-steel">Historial</p>
        <div className="mt-4 no-scrollbar overflow-x-auto touch-pan-x">
          {board.my_picks.length === 0 ? (
            <p className="text-sm text-steel">Todavia no capturas picks en survivor.</p>
          ) : (
            <table className="min-w-[720px] table-fixed text-left text-[11px] text-steel">
              <colgroup>
                <col className="w-[160px]" />
                <col className="w-[180px]" />
                <col className="w-[170px]" />
                <col className="w-[120px]" />
                <col className="w-[90px]" />
              </colgroup>
              <thead className="app-table-head">
                <tr>
                  <th className="px-3 py-2 text-left">Jornada</th>
                  <th className="px-3 py-2 text-left">Equipo</th>
                  <th className="px-3 py-2 text-left">Rival</th>
                  <th className="px-3 py-2 text-left">Resultado</th>
                  <th className="px-3 py-2 text-left">Vida</th>
                </tr>
              </thead>
              <tbody>
                {board.my_picks.map((pick) => (
                  <tr key={pick.id} className="app-table-row border-b last:border-b-0">
                    <td className="px-3 py-3">
                      <p className="font-medium text-ink">{pick.matchday_name}</p>
                    </td>
                    <td className="px-3 py-3">
                      <p className="font-semibold text-ink">{pick.team_short_name}</p>
                      <p className="text-[10px] text-steel">{pick.team_name}</p>
                    </td>
                    <td className="px-3 py-3">
                      <p className="font-medium text-ink">{pick.opponent_team_short_name}</p>
                      <p className="text-[10px] text-steel">{pick.opponent_team_name}</p>
                    </td>
                    <td className="px-3 py-3">
                      <span className={getSurvivorResultPillClassName(pick.result_status)}>
                        {getSurvivorResultLabel(pick.result_status)}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <span className={pick.consumed_life ? "app-pill px-3 text-[10px] text-coral" : "app-pill px-3 text-[10px]"}>
                        {pick.consumed_life ? "Gastada" : "OK"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
