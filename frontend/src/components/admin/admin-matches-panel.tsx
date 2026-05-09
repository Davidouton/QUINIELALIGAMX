"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { Trash2 } from "lucide-react";

import { backendFetch } from "@/lib/api/backend";
import {
  formatMexicoCityDateTime,
  shiftMexicoCityInputValue,
  toMexicoCityInputValue,
} from "@/lib/datetime/mexico-city";
import { getBrowserAccessToken } from "@/lib/supabase/session";
import type { Match, MatchStageType, Matchday, Season, Team } from "@/types/api";

type MatchFormState = {
  matchday_id: string;
  home_team_id: string;
  away_team_id: string;
  stage_type: MatchStageType;
  group_label: string;
  bracket_slot: string;
  home_placeholder: string;
  away_placeholder: string;
  kickoff_at: string;
  picks_lock_at: string;
  venue: string;
  status: string;
  external_id: string;
};

const initialMatchForm: MatchFormState = {
  matchday_id: "",
  home_team_id: "",
  away_team_id: "",
  stage_type: "regular",
  group_label: "",
  bracket_slot: "",
  home_placeholder: "",
  away_placeholder: "",
  kickoff_at: "",
  picks_lock_at: "",
  venue: "",
  status: "scheduled",
  external_id: "",
};

function buildFormFromMatch(match: Match): MatchFormState {
  return {
    matchday_id: match.matchday_id,
    home_team_id: match.home_team_id ?? "",
    away_team_id: match.away_team_id ?? "",
    stage_type: match.stage_type,
    group_label: match.group_label ?? "",
    bracket_slot: match.bracket_slot ?? "",
    home_placeholder: match.home_placeholder ?? "",
    away_placeholder: match.away_placeholder ?? "",
    kickoff_at: toMexicoCityInputValue(match.kickoff_at),
    picks_lock_at: toMexicoCityInputValue(match.picks_lock_at),
    venue: match.venue ?? "",
    status: match.status,
    external_id: match.external_id ?? "",
  };
}

function splitLocalDateTime(value: string) {
  if (!value) {
    return { date: "", time: "" };
  }

  const [date = "", time = ""] = value.split("T");
  return { date, time: time.slice(0, 5) };
}

function joinLocalDateTime(date: string, time: string) {
  if (!date) {
    return "";
  }

  return `${date}T${time || "00:00"}`;
}

const compactTableControlClass =
  "field-control compact-table-control h-8 min-w-0 rounded-md px-2 py-1 text-[10px]";

const compactExternalIdControlClass = `${compactTableControlClass} font-mono tracking-tight`;

const compactActionButtonClass =
  "app-pill inline-flex h-7 items-center justify-center rounded-[10px] px-2 text-[10px] font-semibold disabled:opacity-60";

const stageLabels: Record<MatchStageType, string> = {
  regular: "Regular",
  group: "Grupo",
  round_of_32: "Dieciseisavos",
  round_of_16: "Octavos",
  quarterfinal: "Cuartos",
  semifinal: "Semifinal",
  third_place: "3er lugar",
  final: "Final",
};

function isKnockoutStage(stageType: MatchStageType) {
  return stageType !== "regular" && stageType !== "group";
}

export function AdminMatchesPanel() {
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [matchdays, setMatchdays] = useState<Matchday[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [selectedSeasonId, setSelectedSeasonId] = useState("");
  const [selectedMatchdayId, setSelectedMatchdayId] = useState("");
  const [bulkMatchdayId, setBulkMatchdayId] = useState("");
  const [createForm, setCreateForm] = useState<MatchFormState>(initialMatchForm);
  const [drafts, setDrafts] = useState<Record<string, MatchFormState>>({});
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [savingMatchId, setSavingMatchId] = useState<string | null>(null);
  const [deletingMatchId, setDeletingMatchId] = useState<string | null>(null);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const matchdayById = useMemo(
    () => Object.fromEntries(matchdays.map((matchday) => [matchday.id, matchday])),
    [matchdays],
  );
  const seasonById = useMemo(
    () => Object.fromEntries(seasons.map((season) => [season.id, season])),
    [seasons],
  );
  const visibleMatchdays = useMemo(
    () =>
      matchdays.filter((matchday) =>
        selectedSeasonId ? matchday.season_id === selectedSeasonId : true,
      ),
    [matchdays, selectedSeasonId],
  );
  const createFormSeasonId = matchdayById[createForm.matchday_id]?.season_id ?? selectedSeasonId;
  const createEligibleTeams = useMemo(() => {
    const competitionId = createFormSeasonId ? seasonById[createFormSeasonId]?.competition_id ?? null : null;
    if (!competitionId) {
      return teams;
    }
    return teams.filter((team) => team.competition_id === competitionId);
  }, [createFormSeasonId, seasonById, teams]);

  function getEligibleTeamsForSeasonId(seasonId: string | null | undefined) {
    const competitionId = seasonId ? seasonById[seasonId]?.competition_id ?? null : null;
    if (!competitionId) {
      return teams;
    }
    return teams.filter((team) => team.competition_id === competitionId);
  }

  async function loadMatches(matchdayId: string, accessToken?: string) {
    const path = matchdayId ? `/matches?matchday_id=${matchdayId}` : "/matches";
    const rows = await backendFetch<Match[]>(path, accessToken);
    setMatches(rows);
  }

  async function loadData() {
    const [seasonRows, teamRows, matchdayRows] = await Promise.all([
      backendFetch<Season[]>("/seasons"),
      backendFetch<Team[]>("/teams"),
      backendFetch<Matchday[]>("/matchdays"),
    ]);
    const defaultMatchdayId =
      matchdayRows.find((matchday) => matchday.status === "active")?.id || matchdayRows[0]?.id || "";
    const defaultSeasonId =
      seasonRows.find((season) => season.is_active)?.id || matchdayRows[0]?.season_id || seasonRows[0]?.id || "";

    setSeasons(seasonRows);
    setTeams(teamRows);
    setMatchdays(matchdayRows);
    setSelectedSeasonId((current) => current || defaultSeasonId);
    setBulkMatchdayId((current) => current || defaultMatchdayId);
    setCreateForm((current) => ({ ...current, matchday_id: current.matchday_id || defaultMatchdayId }));
    await loadMatches(selectedMatchdayId);
  }

  useEffect(() => {
    async function load() {
      try {
        await loadData();
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "No se pudieron cargar los partidos");
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, []);

  useEffect(() => {
    setDrafts(
      Object.fromEntries(
        matches.map((match) => {
          const baseDraft = buildFormFromMatch(match);
          return [
            match.id,
            {
              ...baseDraft,
              picks_lock_at: getAutoLockValue(baseDraft.kickoff_at, baseDraft.matchday_id),
            },
          ];
        }),
      ),
    );
  }, [matches, matchdays]);

  function getAutoLockOffsetMinutes(matchdayId: string) {
    return matchdayById[matchdayId]?.default_lock_offset_minutes ?? 10;
  }

  function getAutoLockValue(kickoffAt: string, matchdayId: string) {
    if (!kickoffAt) {
      return "";
    }

    return shiftMexicoCityInputValue(kickoffAt, -getAutoLockOffsetMinutes(matchdayId));
  }

  function updateDraft(matchId: string, patch: Partial<MatchFormState>) {
    setDrafts((current) => ({
      ...current,
      [matchId]: {
        ...(current[matchId] ?? initialMatchForm),
        ...patch,
      },
    }));
  }

  async function refreshMatches(accessToken?: string) {
    await loadMatches(selectedMatchdayId, accessToken);
  }

  async function handleCreateMatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    setError(null);
    setMessage(null);

    try {
      const accessToken = await getBrowserAccessToken();
      await backendFetch("/admin/matches", accessToken, {
        method: "POST",
        body: JSON.stringify({
          ...createForm,
          home_team_id: createForm.home_team_id || null,
          away_team_id: createForm.away_team_id || null,
          group_label: createForm.group_label || null,
          bracket_slot: createForm.bracket_slot || null,
          home_placeholder: createForm.home_placeholder || null,
          away_placeholder: createForm.away_placeholder || null,
          picks_lock_at: getAutoLockValue(createForm.kickoff_at, createForm.matchday_id) || createForm.kickoff_at,
          venue: createForm.venue || null,
          external_id: createForm.external_id || null,
        }),
      });
      await refreshMatches(accessToken);
      setCreateForm((current) => ({
        ...initialMatchForm,
        matchday_id: current.matchday_id,
      }));
      setMessage("Partido creado.");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo crear el partido");
    } finally {
      setCreating(false);
    }
  }

  async function saveMatch(matchId: string, nextDraft?: MatchFormState) {
    const draft = nextDraft ?? drafts[matchId];
    if (!draft) {
      return;
    }

    setSavingMatchId(matchId);
    setError(null);
    setMessage(null);

    try {
      const accessToken = await getBrowserAccessToken();
      await backendFetch(`/admin/matches/${matchId}`, accessToken, {
        method: "PUT",
        body: JSON.stringify({
          ...draft,
          home_team_id: draft.home_team_id || null,
          away_team_id: draft.away_team_id || null,
          group_label: draft.group_label || null,
          bracket_slot: draft.bracket_slot || null,
          home_placeholder: draft.home_placeholder || null,
          away_placeholder: draft.away_placeholder || null,
          picks_lock_at: getAutoLockValue(draft.kickoff_at, draft.matchday_id) || draft.kickoff_at,
          venue: draft.venue || null,
          external_id: draft.external_id || null,
        }),
      });
      await refreshMatches(accessToken);
      setMessage("Partido actualizado.");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo actualizar el partido");
    } finally {
      setSavingMatchId(null);
    }
  }

  async function deleteMatch(match: Match) {
    if (typeof window !== "undefined") {
      const confirmed = window.confirm(`Borrar ${match.home_team_name} vs ${match.away_team_name}?`);
      if (!confirmed) {
        return;
      }
    }

    setDeletingMatchId(match.id);
    setError(null);
    setMessage(null);

    try {
      const accessToken = await getBrowserAccessToken();
      await backendFetch(`/admin/matches/${match.id}`, accessToken, {
        method: "DELETE",
      });
      await refreshMatches(accessToken);
      setMessage("Partido borrado.");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo borrar el partido");
    } finally {
      setDeletingMatchId(null);
    }
  }

  async function handleBulkMove() {
    if (!bulkMatchdayId || matches.length === 0) {
      return;
    }

    setBulkSaving(true);
    setError(null);
    setMessage(null);

    try {
      const accessToken = await getBrowserAccessToken();
      for (const match of matches) {
        const currentDraft = drafts[match.id] ?? buildFormFromMatch(match);
        await backendFetch(`/admin/matches/${match.id}`, accessToken, {
          method: "PUT",
          body: JSON.stringify({
            ...currentDraft,
            matchday_id: bulkMatchdayId,
            home_team_id: currentDraft.home_team_id || null,
            away_team_id: currentDraft.away_team_id || null,
            group_label: currentDraft.group_label || null,
            bracket_slot: currentDraft.bracket_slot || null,
            home_placeholder: currentDraft.home_placeholder || null,
            away_placeholder: currentDraft.away_placeholder || null,
            picks_lock_at: getAutoLockValue(currentDraft.kickoff_at, bulkMatchdayId) || currentDraft.kickoff_at,
            venue: currentDraft.venue || null,
            external_id: currentDraft.external_id || null,
          }),
        });
      }
      await refreshMatches(accessToken);
      setMessage(
        `${matches.length} partido${matches.length === 1 ? "" : "s"} movido${matches.length === 1 ? "" : "s"} a ${matchdayById[bulkMatchdayId]?.name ?? "la jornada seleccionada"}.`,
      );
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudieron mover los partidos");
    } finally {
      setBulkSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-ink">Edicion rapida</h2>
            <p className="mt-2 max-w-2xl text-sm text-steel">
              Filtra la lista, ajusta jornada u horario por fila y guarda sin entrar y salir de
              cada partido.
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_1fr_auto]">
          <label className="space-y-2 text-sm">
            <span className="text-steel">Filtrar por torneo</span>
            <select
              value={selectedSeasonId}
              onChange={(event) => {
                const nextSeasonId = event.target.value;
                const nextMatchdayId =
                  matchdays.find((matchday) => matchday.season_id === nextSeasonId && matchday.id === selectedMatchdayId)?.id ||
                  "";
                const nextBulkMatchdayId =
                  matchdays.find((matchday) => matchday.season_id === nextSeasonId && matchday.id === bulkMatchdayId)?.id ||
                  matchdays.find((matchday) => matchday.season_id === nextSeasonId)?.id ||
                  "";

                setSelectedSeasonId(nextSeasonId);
                setSelectedMatchdayId(nextMatchdayId);
                setBulkMatchdayId(nextBulkMatchdayId);
                setCreateForm((current) => ({
                  ...current,
                  home_team_id: "",
                  away_team_id: "",
                  matchday_id:
                    matchdays.find((matchday) => matchday.season_id === nextSeasonId && matchday.id === current.matchday_id)?.id ||
                    matchdays.find((matchday) => matchday.season_id === nextSeasonId)?.id ||
                    "",
                }));
                setError(null);
                setMessage(null);
                void loadMatches(nextMatchdayId);
              }}
              className="field-control"
            >
              <option value="">Todas las temporadas</option>
              {seasons.map((season) => (
                <option key={season.id} value={season.id}>
                  {season.name}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-2 text-sm">
            <span className="text-steel">Filtrar lista por jornada</span>
            <select
              value={selectedMatchdayId}
              onChange={async (event) => {
                const nextMatchdayId = event.target.value;
                setSelectedMatchdayId(nextMatchdayId);
                setError(null);
                setMessage(null);
                try {
                  await loadMatches(nextMatchdayId);
                } catch (caughtError) {
                  setError(caughtError instanceof Error ? caughtError.message : "No se pudieron cargar los partidos");
                }
              }}
              className="field-control"
            >
              <option value="">Todas las jornadas</option>
              {visibleMatchdays.map((matchday) => (
                <option key={matchday.id} value={matchday.id}>
                  {(seasonById[matchday.season_id]?.name ?? "Torneo")} · {matchday.name}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-2 text-sm">
            <span className="text-steel">Mover lista visible a</span>
            <select
              value={bulkMatchdayId}
              onChange={(event) => setBulkMatchdayId(event.target.value)}
              className="field-control"
            >
              <option value="">Selecciona jornada destino</option>
              {visibleMatchdays.map((matchday) => (
                <option key={matchday.id} value={matchday.id}>
                  {(seasonById[matchday.season_id]?.name ?? "Torneo")} · {matchday.name}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            onClick={() => void handleBulkMove()}
            disabled={bulkSaving || !bulkMatchdayId || matches.length === 0}
            className="app-pill-active px-4 disabled:opacity-60"
          >
            {bulkSaving ? "Moviendo..." : "Mover visibles"}
          </button>
        </div>

        {message ? <p className="mt-4 text-sm text-moss">{message}</p> : null}
        {error ? <p className="mt-4 text-sm text-coral">{error}</p> : null}
      </section>

      <section className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-ink">Crear partido manual</h3>
            <p className="mt-2 max-w-3xl text-sm text-steel">
              En fase regular o grupos debes asignar ambos equipos. En knockout puedes dejar sembrado el bracket con
              placeholders como <span className="font-semibold text-ink">1A</span>, <span className="font-semibold text-ink">2B</span> o <span className="font-semibold text-ink">Ganador 49</span>.
            </p>
          </div>
        </div>

        <form onSubmit={handleCreateMatch} className="mt-5 space-y-4">
          <select
            value={createForm.matchday_id}
            onChange={(event) =>
              setCreateForm((current) => ({
                ...current,
                matchday_id: event.target.value,
                picks_lock_at: getAutoLockValue(current.kickoff_at, event.target.value),
              }))
            }
            className="field-control"
            required
          >
            <option value="">Selecciona jornada</option>
            {visibleMatchdays.map((matchday) => (
              <option key={matchday.id} value={matchday.id}>
                {(seasonById[matchday.season_id]?.name ?? "Torneo")} · {matchday.name}
              </option>
            ))}
          </select>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-3">
              <select
                value={createForm.home_team_id}
                onChange={(event) => setCreateForm((current) => ({ ...current, home_team_id: event.target.value }))}
                className="field-control"
              >
                <option value="">Equipo local</option>
                {createEligibleTeams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
              {isKnockoutStage(createForm.stage_type) ? (
                <input
                  value={createForm.home_placeholder}
                  onChange={(event) => setCreateForm((current) => ({ ...current, home_placeholder: event.target.value }))}
                  placeholder="Seed local: 1A / Ganador 49"
                  className="field-control"
                />
              ) : null}
            </div>
            <div className="grid gap-3">
              <select
                value={createForm.away_team_id}
                onChange={(event) => setCreateForm((current) => ({ ...current, away_team_id: event.target.value }))}
                className="field-control"
              >
                <option value="">Equipo visitante</option>
                {createEligibleTeams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
              {isKnockoutStage(createForm.stage_type) ? (
                <input
                  value={createForm.away_placeholder}
                  onChange={(event) => setCreateForm((current) => ({ ...current, away_placeholder: event.target.value }))}
                  placeholder="Seed visita: 2B / Ganador 50"
                  className="field-control"
                />
              ) : null}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2 text-sm">
              <span className="text-steel">Hora del partido</span>
              <input
                type="datetime-local"
                value={createForm.kickoff_at}
                onChange={(event) => {
                  const nextKickoffAt = event.target.value;
                  setCreateForm((current) => ({
                    ...current,
                    kickoff_at: nextKickoffAt,
                    picks_lock_at: getAutoLockValue(nextKickoffAt, current.matchday_id),
                  }));
                }}
                className="field-control"
                required
              />
            </label>

            <label className="space-y-2 text-sm">
              <span className="text-steel">Cierre de picks</span>
              <input
                type="datetime-local"
                value={createForm.picks_lock_at}
                readOnly
                className="field-control cursor-default opacity-80"
              />
            </label>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <select
              value={createForm.stage_type}
              onChange={(event) =>
                setCreateForm((current) => ({ ...current, stage_type: event.target.value as MatchStageType }))
              }
              className="field-control"
            >
              {Object.entries(stageLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <input
              value={createForm.group_label}
              onChange={(event) => setCreateForm((current) => ({ ...current, group_label: event.target.value }))}
              placeholder="Grupo A / opcional"
              className="field-control"
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <input
              value={createForm.bracket_slot}
              onChange={(event) => setCreateForm((current) => ({ ...current, bracket_slot: event.target.value }))}
              placeholder="R16-1 / SF-2 / opcional"
              className="field-control"
            />
            <input
              value={createForm.venue}
              onChange={(event) => setCreateForm((current) => ({ ...current, venue: event.target.value }))}
              placeholder="Estadio"
              className="field-control"
            />
            <input
              value={createForm.external_id}
              onChange={(event) => setCreateForm((current) => ({ ...current, external_id: event.target.value }))}
              placeholder="Codigo unico del proveedor"
              className="field-control"
            />
          </div>

          <div className="grid gap-4 md:grid-cols-[1fr_auto]">
            <select
              value={createForm.status}
              onChange={(event) => setCreateForm((current) => ({ ...current, status: event.target.value }))}
              className="field-control"
            >
              <option value="scheduled">Scheduled</option>
              <option value="final">Final</option>
              <option value="postponed">Postponed</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <button type="submit" disabled={creating} className="primary-button disabled:opacity-60">
              {creating ? "Guardando..." : "Crear partido"}
            </button>
          </div>
        </form>
      </section>

      <section className="space-y-4">
        <h3 className="text-base font-semibold text-ink">
          {selectedMatchdayId ? "Lista editable de la jornada" : "Lista editable de partidos"}
        </h3>
        {loading ? <p className="mt-4 text-sm text-steel">Cargando partidos...</p> : null}

        {matches.length > 0 ? (
          <div className="no-scrollbar max-h-[72vh] overflow-auto touch-pan-x [WebkitOverflowScrolling:touch]">
            <table className="min-w-[1620px] table-fixed text-center text-[11px] text-steel">
              <thead className="app-table-head sticky top-0 z-10 bg-night/95 backdrop-blur-xl">
                <tr>
                  <th className="w-[180px] px-2 py-3">Partido</th>
                  <th className="w-[150px] px-2 py-3">Torneo</th>
                  <th className="w-[150px] px-2 py-3">Jornada</th>
                  <th className="w-[120px] px-2 py-3">Fase</th>
                  <th className="w-[120px] px-2 py-3">Grupo / Bracket</th>
                  <th className="w-[125px] px-2 py-3">Local</th>
                  <th className="w-[125px] px-2 py-3">Visitante</th>
                  <th className="w-[228px] px-2 py-3">Hora</th>
                  <th className="w-[228px] px-2 py-3">Cierre</th>
                  <th className="w-[135px] px-2 py-3">Estadio</th>
                  <th className="w-[95px] px-2 py-3">Status</th>
                  <th className="w-[135px] px-2 py-3">External ID</th>
                  <th className="w-[100px] px-2 py-3">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {matches.map((match) => {
                  const draft = drafts[match.id] ?? buildFormFromMatch(match);
                  const currentMatchday = matchdayById[draft.matchday_id];
                  const currentSeason = currentMatchday ? seasonById[currentMatchday.season_id] : null;
                  const eligibleTeamsForRow = getEligibleTeamsForSeasonId(currentSeason?.id);

                  return (
                    <tr key={match.id} className="app-table-row border-b align-top last:border-b-0">
                      <td className="px-2 py-2 align-top">
                        <p className="font-medium leading-tight text-ink">
                          {match.home_team_name} vs {match.away_team_name}
                        </p>
                        <p className="mt-0.5 truncate text-[9px] text-steel/75">{match.match_key}</p>
                        <p className="mt-0.5 text-[8px] text-sky-100/70">
                          Actual: {formatMexicoCityDateTime(match.kickoff_at)}
                        </p>
                      </td>
                      <td className="px-2 py-2 align-top">
                        <input
                          value={currentSeason?.name ?? "Sin torneo"}
                          readOnly
                          className={`${compactTableControlClass} cursor-default text-sky-100`}
                        />
                      </td>
                      <td className="px-2 py-2 align-top">
                        <select
                          value={draft.matchday_id}
                          onChange={(event) =>
                            updateDraft(match.id, {
                              matchday_id: event.target.value,
                              picks_lock_at: getAutoLockValue(draft.kickoff_at, event.target.value),
                            })
                          }
                          className={compactTableControlClass}
                        >
                          <option value="">Selecciona jornada</option>
                          {visibleMatchdays.map((matchday) => (
                            <option key={matchday.id} value={matchday.id}>
                              {(seasonById[matchday.season_id]?.name ?? "Torneo")} · {matchday.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-2 align-top">
                        <select
                          value={draft.stage_type}
                          onChange={(event) => updateDraft(match.id, { stage_type: event.target.value as MatchStageType })}
                          className={compactTableControlClass}
                        >
                          {Object.entries(stageLabels).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-2 align-top">
                        <div className="grid gap-1">
                          <input
                            value={draft.group_label}
                            onChange={(event) => updateDraft(match.id, { group_label: event.target.value })}
                            placeholder="Grupo"
                            className={compactTableControlClass}
                          />
                          <input
                            value={draft.bracket_slot}
                            onChange={(event) => updateDraft(match.id, { bracket_slot: event.target.value })}
                            placeholder="Bracket"
                            className={compactTableControlClass}
                          />
                        </div>
                      </td>
                      <td className="px-2 py-2 align-top">
                        <select
                          value={draft.home_team_id}
                          onChange={(event) => updateDraft(match.id, { home_team_id: event.target.value })}
                          className={compactTableControlClass}
                        >
                          <option value="">Equipo local</option>
                          {eligibleTeamsForRow.map((team) => (
                            <option key={team.id} value={team.id}>
                              {team.name}
                            </option>
                          ))}
                        </select>
                        {isKnockoutStage(draft.stage_type) ? (
                          <input
                            value={draft.home_placeholder}
                            onChange={(event) => updateDraft(match.id, { home_placeholder: event.target.value })}
                            placeholder="Seed local"
                            className={`${compactTableControlClass} mt-1`}
                          />
                        ) : null}
                      </td>
                      <td className="px-2 py-2 align-top">
                        <select
                          value={draft.away_team_id}
                          onChange={(event) => updateDraft(match.id, { away_team_id: event.target.value })}
                          className={compactTableControlClass}
                        >
                          <option value="">Equipo visitante</option>
                          {eligibleTeamsForRow.map((team) => (
                            <option key={team.id} value={team.id}>
                              {team.name}
                            </option>
                          ))}
                        </select>
                        {isKnockoutStage(draft.stage_type) ? (
                          <input
                            value={draft.away_placeholder}
                            onChange={(event) => updateDraft(match.id, { away_placeholder: event.target.value })}
                            placeholder="Seed visita"
                            className={`${compactTableControlClass} mt-1`}
                          />
                        ) : null}
                      </td>
                      <td className="px-2 py-2 align-top">
                        <div className="grid grid-cols-[116px_108px] gap-1">
                          <input
                            type="date"
                            value={splitLocalDateTime(draft.kickoff_at).date}
                            onChange={(event) => {
                              const { time } = splitLocalDateTime(draft.kickoff_at);
                              const nextKickoffAt = joinLocalDateTime(event.target.value, time);
                              updateDraft(match.id, {
                                kickoff_at: nextKickoffAt,
                                picks_lock_at: getAutoLockValue(nextKickoffAt, draft.matchday_id),
                              });
                            }}
                            className={compactTableControlClass}
                          />
                          <input
                            type="time"
                            value={splitLocalDateTime(draft.kickoff_at).time}
                            onChange={(event) => {
                              const { date } = splitLocalDateTime(draft.kickoff_at);
                              const nextKickoffAt = joinLocalDateTime(date, event.target.value);
                              updateDraft(match.id, {
                                kickoff_at: nextKickoffAt,
                                picks_lock_at: shiftMexicoCityInputValue(
                                  nextKickoffAt,
                                  -getAutoLockOffsetMinutes(draft.matchday_id),
                                ),
                              });
                            }}
                            className={compactTableControlClass}
                          />
                        </div>
                      </td>
                      <td className="px-2 py-2 align-top">
                        <div className="grid grid-cols-[116px_108px] gap-1">
                          <input
                            type="date"
                            value={splitLocalDateTime(draft.picks_lock_at).date}
                            readOnly
                            className={`${compactTableControlClass} cursor-default opacity-80`}
                          />
                          <input
                            type="time"
                            value={splitLocalDateTime(draft.picks_lock_at).time}
                            readOnly
                            className={`${compactTableControlClass} cursor-default opacity-80`}
                          />
                        </div>
                      </td>
                      <td className="px-2 py-2 align-top">
                        <input
                          value={draft.venue}
                          onChange={(event) => updateDraft(match.id, { venue: event.target.value })}
                          className={compactTableControlClass}
                        />
                      </td>
                      <td className="px-2 py-2 align-top">
                        <select
                          value={draft.status}
                          onChange={(event) => updateDraft(match.id, { status: event.target.value })}
                          className={compactTableControlClass}
                        >
                          <option value="scheduled">Scheduled</option>
                          <option value="final">Final</option>
                          <option value="postponed">Postponed</option>
                          <option value="cancelled">Cancelled</option>
                        </select>
                      </td>
                      <td className="px-2 py-2 align-top">
                        <input
                          value={draft.external_id}
                          onChange={(event) => updateDraft(match.id, { external_id: event.target.value })}
                          className={compactExternalIdControlClass}
                        />
                      </td>
                      <td className="px-2 py-2 align-top">
                        <div className="flex min-w-[82px] items-center gap-1">
                          <button
                            type="button"
                            onClick={() => void saveMatch(match.id)}
                            disabled={savingMatchId === match.id || deletingMatchId === match.id}
                            className={`${compactActionButtonClass} min-w-[48px]`}
                          >
                            {savingMatchId === match.id ? "..." : "Save"}
                          </button>
                          <button
                            type="button"
                            onClick={() => void deleteMatch(match)}
                            disabled={savingMatchId === match.id || deletingMatchId === match.id}
                            aria-label={`Borrar ${match.home_team_name} vs ${match.away_team_name}`}
                            className="app-pill inline-flex h-7 w-7 items-center justify-center rounded-[10px] px-0 disabled:opacity-60"
                          >
                            {deletingMatchId === match.id ? (
                              <span className="text-[9px] font-semibold">...</span>
                            ) : (
                              <Trash2 className="h-3 w-3" />
                            )}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}

        {!loading && matches.length === 0 ? (
          <p className="mt-5 text-sm text-steel">
            {selectedMatchdayId
              ? "Todavia no hay partidos en esa jornada."
              : "Todavia no hay partidos cargados en la app."}
          </p>
        ) : null}
      </section>
    </div>
  );
}
