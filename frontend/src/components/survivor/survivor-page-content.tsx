"use client";

import { useEffect, useMemo, useState } from "react";

import { backendFetch, CATALOG_CACHE_TTL_MS } from "@/lib/api/backend";
import { resolveSeasonForContext, useDashboardSeasonParam } from "@/lib/dashboard-season";
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

function buildSeasonBoardFallback(season: Season): SurvivorBoard {
  return {
    ...initialBoard,
    season: {
      season_id: season.id,
      season_name: season.name,
      competition_id: season.competition_id,
      competition_name: season.competition_name,
      survivor_enabled: season.survivor_enabled,
      survivor_name: season.survivor_name ?? "Survivor",
      survivor_max_lives: season.survivor_max_lives,
      registration_lock_at: season.survivor_registration_lock_at,
      registration_open: !isNaN(Date.parse(season.survivor_registration_lock_at ?? "")) ? new Date(season.survivor_registration_lock_at!).getTime() > Date.now() : true,
      total_entries: 0,
    },
  };
}

export function SurvivorPageContent() {
  const { seasonId: seasonIdParam, competitionId, setSeasonId } = useDashboardSeasonParam();
  const [selectedSeason, setSelectedSeason] = useState<Season | null>(null);
  const [board, setBoard] = useState<SurvivorBoard>(initialBoard);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const seasons = await backendFetch<Season[]>("/seasons", undefined, { cacheTtlMs: CATALOG_CACHE_TTL_MS });
        const resolvedSeason = resolveSeasonForContext(seasons, seasonIdParam, competitionId);
        if (!resolvedSeason) {
          setSelectedSeason(null);
          setBoard(initialBoard);
          setError("No hay temporadas disponibles");
          return;
        }
        setSelectedSeason(resolvedSeason);
        if (resolvedSeason.id !== seasonIdParam || (resolvedSeason.competition_id ?? "") !== competitionId) {
          setSeasonId(resolvedSeason.id, resolvedSeason.competition_id ?? "");
        }
        if (!resolvedSeason.survivor_enabled) {
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
  }, [competitionId, seasonIdParam, setSeasonId]);

  const canSubmitPick = useMemo(
    () => Boolean(board.my_membership?.alive && board.current_matchday && board.available_teams.length > 0),
    [board.available_teams.length, board.current_matchday, board.my_membership?.alive],
  );

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
      const seasons = await backendFetch<Season[]>("/seasons", undefined, { cacheTtlMs: CATALOG_CACHE_TTL_MS });
      const resolvedSeason = resolveSeasonForContext(seasons, seasonIdParam, competitionId);
      if (!resolvedSeason) {
        setSelectedSeason(null);
        setBoard(initialBoard);
        setError("No hay temporadas disponibles");
        return;
      }
      setSelectedSeason(resolvedSeason);
      setBoard(buildSeasonBoardFallback(resolvedSeason));
      if (!resolvedSeason.survivor_enabled) {
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

        {!selectedSeason?.survivor_enabled ? (
          <p className="mt-5 text-sm text-steel">Survivor todavia no esta habilitado en esta temporada.</p>
        ) : null}

        {selectedSeason?.survivor_enabled && !board.my_membership ? (
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
        <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="surface-card px-5 py-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.22em] text-steel">Pick semanal</p>
                <h2 className="mt-2 text-lg font-semibold text-ink">
                  {board.current_matchday?.name ?? "Sin jornada activa"}
                </h2>
              </div>
              {board.my_membership.current_pick ? (
                <span className="app-pill-active px-4 text-sm text-ink">
                  Pick actual: {board.my_membership.current_pick.team_short_name}
                </span>
              ) : null}
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
              <div className="mt-5 grid gap-3 md:grid-cols-2">
                {board.available_teams.map((option) => (
                  <button
                    key={`${option.match_id}:${option.team_id}`}
                    type="button"
                    onClick={() => void handlePick(option.team_id)}
                    disabled={option.is_locked || Boolean(submitting)}
                    className={option.is_current_pick ? "surface-card-strong text-left disabled:opacity-60" : "surface-card text-left disabled:opacity-60"}
                  >
                    <p className="text-xs uppercase tracking-[0.2em] text-steel">
                      {option.team_short_name} vs {option.opponent_team_short_name}
                    </p>
                    <p className="mt-2 text-lg font-semibold text-ink">{option.team_name}</p>
                    <p className="mt-2 text-sm text-steel">{formatMexicoCityDateTime(option.kickoff_at)}</p>
                    <p className="mt-3 text-xs text-steel">
                      {option.is_current_pick
                        ? "Tu pick actual"
                        : option.is_locked
                          ? "Cerrado"
                          : submitting === `pick:${option.team_id}`
                            ? "Guardando..."
                            : "Elegir equipo"}
                    </p>
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="surface-card px-5 py-5">
            <p className="text-xs uppercase tracking-[0.22em] text-steel">Estado</p>
            <div className="mt-4 space-y-3 text-sm text-steel">
              <p>Vidas restantes: <span className="font-semibold text-ink">{board.my_membership.remaining_lives}</span></p>
              <p>Vidas gastadas: <span className="font-semibold text-ink">{board.my_membership.lives_spent}</span></p>
              <p>Equipos usados: <span className="font-semibold text-ink">{board.my_membership.used_team_names.join(", ") || "Ninguno"}</span></p>
              {board.season.registration_lock_at ? (
                <p>Cierre de inscripcion: <span className="font-semibold text-ink">{formatMexicoCityDateTime(board.season.registration_lock_at)}</span></p>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <div className="surface-card px-5 py-5">
          <p className="text-xs uppercase tracking-[0.22em] text-steel">Historial</p>
          <div className="mt-4 space-y-3">
            {board.my_picks.length === 0 ? (
              <p className="text-sm text-steel">Todavia no capturas picks en survivor.</p>
            ) : (
              board.my_picks.map((pick) => (
                <div key={pick.id} className="rounded-[18px] border border-white/6 bg-white/[0.03] px-4 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-ink">{pick.team_name}</p>
                      <p className="text-xs text-steel">{pick.matchday_name} · vs {pick.opponent_team_name}</p>
                    </div>
                    <span className="app-pill px-3 text-xs uppercase tracking-[0.18em]">
                      {pick.result_status}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="surface-card px-5 py-5">
          <p className="text-xs uppercase tracking-[0.22em] text-steel">Leaderboard</p>
          <div className="mt-4 space-y-3">
            {board.leaderboard.length === 0 ? (
              <p className="text-sm text-steel">Aun no hay participantes inscritos.</p>
            ) : (
              board.leaderboard.map((entry, index) => (
                <div key={entry.profile_id} className="flex items-center justify-between gap-3 rounded-[18px] border border-white/6 bg-white/[0.03] px-4 py-4">
                  <div>
                    <p className="text-sm font-semibold text-ink">{index + 1}. {entry.display_name}</p>
                    <p className="text-xs text-steel">{entry.last_pick_team_name ?? "Sin pick capturado"}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-ink">{entry.remaining_lives} vidas</p>
                    <p className="text-xs text-steel">{entry.total_picks} picks</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
