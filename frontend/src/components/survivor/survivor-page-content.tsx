"use client";

import { useEffect, useMemo, useState } from "react";

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

function formatLivesLabel(remainingLives: number, maxLives: number) {
  return `${remainingLives}/${maxLives} vidas`;
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
    return (
      <img
        src={teamCrestUrl}
        alt={teamName}
        className={`${sizeClassName} rounded-full border border-white/10 bg-white object-cover`}
      />
    );
  }
  return (
    <span
      className={`inline-flex ${sizeClassName} items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-sm font-semibold text-ink`}
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

  useEffect(() => {
    async function load() {
      try {
        const seasonsResponse = await backendFetch<Season[]>("/seasons", undefined, { cacheTtlMs: CATALOG_CACHE_TTL_MS });
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
        const accessToken = await getBrowserAccessToken();
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
      }
    >();

    for (const option of board.available_teams) {
      const existing = grouped.get(option.match_id);
      if (existing) {
        existing.options.push(option);
        continue;
      }
      grouped.set(option.match_id, {
        matchId: option.match_id,
        kickoffAt: option.kickoff_at,
        options: [option],
      });
    }

    return Array.from(grouped.values())
      .map((entry) => ({
        ...entry,
        options: entry.options.slice().sort((left, right) => left.team_short_name.localeCompare(right.team_short_name, "es-MX")),
      }))
      .sort((left, right) => new Date(left.kickoffAt).getTime() - new Date(right.kickoffAt).getTime());
  }, [board.available_teams]);
  const availableLogoTeams = useMemo(
    () =>
      board.available_teams
        .slice()
        .sort((left, right) => left.team_short_name.localeCompare(right.team_short_name, "es-MX")),
    [board.available_teams],
  );
  const survivorJourneySlots = useMemo(() => {
    const maxKnownMatchday = Math.max(
      17,
      board.current_matchday?.number ?? 0,
      ...board.my_picks.map((pick) => pick.matchday_number),
    );
    const picksByMatchdayNumber = new Map(board.my_picks.map((pick) => [pick.matchday_number, pick]));
    return Array.from({ length: maxKnownMatchday }, (_, index) => {
      const matchdayNumber = index + 1;
      return {
        matchdayNumber,
        pick: picksByMatchdayNumber.get(matchdayNumber) ?? null,
        isCurrent: board.current_matchday?.number === matchdayNumber,
      };
    });
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

  if (loading) {
    return <p className="text-sm text-ink/60">Cargando survivor...</p>;
  }

  async function handleReload() {
    setLoading(true);
    setError(null);
    try {
      const seasonsResponse = await backendFetch<Season[]>("/seasons", undefined, { cacheTtlMs: CATALOG_CACHE_TTL_MS });
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
      const accessToken = await getBrowserAccessToken();
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

      <section className="surface-card-strong overflow-hidden px-6 py-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.26em] text-steel">
              {board.season.competition_name ?? selectedSeason?.competition_name ?? "Liga MX"}
            </p>
            <h1 className="mt-2 text-3xl font-semibold text-ink">
              {board.season.survivor_name || selectedSeason?.survivor_name || "Survivor"}
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-steel">
              Escoge un equipo por jornada. No puedes repetirlo durante la temporada y solo pierdes vida cuando ese equipo cae.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <div className="app-pill-active px-4 text-sm text-ink">
              {formatLivesLabel(
                board.my_membership?.remaining_lives ?? board.season.survivor_max_lives,
                board.season.survivor_max_lives,
              )}
            </div>
            <div className="app-pill px-4 text-sm">
              {board.season.total_entries} participantes
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
                <span className="app-pill-active px-3 text-[10px] text-ink">
                  Pick actual: {board.my_membership.current_pick.team_short_name}
                </span>
              ) : null}
              <span className="app-pill px-3 text-[10px]">
                Vidas: {board.my_membership.remaining_lives}/{board.my_membership.max_lives}
              </span>
              <span className="app-pill px-3 text-[10px]">
                Gastadas: {board.my_membership.lives_spent}
              </span>
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
                  <p className="text-xs uppercase tracking-[0.22em] text-steel">Equipos disponibles</p>
                  <p className="mt-1 text-sm text-steel">Selecciona tu equipo desde la parrilla de logos.</p>
                </div>
                <div className="app-pill px-3 text-[10px]">
                  Jornada {board.current_matchday?.number ?? "-"}
                </div>
              </div>

              <div className="grid grid-cols-4 gap-x-4 gap-y-5 md:grid-cols-6 xl:grid-cols-9">
                {availableLogoTeams.map((option) => (
                  <button
                    key={`${option.match_id}:${option.team_id}`}
                    type="button"
                    onClick={() => void handlePick(option.team_id)}
                    disabled={option.is_locked || Boolean(submitting)}
                    title={option.team_name}
                    aria-label={option.team_name}
                    className={`flex flex-col items-center justify-center gap-2 rounded-[999px] bg-transparent p-0 text-center transition disabled:opacity-60 ${
                      option.is_locked ? "opacity-55" : ""
                    }`}
                  >
                    <span
                      className={`inline-flex rounded-full p-[4px] ${
                        option.is_current_pick
                          ? "ring-2 ring-emerald-400/55 ring-offset-2 ring-offset-transparent"
                          : option.is_locked
                            ? "ring-1 ring-white/8"
                            : "ring-1 ring-transparent"
                      }`}
                    >
                      {renderTeamLogo(option.team_name, option.team_short_name, option.team_crest_url, "h-14 w-14")}
                    </span>
                    <span className="text-[11px] font-semibold text-steel">
                      {option.team_short_name}
                    </span>
                  </button>
                ))}
              </div>

              <div className="rounded-[20px] border border-white/[0.08] bg-white/[0.03]">
                <div className="flex items-center justify-between gap-3 border-b border-white/[0.08] px-4 py-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.22em] text-steel">Jornada</p>
                    <p className="mt-1 text-sm font-semibold text-ink">{board.current_matchday?.name ?? "Semana actual"}</p>
                  </div>
                  <p className="text-[11px] text-steel">
                    {board.current_matchday
                      ? `${formatMexicoCityDateTime(board.current_matchday.starts_at)} a ${formatMexicoCityDateTime(board.current_matchday.ends_at)}`
                      : ""}
                  </p>
                </div>

                <div className="divide-y divide-white/[0.08]">
                  {availableMatches.map((match) => (
                    <div key={match.matchId} className="px-4 py-3">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                          <p className="text-sm font-medium text-ink">
                            {match.options.map((option) => option.team_short_name).join(" vs ")}
                          </p>
                          <p className="text-[11px] text-steel">{formatMexicoCityDateTime(match.kickoffAt)}</p>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          {match.options.map((option) => (
                            <button
                              key={option.team_id}
                              type="button"
                              onClick={() => void handlePick(option.team_id)}
                              disabled={option.is_locked || Boolean(submitting)}
                              title={option.team_name}
                              aria-label={option.team_name}
                              className={`rounded-full p-[4px] transition disabled:opacity-60 ${
                                option.is_current_pick
                                  ? "ring-2 ring-emerald-400/55 ring-offset-2 ring-offset-transparent"
                                  : "ring-1 ring-white/10"
                              }`}
                            >
                              {renderTeamLogo(option.team_name, option.team_short_name, option.team_crest_url, "h-10 w-10")}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {board.my_membership ? (
        <section className="surface-card px-5 py-5">
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

      <section className="surface-card px-5 py-5">
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

      <section className="surface-card px-5 py-5">
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
