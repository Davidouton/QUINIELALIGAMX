"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

import { backendFetch } from "@/lib/api/backend";
import {
  formatMexicoCityDateTime,
  shiftMexicoCityInputValue,
  toMexicoCityInputValue,
} from "@/lib/datetime/mexico-city";
import { getBrowserAccessToken } from "@/lib/supabase/session";
import type { Match, MatchStageType, Matchday, Season, Team } from "@/types/api";

type BracketFormState = {
  matchday_id: string;
  stage_type: MatchStageType;
  bracket_slot: string;
  home_team_id: string;
  away_team_id: string;
  home_placeholder: string;
  away_placeholder: string;
  kickoff_at: string;
  venue: string;
  status: Match["status"];
  external_id: string;
};

const knockoutStages: MatchStageType[] = [
  "round_of_32",
  "round_of_16",
  "quarterfinal",
  "semifinal",
  "third_place",
  "final",
];

const stageLabels: Record<MatchStageType, string> = {
  regular: "Regular",
  group: "Grupo",
  round_of_32: "Dieciseisavos",
  round_of_16: "Octavos",
  quarterfinal: "Cuartos",
  semifinal: "Semifinales",
  third_place: "Tercer lugar",
  final: "Final",
};

const statusLabels: Record<Match["status"], string> = {
  scheduled: "Programado",
  final: "Final",
  postponed: "Pospuesto",
  cancelled: "Cancelado",
};

const initialForm: BracketFormState = {
  matchday_id: "",
  stage_type: "round_of_32",
  bracket_slot: "",
  home_team_id: "",
  away_team_id: "",
  home_placeholder: "",
  away_placeholder: "",
  kickoff_at: "",
  venue: "",
  status: "scheduled",
  external_id: "",
};

function buildFormFromMatch(match: Match): BracketFormState {
  return {
    matchday_id: match.matchday_id,
    stage_type: match.stage_type,
    bracket_slot: match.bracket_slot ?? "",
    home_team_id: match.home_team_id ?? "",
    away_team_id: match.away_team_id ?? "",
    home_placeholder: match.home_placeholder ?? "",
    away_placeholder: match.away_placeholder ?? "",
    kickoff_at: toMexicoCityInputValue(match.kickoff_at),
    venue: match.venue ?? "",
    status: match.status,
    external_id: match.external_id ?? "",
  };
}

function matchLabel(match: Match) {
  return `${match.home_team_name} vs ${match.away_team_name}`;
}

export function AdminWorldCupBracketPanel() {
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [matchdays, setMatchdays] = useState<Matchday[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [selectedSeasonId, setSelectedSeasonId] = useState("");
  const [createForm, setCreateForm] = useState<BracketFormState>(initialForm);
  const [drafts, setDrafts] = useState<Record<string, BracketFormState>>({});
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [savingMatchId, setSavingMatchId] = useState<string | null>(null);
  const [deletingMatchId, setDeletingMatchId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const worldCupSeasons = useMemo(
    () => seasons.filter((season) => season.tournament_format === "world_cup"),
    [seasons],
  );

  const selectedSeason = worldCupSeasons.find((season) => season.id === selectedSeasonId) ?? null;

  const visibleMatchdays = useMemo(
    () => matchdays.filter((matchday) => matchday.season_id === selectedSeasonId),
    [matchdays, selectedSeasonId],
  );

  const eligibleTeams = useMemo(
    () =>
      teams.filter((team) =>
        selectedSeason?.competition_id ? team.competition_id === selectedSeason.competition_id : true,
      ),
    [selectedSeason?.competition_id, teams],
  );

  const matchdayById = useMemo(
    () => Object.fromEntries(matchdays.map((matchday) => [matchday.id, matchday])),
    [matchdays],
  );

  const groupedMatches = useMemo(
    () =>
      Object.fromEntries(
        knockoutStages.map((stage) => [stage, matches.filter((match) => match.stage_type === stage)]),
      ) as Record<MatchStageType, Match[]>,
    [matches],
  );

  function getAutoLockOffsetMinutes(matchdayId: string) {
    return matchdayById[matchdayId]?.default_lock_offset_minutes ?? 10;
  }

  function getAutoLockValue(kickoffAt: string, matchdayId: string) {
    if (!kickoffAt) {
      return "";
    }
    return shiftMexicoCityInputValue(kickoffAt, -getAutoLockOffsetMinutes(matchdayId));
  }

  function getDefaultMatchdayId(nextSeasonId: string, rows: Matchday[]) {
    return (
      rows.find((matchday) => matchday.season_id === nextSeasonId && matchday.status === "active")?.id ??
      rows.find((matchday) => matchday.season_id === nextSeasonId)?.id ??
      ""
    );
  }

  async function loadBracket(seasonId: string) {
    if (!seasonId) {
      setMatches([]);
      setDrafts({});
      return;
    }
    const accessToken = await getBrowserAccessToken();
    const rows = await backendFetch<Match[]>(`/admin/world-cup/bracket?season_id=${seasonId}`, accessToken);
    setMatches(rows);
    setDrafts(Object.fromEntries(rows.map((match) => [match.id, buildFormFromMatch(match)])));
  }

  useEffect(() => {
    async function load() {
      try {
        const [seasonRows, teamRows, matchdayRows] = await Promise.all([
          backendFetch<Season[]>("/seasons"),
          backendFetch<Team[]>("/teams"),
          backendFetch<Matchday[]>("/matchdays"),
        ]);
        const nextWorldCupSeasons = seasonRows.filter((season) => season.tournament_format === "world_cup");
        const nextSeasonId =
          nextWorldCupSeasons.find((season) => season.is_active)?.id ?? nextWorldCupSeasons[0]?.id ?? "";
        const defaultMatchdayId = getDefaultMatchdayId(nextSeasonId, matchdayRows);

        setSeasons(seasonRows);
        setTeams(teamRows);
        setMatchdays(matchdayRows);
        setSelectedSeasonId(nextSeasonId);
        setCreateForm((current) => ({ ...current, matchday_id: defaultMatchdayId }));
        await loadBracket(nextSeasonId);
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "No se pudo cargar el bracket mundialista");
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, []);

  async function handleSeasonChange(seasonId: string) {
    setSelectedSeasonId(seasonId);
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const defaultMatchdayId = getDefaultMatchdayId(seasonId, matchdays);
      setCreateForm((current) => ({ ...initialForm, stage_type: current.stage_type, matchday_id: defaultMatchdayId }));
      await loadBracket(seasonId);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo cargar el bracket");
    } finally {
      setLoading(false);
    }
  }

  async function refreshBracket(accessToken?: string) {
    if (!selectedSeasonId) {
      return;
    }
    const token = accessToken ?? (await getBrowserAccessToken());
    const rows = await backendFetch<Match[]>(`/admin/world-cup/bracket?season_id=${selectedSeasonId}`, token);
    setMatches(rows);
    setDrafts(Object.fromEntries(rows.map((match) => [match.id, buildFormFromMatch(match)])));
  }

  async function handleCreateMatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedSeasonId) {
      setError("Selecciona una temporada mundialista.");
      return;
    }
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
          group_label: null,
          bracket_slot: createForm.bracket_slot || null,
          home_placeholder: createForm.home_placeholder || null,
          away_placeholder: createForm.away_placeholder || null,
          picks_lock_at: getAutoLockValue(createForm.kickoff_at, createForm.matchday_id) || createForm.kickoff_at,
          venue: createForm.venue || null,
          external_id: createForm.external_id || null,
        }),
      });
      await refreshBracket(accessToken);
      setCreateForm((current) => ({
        ...initialForm,
        matchday_id: current.matchday_id,
        stage_type: current.stage_type,
      }));
      setMessage("Cruce creado.");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo crear el cruce");
    } finally {
      setCreating(false);
    }
  }

  function updateDraft(matchId: string, patch: Partial<BracketFormState>) {
    setDrafts((current) => ({
      ...current,
      [matchId]: {
        ...(current[matchId] ?? initialForm),
        ...patch,
      },
    }));
  }

  async function handleSaveMatch(matchId: string) {
    const draft = drafts[matchId];
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
          group_label: null,
          bracket_slot: draft.bracket_slot || null,
          home_placeholder: draft.home_placeholder || null,
          away_placeholder: draft.away_placeholder || null,
          picks_lock_at: getAutoLockValue(draft.kickoff_at, draft.matchday_id) || draft.kickoff_at,
          venue: draft.venue || null,
          external_id: draft.external_id || null,
        }),
      });
      await refreshBracket(accessToken);
      setMessage("Cruce actualizado.");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo actualizar el cruce");
    } finally {
      setSavingMatchId(null);
    }
  }

  async function handleDeleteMatch(match: Match) {
    const confirmed = window.confirm(`Borrar el cruce ${matchLabel(match)}?`);
    if (!confirmed) {
      return;
    }
    setDeletingMatchId(match.id);
    setError(null);
    setMessage(null);
    try {
      const accessToken = await getBrowserAccessToken();
      await backendFetch(`/admin/matches/${match.id}`, accessToken, { method: "DELETE" });
      await refreshBracket(accessToken);
      setMessage("Cruce borrado.");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo borrar el cruce");
    } finally {
      setDeletingMatchId(null);
    }
  }

  return (
    <div className="space-y-6">
      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.22em] text-ink">Bracket mundialista</h2>
          <p className="mt-2 text-sm text-steel">
            Aqui siembras y editas las llaves. Puedes dejar cruces con placeholders tipo `1A`, `2B` o marcarlos
            manualmente si vienen por sorteo.
          </p>
        </div>

        <div className="max-w-[360px]">
          <select
            value={selectedSeasonId}
            onChange={(event) => void handleSeasonChange(event.target.value)}
            className="field-control"
          >
            <option value="">Selecciona temporada mundialista</option>
            {worldCupSeasons.map((season) => (
              <option key={season.id} value={season.id}>
                {season.name}
              </option>
            ))}
          </select>
        </div>

        <form onSubmit={handleCreateMatch} className="grid gap-4 xl:grid-cols-4">
          <select
            value={createForm.matchday_id}
            onChange={(event) => setCreateForm((current) => ({ ...current, matchday_id: event.target.value }))}
            className="field-control"
            required
          >
            <option value="">Selecciona jornada</option>
            {visibleMatchdays.map((matchday) => (
              <option key={matchday.id} value={matchday.id}>
                {matchday.number}. {matchday.name}
              </option>
            ))}
          </select>
          <select
            value={createForm.stage_type}
            onChange={(event) =>
              setCreateForm((current) => ({ ...current, stage_type: event.target.value as MatchStageType }))
            }
            className="field-control"
          >
            {knockoutStages.map((stage) => (
              <option key={stage} value={stage}>
                {stageLabels[stage]}
              </option>
            ))}
          </select>
          <input
            value={createForm.bracket_slot}
            onChange={(event) => setCreateForm((current) => ({ ...current, bracket_slot: event.target.value }))}
            placeholder="R16-01, QF-02, etc."
            className="field-control"
          />
          <input
            type="datetime-local"
            value={createForm.kickoff_at}
            onChange={(event) => setCreateForm((current) => ({ ...current, kickoff_at: event.target.value }))}
            className="field-control"
            required
          />
          <select
            value={createForm.home_team_id}
            onChange={(event) => setCreateForm((current) => ({ ...current, home_team_id: event.target.value }))}
            className="field-control"
          >
            <option value="">Local real</option>
            {eligibleTeams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.short_name} · {team.name}
              </option>
            ))}
          </select>
          <input
            value={createForm.home_placeholder}
            onChange={(event) => setCreateForm((current) => ({ ...current, home_placeholder: event.target.value }))}
            placeholder="1A o Ganador 49"
            className="field-control"
          />
          <select
            value={createForm.away_team_id}
            onChange={(event) => setCreateForm((current) => ({ ...current, away_team_id: event.target.value }))}
            className="field-control"
          >
            <option value="">Visitante real</option>
            {eligibleTeams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.short_name} · {team.name}
              </option>
            ))}
          </select>
          <input
            value={createForm.away_placeholder}
            onChange={(event) => setCreateForm((current) => ({ ...current, away_placeholder: event.target.value }))}
            placeholder="2B o Ganador 50"
            className="field-control"
          />
          <input
            value={createForm.venue}
            onChange={(event) => setCreateForm((current) => ({ ...current, venue: event.target.value }))}
            placeholder="Sede"
            className="field-control"
          />
          <select
            value={createForm.status}
            onChange={(event) => setCreateForm((current) => ({ ...current, status: event.target.value as Match["status"] }))}
            className="field-control"
          >
            {Object.entries(statusLabels).map(([status, label]) => (
              <option key={status} value={status}>
                {label}
              </option>
            ))}
          </select>
          <input
            value={createForm.external_id}
            onChange={(event) => setCreateForm((current) => ({ ...current, external_id: event.target.value }))}
            placeholder="External ID"
            className="field-control font-mono"
          />
          <div className="xl:col-span-4">
            <button type="submit" disabled={creating} className="app-pill-active px-4 disabled:opacity-60">
              {creating ? "Creando..." : "Crear cruce"}
            </button>
          </div>
        </form>

        {message ? <p className="text-sm text-moss">{message}</p> : null}
        {error ? <p className="text-sm text-coral">{error}</p> : null}
      </section>

      {loading ? <p className="text-sm text-steel">Cargando bracket...</p> : null}

      {!loading ? (
        <section className="space-y-5">
          {knockoutStages.map((stage) => (
            <div key={stage} className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-ink">{stageLabels[stage]}</h3>
                  <p className="mt-1 text-xs text-steel">
                    {groupedMatches[stage].length > 0
                      ? `${groupedMatches[stage].length} cruces cargados`
                      : "Todavia no hay cruces cargados"}
                  </p>
                </div>
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                {groupedMatches[stage].map((match) => {
                  const draft = drafts[match.id] ?? buildFormFromMatch(match);
                  return (
                    <div key={match.id} className="rounded-[18px] border border-white/[0.06] bg-white/[0.03] p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs uppercase tracking-[0.16em] text-steel">
                            {draft.bracket_slot || "Sin slot"} · {statusLabels[draft.status]}
                          </p>
                          <h4 className="mt-2 text-lg font-semibold text-ink">{matchLabel(match)}</h4>
                          <p className="mt-1 text-xs text-steel">{formatMexicoCityDateTime(match.kickoff_at)}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleDeleteMatch(match)}
                          disabled={deletingMatchId === match.id}
                          className="app-pill px-3 text-[11px] disabled:opacity-60"
                        >
                          {deletingMatchId === match.id ? "..." : "Borrar"}
                        </button>
                      </div>

                      <div className="mt-4 grid gap-3 md:grid-cols-2">
                        <select
                          value={draft.matchday_id}
                          onChange={(event) => updateDraft(match.id, { matchday_id: event.target.value })}
                          className="field-control"
                        >
                          <option value="">Selecciona jornada</option>
                          {visibleMatchdays.map((matchday) => (
                            <option key={matchday.id} value={matchday.id}>
                              {matchday.number}. {matchday.name}
                            </option>
                          ))}
                        </select>
                        <input
                          value={draft.bracket_slot}
                          onChange={(event) => updateDraft(match.id, { bracket_slot: event.target.value })}
                          placeholder="R16-01"
                          className="field-control"
                        />
                        <select
                          value={draft.home_team_id}
                          onChange={(event) => updateDraft(match.id, { home_team_id: event.target.value })}
                          className="field-control"
                        >
                          <option value="">Local real</option>
                          {eligibleTeams.map((team) => (
                            <option key={team.id} value={team.id}>
                              {team.short_name} · {team.name}
                            </option>
                          ))}
                        </select>
                        <input
                          value={draft.home_placeholder}
                          onChange={(event) => updateDraft(match.id, { home_placeholder: event.target.value })}
                          placeholder="1A o sorteo"
                          className="field-control"
                        />
                        <select
                          value={draft.away_team_id}
                          onChange={(event) => updateDraft(match.id, { away_team_id: event.target.value })}
                          className="field-control"
                        >
                          <option value="">Visitante real</option>
                          {eligibleTeams.map((team) => (
                            <option key={team.id} value={team.id}>
                              {team.short_name} · {team.name}
                            </option>
                          ))}
                        </select>
                        <input
                          value={draft.away_placeholder}
                          onChange={(event) => updateDraft(match.id, { away_placeholder: event.target.value })}
                          placeholder="2B o sorteo"
                          className="field-control"
                        />
                        <input
                          type="datetime-local"
                          value={draft.kickoff_at}
                          onChange={(event) => updateDraft(match.id, { kickoff_at: event.target.value })}
                          className="field-control"
                        />
                        <select
                          value={draft.status}
                          onChange={(event) => updateDraft(match.id, { status: event.target.value as Match["status"] })}
                          className="field-control"
                        >
                          {Object.entries(statusLabels).map(([status, label]) => (
                            <option key={status} value={status}>
                              {label}
                            </option>
                          ))}
                        </select>
                        <input
                          value={draft.venue}
                          onChange={(event) => updateDraft(match.id, { venue: event.target.value })}
                          placeholder="Sede"
                          className="field-control"
                        />
                        <input
                          value={draft.external_id}
                          onChange={(event) => updateDraft(match.id, { external_id: event.target.value })}
                          placeholder="External ID"
                          className="field-control font-mono"
                        />
                      </div>

                      <div className="mt-4 flex items-center justify-between gap-3">
                        <p className="text-xs text-steel">
                          Puedes mezclar equipo real + placeholder. El pick solo se abre cuando existan ambos equipos.
                        </p>
                        <button
                          type="button"
                          onClick={() => void handleSaveMatch(match.id)}
                          disabled={savingMatchId === match.id}
                          className="app-pill-active px-4 text-[11px] disabled:opacity-60"
                        >
                          {savingMatchId === match.id ? "Guardando..." : "Guardar"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </section>
      ) : null}
    </div>
  );
}
