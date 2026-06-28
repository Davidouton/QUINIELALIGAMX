"use client";

import { FormEvent, useEffect, useState } from "react";

import { backendFetch } from "@/lib/api/backend";
import {
  formatMexicoCityDateTime,
  shiftMexicoCityInputValue,
  toMexicoCityInputValue,
} from "@/lib/datetime/mexico-city";
import { getBrowserAccessToken } from "@/lib/supabase/session";
import type { Match, Matchday, MatchdayStatus, Me, OddsPreviewRow, Season, Team } from "@/types/api";

type AdminState = {
  me: Me | null;
  seasons: Season[];
  teams: Team[];
  matchdays: Matchday[];
  matches: Match[];
  selectedMatchdayId: string;
  editingSeasonId: string | null;
  editingMatchdayId: string | null;
  editingMatchId: string | null;
  error: string | null;
};

type SeasonFormState = {
  name: string;
  slug: string;
  is_active: boolean;
};

type TeamFormState = {
  name: string;
  short_name: string;
  slug: string;
  external_id: string;
  crest_url: string;
  home_venue: string;
  primary_color: string;
  secondary_color: string;
  accent_color: string;
};

type MatchdayFormState = {
  season_id: string;
  number: string;
  name: string;
  default_lock_offset_minutes: string;
  status: MatchdayStatus;
  starts_at: string;
  ends_at: string;
};

type MatchFormState = {
  matchday_id: string;
  home_team_id: string;
  away_team_id: string;
  kickoff_at: string;
  picks_lock_at: string;
  venue: string;
  status: string;
  external_id: string;
};

type OddsPullResult = {
  status: string;
  snapshot_date: string | null;
  raw_rows_processed: number | null;
  matched: number | null;
  unmatched: number | null;
  preview_rows: OddsPreviewRow[];
  pull_output: string;
  sync_output: string;
};

type AdminTab = "odds" | "seasons" | "teams" | "matchdays" | "matches";

const initialState: AdminState = {
  me: null,
  seasons: [],
  teams: [],
  matchdays: [],
  matches: [],
  selectedMatchdayId: "",
  editingSeasonId: null,
  editingMatchdayId: null,
  editingMatchId: null,
  error: null,
};

const initialSeasonForm: SeasonFormState = {
  name: "",
  slug: "",
  is_active: false,
};

const initialTeamForm: TeamFormState = {
  name: "",
  short_name: "",
  slug: "",
  external_id: "",
  crest_url: "",
  home_venue: "",
  primary_color: "",
  secondary_color: "",
  accent_color: "",
};

const initialMatchdayForm: MatchdayFormState = {
  season_id: "",
  number: "",
  name: "",
  default_lock_offset_minutes: "10",
  status: "draft",
  starts_at: "",
  ends_at: "",
};

const initialMatchForm: MatchFormState = {
  matchday_id: "",
  home_team_id: "",
  away_team_id: "",
  kickoff_at: "",
  picks_lock_at: "",
  venue: "",
  status: "scheduled",
  external_id: "",
};

export function AdminControlRoom() {
  const [state, setState] = useState<AdminState>(initialState);
  const [seasonForm, setSeasonForm] = useState<SeasonFormState>(initialSeasonForm);
  const [teamForm, setTeamForm] = useState<TeamFormState>(initialTeamForm);
  const [matchdayForm, setMatchdayForm] = useState<MatchdayFormState>(initialMatchdayForm);
  const [matchForm, setMatchForm] = useState<MatchFormState>(initialMatchForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [autoLockOffsetMinutes, setAutoLockOffsetMinutes] = useState(10);
  const [oddsPullResult, setOddsPullResult] = useState<OddsPullResult | null>(null);
  const [activeTab, setActiveTab] = useState<AdminTab>("odds");
  const [isTabMenuOpen, setIsTabMenuOpen] = useState(false);

  async function withTimeout<T>(promise: Promise<T>, label: string, timeoutMs = 30000): Promise<T> {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        window.setTimeout(() => reject(new Error(`Timeout cargando ${label}`)), timeoutMs);
      }),
    ]);
  }

  async function getAccessTokenWithTimeout() {
    return await withTimeout(getBrowserAccessToken(), "sesion admin");
  }

  async function loadMatches(matchdayId: string, accessToken: string) {
    if (!matchdayId) {
      setState((current) => ({ ...current, matches: [], selectedMatchdayId: "" }));
      return;
    }

    const matches = await withTimeout(
      backendFetch<Match[]>(`/matches?matchday_id=${matchdayId}`, accessToken),
      `partidos de la jornada ${matchdayId}`,
    );
    setState((current) => ({ ...current, matches, selectedMatchdayId: matchdayId }));
  }

  async function loadAdminData() {
    const accessToken = await getAccessTokenWithTimeout();
    const [meResult, seasonsResult, teamsResult, matchdaysResult] = await Promise.allSettled([
      withTimeout(backendFetch<Me>("/me", accessToken), "/me"),
      withTimeout(backendFetch<Season[]>("/seasons", accessToken), "/seasons"),
      withTimeout(backendFetch<Team[]>("/teams", accessToken), "/teams"),
      withTimeout(backendFetch<Matchday[]>("/matchdays", accessToken), "/matchdays"),
    ]);

    const me = meResult.status === "fulfilled" ? meResult.value : null;
    const seasons = seasonsResult.status === "fulfilled" ? seasonsResult.value : [];
    const teams = teamsResult.status === "fulfilled" ? teamsResult.value : [];
    const matchdays = matchdaysResult.status === "fulfilled" ? matchdaysResult.value : [];
    const errors = [meResult, seasonsResult, teamsResult, matchdaysResult]
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => (result.reason instanceof Error ? result.reason.message : "Error desconocido"));

    const selectedMatchdayId = state.selectedMatchdayId || matchdays[0]?.id || "";
    let matches: Match[] = [];
    if (selectedMatchdayId) {
      try {
        matches = await withTimeout(
          backendFetch<Match[]>(`/matches?matchday_id=${selectedMatchdayId}`, accessToken),
          `/matches?matchday_id=${selectedMatchdayId}`,
        );
      } catch (error) {
        errors.push(error instanceof Error ? error.message : "No se pudieron cargar los partidos");
      }
    }

    setState((current) => ({
      ...current,
      me,
      seasons,
      teams,
      matchdays,
      matches,
      selectedMatchdayId,
      error: errors.length > 0 ? errors.join(" | ") : null,
    }));

    setMatchdayForm((current) => ({
      ...current,
      season_id: current.season_id || seasons.find((season) => season.is_active)?.id || seasons[0]?.id || "",
    }));
    setMatchForm((current) => ({
      ...current,
      matchday_id: current.matchday_id || selectedMatchdayId,
    }));
    if (matchdays.length > 0) {
      const activeMatchday = matchdays.find((matchday) => matchday.id === selectedMatchdayId) ?? matchdays[0];
      setAutoLockOffsetMinutes(activeMatchday.default_lock_offset_minutes);
      setMatchdayForm((current) => ({
        ...current,
        default_lock_offset_minutes:
          current.default_lock_offset_minutes || String(activeMatchday.default_lock_offset_minutes),
      }));
    }
  }

  useEffect(() => {
    let didFinish = false;
    const loadingFuse = window.setTimeout(() => {
      if (didFinish) {
        return;
      }

      setLoading(false);
      setState((current) => ({
        ...current,
        error:
          current.error ??
          "Timeout cargando panel admin. El backend puede seguir arrancando; espera un poco y reintenta.",
      }));
    }, 32000);

    async function load() {
      try {
        await loadAdminData();
      } catch (error) {
        setState((current) => ({
          ...current,
          error: error instanceof Error ? error.message : "No se pudo cargar el panel admin",
        }));
      } finally {
        didFinish = true;
        window.clearTimeout(loadingFuse);
        setLoading(false);
      }
    }

    void load();

    return () => {
      didFinish = true;
      window.clearTimeout(loadingFuse);
    };
  }, []);

  useEffect(() => {
    if (!matchForm.kickoff_at) {
      return;
    }

    const nextLockAt = shiftMexicoCityInputValue(matchForm.kickoff_at, -autoLockOffsetMinutes);
    if (!nextLockAt || nextLockAt === matchForm.picks_lock_at) {
      return;
    }

    setMatchForm((current) => ({
      ...current,
      picks_lock_at: shiftMexicoCityInputValue(current.kickoff_at, -autoLockOffsetMinutes),
    }));
  }, [autoLockOffsetMinutes, matchForm.kickoff_at, matchForm.picks_lock_at]);

  async function handleSaveSeason(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving("season");
    setMessage(null);

    try {
      const accessToken = await getAccessTokenWithTimeout();
      const path = state.editingSeasonId ? `/admin/seasons/${state.editingSeasonId}` : "/admin/seasons";
      const method = state.editingSeasonId ? "PUT" : "POST";
      await backendFetch(path, accessToken, {
        method,
        body: JSON.stringify(seasonForm),
      });
      setSeasonForm(initialSeasonForm);
      setState((current) => ({ ...current, editingSeasonId: null }));
      await loadAdminData();
      setMessage(state.editingSeasonId ? "Temporada actualizada." : "Temporada creada.");
    } catch (error) {
      setState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : "No se pudo guardar la temporada",
      }));
    } finally {
      setSaving(null);
    }
  }

  function beginEditSeason(season: Season) {
    setState((current) => ({ ...current, editingSeasonId: season.id }));
    setSeasonForm({
      name: season.name,
      slug: season.slug,
      is_active: season.is_active,
    });
  }

  async function handleSetActiveSeason(season: Season) {
    setSaving(`season:${season.id}`);
    setMessage(null);

    try {
      const accessToken = await getAccessTokenWithTimeout();
      await backendFetch(`/admin/seasons/${season.id}`, accessToken, {
        method: "PUT",
        body: JSON.stringify({
          name: season.name,
          slug: season.slug,
          is_active: true,
        }),
      });
      await loadAdminData();
      setMessage(`Temporada activa: ${season.name}.`);
    } catch (error) {
      setState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : "No se pudo activar la temporada",
      }));
    } finally {
      setSaving(null);
    }
  }

  async function handleCreateTeam(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving("team");
    setMessage(null);

    try {
      const accessToken = await getAccessTokenWithTimeout();
      await backendFetch("/admin/teams", accessToken, {
        method: "POST",
        body: JSON.stringify({
          ...teamForm,
          external_id: teamForm.external_id || null,
          crest_url: teamForm.crest_url || null,
          home_venue: teamForm.home_venue || null,
          primary_color: teamForm.primary_color || null,
          secondary_color: teamForm.secondary_color || null,
          accent_color: teamForm.accent_color || null,
        }),
      });
      setTeamForm(initialTeamForm);
      await loadAdminData();
      setMessage("Equipo creado.");
    } catch (error) {
      setState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : "No se pudo crear el equipo",
      }));
    } finally {
      setSaving(null);
    }
  }

  async function handleSaveMatchday(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving("matchday");
    setMessage(null);

    try {
      const accessToken = await getAccessTokenWithTimeout();
      const payload = {
        ...matchdayForm,
        number: Number(matchdayForm.number),
        default_lock_offset_minutes: Number(matchdayForm.default_lock_offset_minutes),
        starts_at: matchdayForm.starts_at,
        ends_at: matchdayForm.ends_at,
      };
      const path = state.editingMatchdayId
        ? `/admin/matchdays/${state.editingMatchdayId}`
        : "/admin/matchdays";
      const method = state.editingMatchdayId ? "PUT" : "POST";

      await backendFetch(path, accessToken, {
        method,
        body: JSON.stringify(payload),
      });

      setMatchdayForm((current) => ({ ...initialMatchdayForm, season_id: current.season_id }));
      setState((current) => ({ ...current, editingMatchdayId: null }));
      await loadAdminData();
      setMessage(state.editingMatchdayId ? "Jornada actualizada." : "Jornada creada.");
    } catch (error) {
      setState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : "No se pudo guardar la jornada",
      }));
    } finally {
      setSaving(null);
    }
  }

  async function handleSaveMatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving("match");
    setMessage(null);

    try {
      const accessToken = await getAccessTokenWithTimeout();
      const payload = {
        ...matchForm,
        kickoff_at: matchForm.kickoff_at,
        picks_lock_at: matchForm.picks_lock_at || matchForm.kickoff_at,
        venue: matchForm.venue || null,
        external_id: matchForm.external_id || null,
      };
      const path = state.editingMatchId ? `/admin/matches/${state.editingMatchId}` : "/admin/matches";
      const method = state.editingMatchId ? "PUT" : "POST";

      await backendFetch(path, accessToken, {
        method,
        body: JSON.stringify(payload),
      });

      const selectedMatchdayId = matchForm.matchday_id || state.selectedMatchdayId;
      setMatchForm((current) => ({ ...initialMatchForm, matchday_id: selectedMatchdayId }));
      setState((current) => ({ ...current, editingMatchId: null }));
      await loadAdminData();
      setMessage(state.editingMatchId ? "Partido actualizado." : "Partido creado.");
    } catch (error) {
      setState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : "No se pudo guardar el partido",
      }));
    } finally {
      setSaving(null);
    }
  }

  function beginEditMatchday(matchday: Matchday) {
    setState((current) => ({ ...current, editingMatchdayId: matchday.id }));
    setMatchdayForm({
      season_id: matchday.season_id,
      number: String(matchday.number),
      name: matchday.name,
      default_lock_offset_minutes: String(matchday.default_lock_offset_minutes),
      status: matchday.status,
      starts_at: toMexicoCityInputValue(matchday.starts_at),
      ends_at: toMexicoCityInputValue(matchday.ends_at),
    });
    setAutoLockOffsetMinutes(matchday.default_lock_offset_minutes);
  }

  function beginEditMatch(match: Match) {
    setState((current) => ({ ...current, editingMatchId: match.id }));
    setMatchForm({
      matchday_id: match.matchday_id,
      home_team_id: match.home_team_id ?? "",
      away_team_id: match.away_team_id ?? "",
      kickoff_at: toMexicoCityInputValue(match.kickoff_at),
      picks_lock_at: toMexicoCityInputValue(match.picks_lock_at),
      venue: match.venue ?? "",
      status: match.status,
      external_id: match.external_id ?? "",
    });
  }

  async function handleChangeMatchday(matchdayId: string) {
    try {
      const accessToken = await getAccessTokenWithTimeout();
      await loadMatches(matchdayId, accessToken);
      const selectedMatchday = state.matchdays.find((matchday) => matchday.id === matchdayId);
      if (selectedMatchday) {
        setAutoLockOffsetMinutes(selectedMatchday.default_lock_offset_minutes);
      }
      setMatchForm((current) => ({
        ...current,
        matchday_id: matchdayId,
      }));
      setState((current) => ({ ...current, error: null }));
    } catch (error) {
      setState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : "No se pudieron cargar los partidos",
      }));
    }
  }

  async function handlePullOdds() {
    setSaving("odds-pull");
    setMessage(null);
    setOddsPullResult(null);
    setState((current) => ({ ...current, error: null }));

    try {
      const accessToken = await getAccessTokenWithTimeout();
      const result = await backendFetch<OddsPullResult>("/admin/odds/pull", accessToken, {
        method: "POST",
        timeoutMs: 180000,
      });
      setOddsPullResult(result);
      setState((current) => ({ ...current, error: null }));
      setMessage(
        `Odds cargados${result.raw_rows_processed !== null ? `: ${result.raw_rows_processed} rows raw` : ""}${
          result.matched !== null ? `, ${result.matched} partidos ligados` : ""
        }${
          result.unmatched !== null ? `, ${result.unmatched} pendientes por revisar` : ""
        }.`,
      );
    } catch (error) {
      setState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : "No se pudieron bajar los odds",
      }));
    } finally {
      setSaving(null);
    }
  }

  function renderOddsCard() {
    return (
      <section className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-ink">Get odds</p>
            <p className="mt-2 text-sm text-steel">
              Jala The Odds API, guarda raw de Liga MX para los proximos dias y luego lo liga
              contra la app. Si el juego no existe, lo crea automaticamente en la base.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handlePullOdds()}
            disabled={saving === "odds-pull"}
            className="primary-button disabled:opacity-60"
          >
            {saving === "odds-pull" ? "Bajando..." : "Get odds"}
          </button>
        </div>

        {oddsPullResult ? (
          <div className="space-y-4">
            <p className="font-medium text-ink">
              Snapshot {oddsPullResult.snapshot_date ?? "sin fecha detectada"}
            </p>
            <p className="mt-1 text-sm text-steel">
              {oddsPullResult.raw_rows_processed ?? 0} filas raw · {oddsPullResult.matched ?? 0} ligadas ·{" "}
              {oddsPullResult.unmatched ?? 0} pendientes
            </p>
            {oddsPullResult.preview_rows.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm text-steel">
                  <thead className="border-b border-white/8 text-xs uppercase tracking-[0.15em] text-ink">
                    <tr>
                      <th className="px-4 py-3">Fecha</th>
                      <th className="px-4 py-3">Local</th>
                      <th className="px-4 py-3">Visitante</th>
                      <th className="px-4 py-3">ML Home</th>
                      <th className="px-4 py-3">ML Draw</th>
                      <th className="px-4 py-3">ML Away</th>
                    </tr>
                  </thead>
                  <tbody>
                    {oddsPullResult.preview_rows.map((row) => (
                      <tr
                        key={`${row.match_date}-${row.home_team}-${row.away_team}`}
                        className="border-b border-white/5"
                      >
                        <td className="px-4 py-3">{formatMexicoCityDateTime(row.match_date)}</td>
                        <td className="px-4 py-3">{row.home_team}</td>
                        <td className="px-4 py-3">{row.away_team}</td>
                        <td className="px-4 py-3">{row.ml_home ?? "-"}</td>
                        <td className="px-4 py-3">{row.ml_draw ?? "-"}</td>
                        <td className="px-4 py-3">{row.ml_away ?? "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            <details className="text-sm text-steel">
              <summary className="cursor-pointer text-ink">Ver salida tecnica</summary>
              <pre className="mt-3 overflow-x-auto whitespace-pre-wrap px-4 py-3 text-xs text-steel">
                {oddsPullResult.pull_output}
                {"\n\n"}
                {oddsPullResult.sync_output}
              </pre>
            </details>
          </div>
        ) : (
          <p className="text-sm text-steel">
            El boton primero baja The Odds API a raw y despues sincroniza partidos futuros +
            odds contra la app.
          </p>
        )}
      </section>
    );
  }

  function renderSeasonsCard() {
    return (
      <section className="space-y-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-ink">
              {state.editingSeasonId ? "Editar temporada" : "Crear temporada"}
            </p>
          </div>
          {state.editingSeasonId ? (
            <button
              onClick={() => {
                setState((current) => ({ ...current, editingSeasonId: null }));
                setSeasonForm(initialSeasonForm);
              }}
              className="secondary-button"
            >
              Cancelar
            </button>
          ) : null}
        </div>
        <form onSubmit={handleSaveSeason} className="mt-5 space-y-4">
          <input
            value={seasonForm.name}
            onChange={(event) => setSeasonForm((current) => ({ ...current, name: event.target.value }))}
            placeholder="Clausura 2026"
            className="field-control"
            required
          />
          <input
            value={seasonForm.slug}
            onChange={(event) => setSeasonForm((current) => ({ ...current, slug: event.target.value }))}
            placeholder="clausura-2026"
            className="field-control"
            required
          />
          <label className="flex items-center gap-3 text-sm text-ink">
            <input
              type="checkbox"
              checked={seasonForm.is_active}
              onChange={(event) =>
                setSeasonForm((current) => ({ ...current, is_active: event.target.checked }))
              }
            />
            Marcar como temporada activa
          </label>
          <button type="submit" disabled={saving === "season"} className="primary-button disabled:opacity-60">
            {saving === "season"
              ? "Guardando..."
              : state.editingSeasonId
                ? "Actualizar temporada"
                : "Crear temporada"}
          </button>
        </form>

        <div className="space-y-2">
          {state.seasons.map((season) => (
            <div key={season.id} className="border-t border-white/8 px-1 py-3">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-medium text-ink">{season.name}</p>
                  <p className="mt-1 text-sm text-steel">
                    {season.slug} {season.is_active ? "· activa" : "· historica"}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => beginEditSeason(season)}
                    className="secondary-button px-4 py-2"
                  >
                    Editar
                  </button>
                  {!season.is_active ? (
                    <button
                      type="button"
                      onClick={() => void handleSetActiveSeason(season)}
                      disabled={saving === `season:${season.id}`}
                      className="secondary-button"
                    >
                      {saving === `season:${season.id}` ? "Activando..." : "Activar"}
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    );
  }

  function renderTeamsCard() {
    return (
      <section className="space-y-5">
        <p className="text-sm font-semibold uppercase tracking-[0.22em] text-ink">Equipos</p>
        <form onSubmit={handleCreateTeam} className="grid gap-4 md:grid-cols-2">
          <input
            value={teamForm.name}
            onChange={(event) => setTeamForm((current) => ({ ...current, name: event.target.value }))}
            placeholder="America"
            className="field-control"
            required
          />
          <input
            value={teamForm.short_name}
            onChange={(event) =>
              setTeamForm((current) => ({ ...current, short_name: event.target.value.toUpperCase() }))
            }
            placeholder="AME"
            className="field-control"
            required
          />
          <input
            value={teamForm.slug}
            onChange={(event) => setTeamForm((current) => ({ ...current, slug: event.target.value }))}
            placeholder="america"
            className="field-control"
            required
          />
          <input
            value={teamForm.external_id}
            onChange={(event) => setTeamForm((current) => ({ ...current, external_id: event.target.value }))}
            placeholder="ASA o id del proveedor"
            className="field-control"
          />
          <input
            value={teamForm.crest_url}
            onChange={(event) => setTeamForm((current) => ({ ...current, crest_url: event.target.value }))}
            placeholder="crest_url opcional"
            className="field-control md:col-span-2"
          />
          <button type="submit" disabled={saving === "team"} className="primary-button w-fit disabled:opacity-60">
            {saving === "team" ? "Guardando..." : "Crear equipo"}
          </button>
        </form>

        <div className="grid gap-2 md:grid-cols-2">
          {state.teams.map((team) => (
            <div key={team.id} className="border-t border-white/8 px-1 py-3">
              <p className="font-medium text-ink">{team.name}</p>
              <p className="mt-1 text-sm text-steel">
                {team.short_name} · {team.slug}
              </p>
            </div>
          ))}
        </div>
      </section>
    );
  }

  function renderMatchdaysCard() {
    return (
      <section className="space-y-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-ink">
              {state.editingMatchdayId ? "Editar jornada" : "Crear jornada"}
            </p>
          </div>
          {state.editingMatchdayId ? (
            <button
              onClick={() => {
                setState((current) => ({ ...current, editingMatchdayId: null }));
                setMatchdayForm((current) => ({
                  ...initialMatchdayForm,
                  season_id: current.season_id || state.seasons.find((season) => season.is_active)?.id || "",
                }));
              }}
              className="secondary-button"
            >
              Cancelar
            </button>
          ) : null}
        </div>

        <form onSubmit={handleSaveMatchday} className="space-y-4">
          <select
            value={matchdayForm.season_id}
            onChange={(event) => setMatchdayForm((current) => ({ ...current, season_id: event.target.value }))}
            className="field-control"
            required
          >
            <option value="">Selecciona temporada</option>
            {state.seasons.map((season) => (
              <option key={season.id} value={season.id}>
                {season.name}
              </option>
            ))}
          </select>
          <div className="grid gap-4 md:grid-cols-3">
            <input
              value={matchdayForm.number}
              onChange={(event) => setMatchdayForm((current) => ({ ...current, number: event.target.value }))}
              placeholder="Numero"
              className="field-control"
              required
            />
            <input
              value={matchdayForm.name}
              onChange={(event) => setMatchdayForm((current) => ({ ...current, name: event.target.value }))}
              placeholder="Jornada 1"
              className="field-control md:col-span-2"
              required
            />
          </div>
          <label className="space-y-2 text-sm">
            <span className="text-steel">Cierre automatico por defecto</span>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min={-1000000}
                max={1000000}
                value={matchdayForm.default_lock_offset_minutes}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  setMatchdayForm((current) => ({
                    ...current,
                    default_lock_offset_minutes: nextValue,
                  }));
                  setAutoLockOffsetMinutes(Number(nextValue) || 0);
                }}
                className="field-control w-32"
                required
              />
              <span className="text-steel">min antes del partido</span>
            </div>
            <p className="text-xs text-steel">
              Positivo cierra antes del kickoff. Negativo reabre picks historicos empujando el cierre hacia el futuro.
            </p>
          </label>
          <select
            value={matchdayForm.status}
            onChange={(event) =>
              setMatchdayForm((current) => ({
                ...current,
                status: event.target.value as MatchdayStatus,
              }))
            }
            className="field-control"
          >
            <option value="draft">Draft</option>
            <option value="active">Active</option>
            <option value="closed">Closed</option>
            <option value="published">Published</option>
          </select>
          <div className="grid gap-4 md:grid-cols-2">
            <input
              type="datetime-local"
              value={matchdayForm.starts_at}
              onChange={(event) => setMatchdayForm((current) => ({ ...current, starts_at: event.target.value }))}
              className="field-control"
              required
            />
            <input
              type="datetime-local"
              value={matchdayForm.ends_at}
              onChange={(event) => setMatchdayForm((current) => ({ ...current, ends_at: event.target.value }))}
              className="field-control"
              required
            />
          </div>
          <button type="submit" disabled={saving === "matchday"} className="primary-button disabled:opacity-60">
            {saving === "matchday"
              ? "Guardando..."
              : state.editingMatchdayId
                ? "Actualizar jornada"
                : "Crear jornada"}
          </button>
        </form>

        <div className="space-y-2">
          {state.matchdays.map((matchday) => (
            <button
              key={matchday.id}
              onClick={() => beginEditMatchday(matchday)}
              className="block w-full border-t border-white/8 px-1 py-3 text-left transition hover:text-ink"
            >
              <p className="font-medium text-ink">{matchday.name}</p>
              <p className="mt-1 text-sm text-steel">
                #{matchday.number} · {matchday.status} · cierre auto {matchday.default_lock_offset_minutes} min
              </p>
            </button>
          ))}
        </div>
      </section>
    );
  }

  function renderMatchesCard() {
    return (
      <section className="space-y-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-ink">
              {state.editingMatchId ? "Editar partido" : "Crear partido"}
            </p>
          </div>
          {state.editingMatchId ? (
            <button
              onClick={() => {
                setState((current) => ({ ...current, editingMatchId: null }));
                setMatchForm((current) => ({
                  ...initialMatchForm,
                  matchday_id: current.matchday_id || state.selectedMatchdayId,
                }));
              }}
              className="secondary-button"
            >
              Cancelar
            </button>
          ) : null}
        </div>

        <div className="mt-4">
          <select
            value={state.selectedMatchdayId}
            onChange={(event) => void handleChangeMatchday(event.target.value)}
            className="field-control"
          >
            <option value="">Selecciona jornada para ver partidos</option>
            {state.matchdays.map((matchday) => (
              <option key={matchday.id} value={matchday.id}>
                {matchday.name}
              </option>
            ))}
          </select>
        </div>

        <form onSubmit={handleSaveMatch} className="space-y-4">
          <select
            value={matchForm.matchday_id}
            onChange={(event) => {
              const nextMatchdayId = event.target.value;
              const selectedMatchday = state.matchdays.find((matchday) => matchday.id === nextMatchdayId);
              if (selectedMatchday) {
                setAutoLockOffsetMinutes(selectedMatchday.default_lock_offset_minutes);
              }
              setMatchForm((current) => ({ ...current, matchday_id: nextMatchdayId }));
            }}
            className="field-control"
            required
          >
            <option value="">Selecciona jornada</option>
            {state.matchdays.map((matchday) => (
              <option key={matchday.id} value={matchday.id}>
                {matchday.name}
              </option>
            ))}
          </select>
          <div className="grid gap-4 md:grid-cols-2">
            <select
              value={matchForm.home_team_id}
              onChange={(event) => setMatchForm((current) => ({ ...current, home_team_id: event.target.value }))}
              className="field-control"
              required
            >
              <option value="">Equipo local</option>
              {state.teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
            <select
              value={matchForm.away_team_id}
              onChange={(event) => setMatchForm((current) => ({ ...current, away_team_id: event.target.value }))}
              className="field-control"
              required
            >
              <option value="">Equipo visitante</option>
              {state.teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2 text-sm">
              <span className="text-steel">Hora del partido</span>
              <input
                type="datetime-local"
                value={matchForm.kickoff_at}
                onChange={(event) => {
                  const nextKickoffAt = event.target.value;
                  setMatchForm((current) => ({
                    ...current,
                    kickoff_at: nextKickoffAt,
                    picks_lock_at: shiftMexicoCityInputValue(nextKickoffAt, -autoLockOffsetMinutes),
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
                value={matchForm.picks_lock_at}
                onChange={(event) =>
                  setMatchForm((current) => ({ ...current, picks_lock_at: event.target.value }))
                }
                className="field-control"
                required
              />
            </label>
          </div>
          <p className="text-xs text-steel">
            El cierre se calcula automaticamente con el valor definido en la jornada.
          </p>
          <input
            value={matchForm.venue}
            onChange={(event) => setMatchForm((current) => ({ ...current, venue: event.target.value }))}
            placeholder="Estadio"
            className="field-control"
          />
          <div className="grid gap-4 md:grid-cols-2">
            <select
              value={matchForm.status}
              onChange={(event) => setMatchForm((current) => ({ ...current, status: event.target.value }))}
              className="field-control"
            >
              <option value="scheduled">Scheduled</option>
              <option value="final">Final</option>
              <option value="postponed">Postponed</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <input
              value={matchForm.external_id}
              onChange={(event) => setMatchForm((current) => ({ ...current, external_id: event.target.value }))}
              placeholder="Codigo unico del proveedor"
              className="field-control"
            />
          </div>
          <button type="submit" disabled={saving === "match"} className="primary-button disabled:opacity-60">
            {saving === "match"
              ? "Guardando..."
              : state.editingMatchId
                ? "Actualizar partido"
                : "Crear partido"}
          </button>
        </form>

        <div className="space-y-2">
          {state.matches.map((match) => (
            <button
              key={match.id}
              onClick={() => beginEditMatch(match)}
              className="block w-full border-t border-white/8 px-1 py-3 text-left transition hover:text-ink"
            >
              <p className="font-medium text-ink">
                {match.home_team_name} vs {match.away_team_name}
              </p>
              <p className="mt-1 text-sm text-steel">
                {formatMexicoCityDateTime(match.kickoff_at)} · {match.match_key}
              </p>
              <p className="mt-1 text-xs uppercase tracking-[0.2em] text-steel">
                {match.external_id ?? "Sin external_id"} · {match.status}
              </p>
            </button>
          ))}
          {state.selectedMatchdayId && state.matches.length === 0 ? (
            <p className="text-sm text-steel">Todavia no hay partidos en esa jornada.</p>
          ) : null}
        </div>
      </section>
    );
  }

  if (loading) {
    return <p className="text-sm text-steel">Cargando admin...</p>;
  }

  const isAdmin = state.me?.role_code === "admin" || state.me?.role_code === "master_admin";

  if (!isAdmin) {
    return (
      <section>
        <p className="text-sm text-coral">
          Tu usuario no tiene permisos de admin. En desarrollo, al refrescar la sesion deberia
          promocionarse el primer usuario si no existe otro admin.
        </p>
      </section>
    );
  }

  const tabs: { id: AdminTab; label: string }[] = [
    { id: "odds", label: "Get odds" },
    { id: "seasons", label: "Temporadas" },
    { id: "teams", label: "Equipos" },
    { id: "matchdays", label: "Jornadas" },
    { id: "matches", label: "Partidos" },
  ];
  const activeTabLabel = tabs.find((tab) => tab.id === activeTab)?.label ?? "Menu";

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <p className="text-[10px] uppercase tracking-[0.3em] text-steel">Admin Room</p>
        <h1 className="text-xl font-semibold text-ink">Calendario y operacion</h1>
        <p className="mt-3 max-w-2xl text-sm text-steel">
          Crea la temporada, alta de equipos, arma la jornada y ajusta los partidos sin romper su
          identidad interna.
        </p>
      </section>

      {message ? <p className="text-sm text-moss">{message}</p> : null}
      {state.error ? <p className="text-sm text-coral">{state.error}</p> : null}

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold uppercase tracking-[0.22em] text-steel">{activeTabLabel}</p>
          <button
            type="button"
            onClick={() => setIsTabMenuOpen((current) => !current)}
            className="rounded-full border border-white/8 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-steel transition hover:text-ink md:hidden"
          >
            Menu
          </button>
        </div>

        <div className="hidden flex-wrap gap-2 md:flex">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={
                activeTab === tab.id
                  ? "rounded-full border border-coral/35 bg-white/[0.05] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-ink"
                  : "rounded-full border border-white/8 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-steel transition hover:text-ink"
              }
            >
              {tab.label}
            </button>
          ))}
        </div>

        {isTabMenuOpen ? (
          <div className="grid grid-cols-2 gap-2 md:hidden">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setActiveTab(tab.id);
                  setIsTabMenuOpen(false);
                }}
                className={
                  activeTab === tab.id
                    ? "rounded-full border border-coral/35 bg-white/[0.05] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-ink"
                    : "rounded-full border border-white/8 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-steel"
                }
              >
                {tab.label}
              </button>
            ))}
          </div>
        ) : null}
      </section>

      {activeTab === "odds" ? renderOddsCard() : null}
      {activeTab === "seasons" ? renderSeasonsCard() : null}
      {activeTab === "teams" ? renderTeamsCard() : null}
      {activeTab === "matchdays" ? renderMatchdaysCard() : null}
      {activeTab === "matches" ? renderMatchesCard() : null}
    </div>
  );
}
