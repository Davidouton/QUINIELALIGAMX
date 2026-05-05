"use client";

import { useEffect, useMemo, useState } from "react";

import { backendFetch } from "@/lib/api/backend";
import { getBrowserAccessToken } from "@/lib/supabase/session";
import type { AdminPickRow, Matchday, PickSelection, Season } from "@/types/api";

type DraftState = {
  predicted_home_score: string;
  predicted_away_score: string;
  admin_override_note: string;
};

const initialDraft: DraftState = {
  predicted_home_score: "",
  predicted_away_score: "",
  admin_override_note: "",
};

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

function sanitizeScoreInput(value: string) {
  return value.replace(/\D/g, "").slice(0, 2);
}

function deriveSelection(homeScore: string, awayScore: string): PickSelection | null {
  if (homeScore === "" || awayScore === "") {
    return null;
  }
  const home = Number(homeScore);
  const away = Number(awayScore);
  if (Number.isNaN(home) || Number.isNaN(away)) {
    return null;
  }
  if (home > away) {
    return "home";
  }
  if (away > home) {
    return "away";
  }
  return "draw";
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

function formatMexicoCityDateTime(value: string | null) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Fecha invalida";
  }

  return new Intl.DateTimeFormat("es-MX", {
    timeZone: "America/Mexico_City",
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function rowKey(row: Pick<AdminPickRow, "profile_id" | "match_id">) {
  return `${row.profile_id}:${row.match_id}`;
}

function toDraft(row: AdminPickRow): DraftState {
  return {
    predicted_home_score: row.predicted_home_score === null ? "" : String(row.predicted_home_score),
    predicted_away_score: row.predicted_away_score === null ? "" : String(row.predicted_away_score),
    admin_override_note: row.admin_override_note ?? "",
  };
}

export function AdminPicksPanel() {
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [matchdays, setMatchdays] = useState<Matchday[]>([]);
  const [selectedSeasonId, setSelectedSeasonId] = useState("");
  const [selectedMatchdayId, setSelectedMatchdayId] = useState("");
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [rows, setRows] = useState<AdminPickRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, DraftState>>({});
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const seasonMatchdays = useMemo(
    () =>
      matchdays
        .filter((matchday) => !selectedSeasonId || matchday.season_id === selectedSeasonId)
        .sort((left, right) => left.number - right.number),
    [matchdays, selectedSeasonId],
  );

  const profileOptions = useMemo(() => {
    const profiles = new Map<string, string>();
    rows.forEach((row) => {
      if (!profiles.has(row.profile_id)) {
        profiles.set(row.profile_id, row.profile_display_name);
      }
    });

    return Array.from(profiles.entries())
      .map(([profileId, displayName]) => ({ profileId, displayName }))
      .sort((left, right) => left.displayName.localeCompare(right.displayName, "es-MX"));
  }, [rows]);

  const filteredRows = useMemo(() => {
    const byProfile = selectedProfileId ? rows.filter((row) => row.profile_id === selectedProfileId) : rows;
    const normalized = searchTerm.trim().toLowerCase();
    if (!normalized) {
      return byProfile;
    }

    return byProfile.filter((row) =>
      [
        row.profile_display_name,
        row.home_team_name,
        row.away_team_name,
        row.admin_override_note ?? "",
        row.overridden_by_display_name ?? "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalized),
    );
  }, [rows, searchTerm, selectedProfileId]);

  useEffect(() => {
    if (selectedProfileId && !rows.some((row) => row.profile_id === selectedProfileId)) {
      setSelectedProfileId("");
    }
  }, [rows, selectedProfileId]);

  async function loadRows(matchdayId: string, accessToken?: string) {
    if (!matchdayId) {
      setRows([]);
      setDrafts({});
      return;
    }

    const token = accessToken ?? (await getBrowserAccessToken());
    const data = await backendFetch<AdminPickRow[]>(`/admin/picks?matchday_id=${matchdayId}`, token);
    setRows(data);
    setDrafts(Object.fromEntries(data.map((row) => [rowKey(row), toDraft(row)])));
  }

  async function loadPanel() {
    const accessToken = await getBrowserAccessToken();
    const [seasonRows, matchdayRows] = await Promise.all([
      backendFetch<Season[]>("/seasons", accessToken),
      backendFetch<Matchday[]>("/matchdays", accessToken),
    ]);

    const defaultSeason = seasonRows.find((season) => season.is_active) ?? seasonRows[0] ?? null;
    const defaultMatchday = pickPreferredMatchday(
      defaultSeason
        ? matchdayRows.filter((matchday) => matchday.season_id === defaultSeason.id)
        : matchdayRows,
    );

    setSeasons(seasonRows);
    setMatchdays(matchdayRows);
    setSelectedSeasonId(defaultSeason?.id ?? "");
    setSelectedMatchdayId(defaultMatchday?.id ?? "");
    await loadRows(defaultMatchday?.id ?? "", accessToken);
  }

  useEffect(() => {
    async function runLoad() {
      try {
        await loadPanel();
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "No se pudieron cargar los picks admin");
      } finally {
        setLoading(false);
      }
    }

    void runLoad();
  }, []);

  async function handleSeasonChange(seasonId: string) {
    setSelectedSeasonId(seasonId);
    setError(null);
    setMessage(null);
    setLoading(true);
    try {
      const nextMatchday = pickPreferredMatchday(matchdays.filter((matchday) => matchday.season_id === seasonId));
      setSelectedMatchdayId(nextMatchday?.id ?? "");
      await loadRows(nextMatchday?.id ?? "");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudieron cargar los picks del torneo");
    } finally {
      setLoading(false);
    }
  }

  async function handleMatchdayChange(matchdayId: string) {
    setSelectedMatchdayId(matchdayId);
    setError(null);
    setMessage(null);
    setLoading(true);
    try {
      await loadRows(matchdayId);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudieron cargar los picks de la jornada");
    } finally {
      setLoading(false);
    }
  }

  function updateDraft(key: string, patch: Partial<DraftState>) {
    setDrafts((current) => ({
      ...current,
      [key]: { ...(current[key] ?? initialDraft), ...patch },
    }));
  }

  async function handleSaveOverride(row: AdminPickRow) {
    const key = rowKey(row);
    const draft = drafts[key] ?? initialDraft;
    const selection = deriveSelection(draft.predicted_home_score, draft.predicted_away_score);

    if (!selection) {
      setError("Captura ambos marcadores para guardar el override.");
      return;
    }

    setSavingKey(key);
    setError(null);
    setMessage(null);
    try {
      const accessToken = await getBrowserAccessToken();
      await backendFetch<AdminPickRow>("/admin/picks/override", accessToken, {
        method: "POST",
        body: JSON.stringify({
          profile_id: row.profile_id,
          match_id: row.match_id,
          selection,
          predicted_home_score: Number(draft.predicted_home_score),
          predicted_away_score: Number(draft.predicted_away_score),
          admin_override_note: draft.admin_override_note || null,
        }),
      });
      await loadRows(selectedMatchdayId, accessToken);
      setMessage(`${row.profile_display_name}: pick overrideado.`);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo guardar el override");
    } finally {
      setSavingKey(null);
    }
  }

  const overrideCount = filteredRows.filter((row) => row.is_admin_override).length;
  const missingCount = filteredRows.filter((row) => !row.has_pick).length;
  const selectedSeason = seasons.find((season) => season.id === selectedSeasonId) ?? null;

  return (
    <section className="space-y-5">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,220px)_minmax(0,220px)_minmax(0,260px)_minmax(0,1fr)]">
        <label className="space-y-1.5 text-xs">
          <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-steel">Temporada</span>
          <select value={selectedSeasonId} onChange={(event) => void handleSeasonChange(event.target.value)} className="field-control text-xs">
            <option value="">Selecciona temporada</option>
            {seasons.map((season) => (
              <option key={season.id} value={season.id}>
                {season.name}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1.5 text-xs">
          <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-steel">Jornada</span>
          <select value={selectedMatchdayId} onChange={(event) => void handleMatchdayChange(event.target.value)} className="field-control text-xs">
            <option value="">Selecciona jornada</option>
            {seasonMatchdays.map((matchday) => (
              <option key={matchday.id} value={matchday.id}>
                Jornada {matchday.number} · {selectedSeason?.name ?? "Torneo"}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1.5 text-xs">
          <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-steel">Usuario</span>
          <select
            value={selectedProfileId}
            onChange={(event) => setSelectedProfileId(event.target.value)}
            className="field-control text-xs"
          >
            <option value="">Todos los usuarios</option>
            {profileOptions.map((profile) => (
              <option key={profile.profileId} value={profile.profileId}>
                {profile.displayName}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1.5 text-xs">
          <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-steel">Buscar</span>
          <input
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Jugador, partido, nota..."
            className="field-control text-xs"
          />
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="surface-card px-4 py-3">
          <p className="text-[10px] uppercase tracking-[0.18em] text-steel">Filas visibles</p>
          <p className="mt-2 text-2xl font-semibold text-ink">{filteredRows.length}</p>
        </div>
        <div className="surface-card px-4 py-3">
          <p className="text-[10px] uppercase tracking-[0.18em] text-steel">Overrideados</p>
          <p className="mt-2 text-2xl font-semibold text-amber-100">{overrideCount}</p>
        </div>
        <div className="surface-card px-4 py-3">
          <p className="text-[10px] uppercase tracking-[0.18em] text-steel">Sin pick</p>
          <p className="mt-2 text-2xl font-semibold text-coral">{missingCount}</p>
        </div>
      </div>

      {error ? <p className="text-sm text-coral">{error}</p> : null}
      {message ? <p className="text-sm text-emerald-200">{message}</p> : null}
      {loading ? <p className="text-sm text-steel">Cargando picks admin...</p> : null}

      {!loading && filteredRows.length === 0 ? (
        <p className="text-sm text-steel">No hay filas para la jornada seleccionada.</p>
      ) : null}

      {!loading && filteredRows.length > 0 ? (
        <div className="no-scrollbar overflow-x-auto touch-pan-x">
          <table className="min-w-[1320px] text-left text-sm text-steel">
            <thead className="app-table-head">
              <tr>
                <th className="px-3 py-2">Jugador</th>
                <th className="px-3 py-2">Partido</th>
                <th className="px-3 py-2">Inicio</th>
                <th className="px-3 py-2">Cierre</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2">Marcador</th>
                <th className="px-3 py-2">Pick</th>
                <th className="px-3 py-2">Nota admin</th>
                <th className="px-3 py-2">Rastro</th>
                <th className="px-3 py-2 text-center">Accion</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => {
                const key = rowKey(row);
                const draft = drafts[key] ?? initialDraft;
                const selection = deriveSelection(draft.predicted_home_score, draft.predicted_away_score);

                return (
                  <tr key={key} className="app-table-row border-b align-top last:border-b-0">
                    <td className="px-3 py-3">
                      <p className="font-semibold text-ink">{row.profile_display_name}</p>
                      <p className="mt-1 text-[11px] text-steel">{row.has_pick ? "Con pick" : "Sin pick"}</p>
                    </td>
                    <td className="px-3 py-3">
                      <p className="font-semibold text-ink">{row.home_team_name} vs {row.away_team_name}</p>
                      <p className="mt-1 text-[11px] text-steel">{row.match_status}</p>
                    </td>
                    <td className="px-3 py-3 text-[12px] text-ink">{formatMexicoCityDateTime(row.kickoff_at)}</td>
                    <td className="px-3 py-3 text-[12px] text-ink">{formatMexicoCityDateTime(row.picks_lock_at)}</td>
                    <td className="px-3 py-3">
                      <p className={`font-semibold ${row.is_locked ? "text-coral" : "text-emerald-200"}`}>
                        {row.is_locked ? "Cerrado" : "Abierto"}
                      </p>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <input
                          value={draft.predicted_home_score}
                          onChange={(event) => updateDraft(key, { predicted_home_score: sanitizeScoreInput(event.target.value) })}
                          className="field-control h-9 w-14 px-2 text-center text-xs"
                          inputMode="numeric"
                          placeholder="-"
                        />
                        <span className="text-steel">-</span>
                        <input
                          value={draft.predicted_away_score}
                          onChange={(event) => updateDraft(key, { predicted_away_score: sanitizeScoreInput(event.target.value) })}
                          className="field-control h-9 w-14 px-2 text-center text-xs"
                          inputMode="numeric"
                          placeholder="-"
                        />
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <p className="font-semibold text-ink">{getSelectionLabel(selection)}</p>
                      {row.selection ? <p className="mt-1 text-[11px] text-steel">Actual: {getSelectionLabel(row.selection)}</p> : null}
                    </td>
                    <td className="px-3 py-3">
                      <textarea
                        value={draft.admin_override_note}
                        onChange={(event) => updateDraft(key, { admin_override_note: event.target.value.slice(0, 220) })}
                        rows={3}
                        placeholder="Motivo o contexto visible para el usuario"
                        className="field-control min-h-[84px] resize-y py-2 text-xs"
                      />
                    </td>
                    <td className="px-3 py-3">
                      {row.is_admin_override ? (
                        <div className="space-y-1 text-[11px]">
                          <p className="font-semibold text-amber-100">Overrideado</p>
                          <p>{row.overridden_by_display_name ?? "Admin"}</p>
                          <p className="text-steel">{formatMexicoCityDateTime(row.overridden_at)}</p>
                        </div>
                      ) : (
                        <p className="text-[11px] text-steel">Sin override</p>
                      )}
                    </td>
                    <td className="px-3 py-3 text-center">
                      <button
                        type="button"
                        onClick={() => void handleSaveOverride(row)}
                        disabled={savingKey === key}
                        className="primary-button h-9 px-4 text-xs disabled:opacity-60"
                      >
                        {savingKey === key ? "Guardando..." : "Override"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
