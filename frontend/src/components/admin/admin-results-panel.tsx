"use client";

import { useEffect, useMemo, useState } from "react";

import { backendFetch } from "@/lib/api/backend";
import { formatMexicoCityDateTime } from "@/lib/datetime/mexico-city";
import { getBrowserAccessToken } from "@/lib/supabase/session";
import type { AdminResultRow, Matchday, Season } from "@/types/api";

type ResultDraft = {
  home_score: string;
  away_score: string;
  advancing_team_id: string;
  is_official: boolean;
};

const compactControlClass =
  "field-control compact-table-control h-8 min-w-0 rounded-[12px] px-3 py-1.5 text-[11px]";
const compactActionButtonClass =
  "inline-flex h-8 items-center justify-center whitespace-nowrap rounded-[12px] border px-3 text-[11px] font-semibold transition disabled:opacity-60";
const neutralActionClass =
  `${compactActionButtonClass} border-white/[0.04] bg-white/[0.03] text-ink hover:border-white/[0.08] hover:bg-white/[0.05]`;
const positiveActionClass =
  `${compactActionButtonClass} border-emerald-300/30 bg-emerald-400/16 text-emerald-50 hover:border-emerald-300/45 hover:bg-emerald-400/24`;
const dangerActionClass =
  `${compactActionButtonClass} border-red-300/35 bg-red-500/16 text-red-50 hover:border-red-300/50 hover:bg-red-500/24`;
const warningActionClass =
  `${compactActionButtonClass} border-amber-300/30 bg-amber-400/16 text-amber-50 hover:border-amber-300/45 hover:bg-amber-400/24`;
function buildDraft(result: AdminResultRow): ResultDraft {
  return {
    home_score: result.home_score === null ? "" : String(result.home_score),
    away_score: result.away_score === null ? "" : String(result.away_score),
    advancing_team_id: result.advancing_team_id ?? "",
    is_official: result.is_official,
  };
}

function isKnockoutResult(result: AdminResultRow) {
  return result.stage_type !== "regular" && result.stage_type !== "group";
}

function requiresAdvancingTeam(result: AdminResultRow, season: Season | null) {
  return season?.tournament_format === "world_cup" && isKnockoutResult(result);
}

function isResultReady(result: AdminResultRow) {
  return result.is_ready_for_picks;
}

function shouldAutoMarkOfficial(nextHomeScore: string, nextAwayScore: string, currentDraft: ResultDraft) {
  return !currentDraft.is_official && nextHomeScore !== "" && nextAwayScore !== "";
}

function getStatusPillClass(isPositive: boolean) {
  return isPositive
    ? "inline-flex h-8 items-center justify-center rounded-[12px] border border-emerald-300/30 bg-emerald-400/16 px-3 text-[11px] font-semibold text-emerald-50"
    : "inline-flex h-8 items-center justify-center rounded-[12px] border border-red-300/35 bg-red-500/16 px-3 text-[11px] font-semibold text-red-50";
}

function pickDefaultMatchday(matchdays: Matchday[], seasonId?: string) {
  const scopedMatchdays = matchdays
    .filter((matchday) => (seasonId ? matchday.season_id === seasonId : true))
    .sort((left, right) => right.number - left.number);

  if (scopedMatchdays.length === 0) {
    return "";
  }

  return (
    scopedMatchdays.find((matchday) => matchday.status === "active")?.id ||
    scopedMatchdays.find((matchday) => matchday.status === "published")?.id ||
    scopedMatchdays.find((matchday) => matchday.status === "closed")?.id ||
    scopedMatchdays[0]?.id ||
    ""
  );
}

export function AdminResultsPanel() {
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [matchdays, setMatchdays] = useState<Matchday[]>([]);
  const [selectedSeasonId, setSelectedSeasonId] = useState("");
  const [selectedMatchdayId, setSelectedMatchdayId] = useState("");
  const [results, setResults] = useState<AdminResultRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, ResultDraft>>({});
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [savingMatchId, setSavingMatchId] = useState<string | null>(null);
  const [clearingResultMatchId, setClearingResultMatchId] = useState<string | null>(null);
  const [clearingMatchId, setClearingMatchId] = useState<string | null>(null);
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
  const selectedSeasonForTable = selectedSeasonId ? seasonById[selectedSeasonId] ?? null : null;
  const showAdvancingColumn = selectedSeasonForTable?.tournament_format === "world_cup";

  async function loadResults(matchdayId: string, accessToken?: string) {
    const token = accessToken ?? (await getBrowserAccessToken());
    const suffix = matchdayId ? `?matchday_id=${matchdayId}` : "";
    const rows = await backendFetch<AdminResultRow[]>(`/admin/results${suffix}`, token, {
      timeoutMs: 30000,
    });
    setResults(rows);
    setDrafts(Object.fromEntries(rows.map((row) => [row.match_id, buildDraft(row)])));
  }

  async function loadPanel() {
    const accessToken = await getBrowserAccessToken();
    const [seasonRows, matchdayRows] = await Promise.all([
      backendFetch<Season[]>("/seasons", accessToken),
      backendFetch<Matchday[]>("/matchdays", accessToken),
    ]);
    const defaultSeasonId = seasonRows.find((season) => season.is_active)?.id || seasonRows[0]?.id || "";
    const defaultMatchdayId =
      pickDefaultMatchday(matchdayRows, defaultSeasonId) || pickDefaultMatchday(matchdayRows);

    setSeasons(seasonRows);
    setMatchdays(matchdayRows);
    setSelectedSeasonId(defaultSeasonId);
    setSelectedMatchdayId(defaultMatchdayId);
    await loadResults(defaultMatchdayId, accessToken);
  }

  useEffect(() => {
    async function runLoad() {
      try {
        await loadPanel();
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "No se pudieron cargar los resultados");
      } finally {
        setLoading(false);
      }
    }

    void runLoad();
  }, []);

  async function handleMatchdayChange(nextMatchdayId: string) {
    setSelectedMatchdayId(nextMatchdayId);
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      await loadResults(nextMatchdayId);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudieron cargar los resultados");
    } finally {
      setLoading(false);
    }
  }

  function updateDraft(matchId: string, patch: Partial<ResultDraft>) {
    setDrafts((current) => ({
      ...current,
      [matchId]: {
        ...(current[matchId] ?? { home_score: "", away_score: "", is_official: true }),
        ...patch,
      },
    }));
  }

  async function refreshCurrentRows(accessToken?: string) {
    await loadResults(selectedMatchdayId, accessToken);
  }

  function applySavedRows(savedRows: AdminResultRow[]) {
    setResults((currentRows) =>
      currentRows.map((currentRow) => {
        const savedRow = savedRows.find((row) => row.match_id === currentRow.match_id);
        return savedRow ?? currentRow;
      }),
    );
    setDrafts((currentDrafts) => ({
      ...currentDrafts,
      ...Object.fromEntries(savedRows.map((row) => [row.match_id, buildDraft(row)])),
    }));
  }

  async function saveResultRow(row: AdminResultRow, draft: ResultDraft, accessToken: string) {
    const selectedSeason = seasonById[selectedSeasonId] ?? null;
    return backendFetch<AdminResultRow>(`/admin/results/${row.match_id}`, accessToken, {
      method: "PUT",
      body: JSON.stringify({
        home_score: Number(draft.home_score),
        away_score: Number(draft.away_score),
        advancing_team_id: requiresAdvancingTeam(row, selectedSeason)
          ? draft.advancing_team_id || null
          : null,
        is_official: draft.is_official,
      }),
    });
  }

  function getSaveValidationError(row: AdminResultRow, draft: ResultDraft | undefined) {
    if (!draft || draft.home_score === "" || draft.away_score === "") {
      return "Captura marcador local y visitante antes de guardar.";
    }
    if (!isResultReady(row)) {
      return "Primero define ambos equipos antes de capturar resultado.";
    }
    const selectedSeason = seasonById[selectedSeasonId] ?? null;
    if (requiresAdvancingTeam(row, selectedSeason) && !draft.advancing_team_id) {
      return "En eliminatoria directa tambien debes seleccionar el equipo que avanza.";
    }
    return null;
  }

  async function handleSave(matchId: string) {
    const draft = drafts[matchId];
    const row = results.find((result) => result.match_id === matchId);
    if (!row) {
      setError("No se encontro el partido seleccionado.");
      return;
    }
    const validationError = getSaveValidationError(row, draft);
    if (validationError) {
      setError(validationError);
      return;
    }

    setSavingMatchId(matchId);
    setError(null);
    setMessage(null);
    try {
      const accessToken = await getBrowserAccessToken();
      const savedRow = await saveResultRow(row, draft, accessToken);
      applySavedRows([savedRow]);
      try {
        await refreshCurrentRows(accessToken);
      } catch {
        // The saved row is already reflected locally; a later reload can reconcile the full table.
      }
      if (savedRow.is_published) {
        setMessage("Resultado guardado. Scoring general y VIP recalculado.");
      } else {
        setMessage("Resultado guardado. Scoring general y VIP recalculado.");
      }
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo guardar el resultado");
    } finally {
      setSavingMatchId(null);
    }
  }

  async function handleSyncResults() {
    setSyncing(true);
    setError(null);
    setMessage(null);
    try {
      const accessToken = await getBrowserAccessToken();
      const suffix = selectedMatchdayId ? `?matchday_id=${selectedMatchdayId}` : "";
      const response = await backendFetch<{ records_processed: number }>(
        `/admin/results/sync${suffix}`,
        accessToken,
        {
          method: "POST",
        },
      );
      await refreshCurrentRows(accessToken);
      setMessage(`${response.records_processed} resultados sincronizados. Scoring general y VIP recalculado.`);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudieron bajar resultados");
    } finally {
      setSyncing(false);
    }
  }

  async function handleClearOverride(matchId: string) {
    setClearingMatchId(matchId);
    setError(null);
    setMessage(null);
    try {
      const accessToken = await getBrowserAccessToken();
      await backendFetch(`/admin/results/${matchId}/clear-override`, accessToken, {
        method: "POST",
      });
      await refreshCurrentRows(accessToken);
      setMessage("Override manual quitado. Scoring general y VIP recalculado.");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo quitar el override");
    } finally {
      setClearingMatchId(null);
    }
  }

  async function handleClearResult(matchId: string) {
    const currentRow = results.find((result) => result.match_id === matchId);
    const confirmed = window.confirm(
      currentRow?.is_published
        ? "Este resultado ya estaba visible en la app. Si lo limpias, volvera a Pendiente. Continuar?"
        : "Vas a limpiar este resultado para que el partido vuelva a Pendiente. Continuar?",
    );
    if (!confirmed) {
      return;
    }

    setClearingResultMatchId(matchId);
    setError(null);
    setMessage(null);
    try {
      const accessToken = await getBrowserAccessToken();
      await backendFetch(`/admin/results/${matchId}`, accessToken, {
        method: "DELETE",
      });
      await refreshCurrentRows(accessToken);
      setMessage("Resultado limpiado. Scoring general y VIP recalculado.");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo limpiar el resultado");
    } finally {
      setClearingResultMatchId(null);
    }
  }

  async function handleRecalculate() {
    setRecalculating(true);
    setError(null);
    setMessage(null);
    try {
      const accessToken = await getBrowserAccessToken();
      const response = await backendFetch<{
        status: string;
        message?: string;
      }>(
        "/admin/results/recalculate",
        accessToken,
        { method: "POST" },
      );
      window.setTimeout(() => {
        void refreshCurrentRows(accessToken).catch((caughtError) => {
          setError(caughtError instanceof Error ? caughtError.message : "No se pudo refrescar la jornada");
        });
      }, 4000);
      setMessage(response.message ?? "Recalculo iniciado. Refresca en unos segundos para ver los cambios.");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo recalcular el scoring");
    } finally {
      setRecalculating(false);
    }
  }

  async function handlePublishMatchday() {
    if (!selectedMatchdayId) {
      setError("Selecciona una jornada primero.");
      return;
    }

    const rowsToSave = results.filter((row) => {
      const draft = drafts[row.match_id];
      if (!draft || draft.home_score === "" || draft.away_score === "") {
        return false;
      }
      const savedDraft = buildDraft(row);
      return (
        draft.home_score !== savedDraft.home_score ||
        draft.away_score !== savedDraft.away_score ||
        draft.advancing_team_id !== savedDraft.advancing_team_id ||
        draft.is_official !== savedDraft.is_official
      );
    });
    const invalidRow = rowsToSave.find((row) => getSaveValidationError(row, drafts[row.match_id]));
    if (invalidRow) {
      setError(getSaveValidationError(invalidRow, drafts[invalidRow.match_id]));
      return;
    }

    const isAlreadyPublished =
      results.some((result) => result.is_published) || selectedMatchday?.status === "published";
    const confirmed = window.confirm(
      isAlreadyPublished
        ? "Esta jornada ya estaba publicada. Si continuas, se guardaran los marcadores editados y quedaran actualizados en la app. Continuar?"
        : "Vas a publicar esta jornada en la app. Se guardaran primero los marcadores editados. Continuar?",
    );
    if (!confirmed) {
      return;
    }

    setPublishing(true);
    setError(null);
    setMessage(null);
    try {
      const accessToken = await getBrowserAccessToken();
      if (rowsToSave.length > 0) {
        const savedRows = await Promise.all(
          rowsToSave.map((row) => saveResultRow(row, drafts[row.match_id], accessToken)),
        );
        applySavedRows(savedRows);
      }
      await backendFetch(`/admin/matchdays/${selectedMatchdayId}/publish`, accessToken, {
        method: "POST",
      });
      await refreshCurrentRows(accessToken);
      setMessage(
        isAlreadyPublished
          ? "Publicacion actualizada."
          : "Jornada publicada.",
      );
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo publicar la jornada");
    } finally {
      setPublishing(false);
    }
  }

  const selectedMatchday = matchdayById[selectedMatchdayId];
  const selectedSeason = selectedMatchday ? seasonById[selectedMatchday.season_id] : null;
  const officialCount = results.filter(
    (result) => drafts[result.match_id]?.is_official ?? result.is_official,
  ).length;
  const publishedCount = results.filter((result) => result.is_published).length;
  const isSelectedMatchdayPublished =
    publishedCount > 0 || selectedMatchday?.status === "published";

  return (
    <div className="space-y-6">
      <section className="space-y-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-ink">Carga de marcadores oficiales</h2>
          </div>

          <div className="grid gap-3 sm:grid-cols-[minmax(220px,1fr)_minmax(240px,1fr)] xl:grid-cols-[minmax(220px,1fr)_minmax(240px,1fr)_auto_auto_auto]">
            <select
              value={selectedSeasonId}
              onChange={(event) => {
                const nextSeasonId = event.target.value;
                const nextMatchdayId = pickDefaultMatchday(matchdays, nextSeasonId);
                setSelectedSeasonId(nextSeasonId);
                setSelectedMatchdayId(nextMatchdayId);
                setError(null);
                setMessage(null);
                void handleMatchdayChange(nextMatchdayId);
              }}
              className="field-control"
              disabled={loading || seasons.length === 0}
            >
              <option value="" disabled>
                {loading ? "Cargando torneos..." : "Selecciona un torneo"}
              </option>
              {seasons.map((season) => (
                <option key={season.id} value={season.id}>
                  {season.name}
                </option>
              ))}
            </select>

            <select
              value={selectedMatchdayId}
              onChange={(event) => void handleMatchdayChange(event.target.value)}
              className="field-control"
              disabled={loading || matchdays.length === 0}
            >
              <option value="" disabled>
                {loading ? "Cargando jornadas..." : "Selecciona una jornada"}
              </option>
              {visibleMatchdays.map((matchday) => (
                <option key={matchday.id} value={matchday.id}>
                  {seasonById[matchday.season_id]?.name ?? "Temporada"} · Jornada {matchday.number}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => void handleSyncResults()}
              disabled={syncing || loading}
              className={`${positiveActionClass} h-11 justify-center text-sm sm:h-10 sm:text-[11px]`}
            >
              {syncing ? "Bajando..." : "Bajar resultados"}
            </button>

            <button
              type="button"
              onClick={() => void handleRecalculate()}
              disabled={recalculating || loading}
              className={`${neutralActionClass} h-11 justify-center text-sm sm:h-10 sm:text-[11px]`}
            >
              {recalculating ? "Recalculando..." : "Recalcular scoring"}
            </button>

            <button
              type="button"
              onClick={() => void handlePublishMatchday()}
              disabled={publishing || loading || !selectedMatchdayId}
              className={`${isSelectedMatchdayPublished ? warningActionClass : dangerActionClass} h-11 justify-center text-sm sm:h-10 sm:text-[11px]`}
            >
              {publishing ? "Publicando..." : isSelectedMatchdayPublished ? "Actualizar publicado" : "Publicar jornada"}
            </button>
          </div>
        </div>

        {message ? <p className="mt-4 text-sm text-moss">{message}</p> : null}
        {error ? <p className="mt-4 text-sm text-coral">{error}</p> : null}
        {isSelectedMatchdayPublished ? (
          <p className="mt-4 px-1 text-sm text-amber-50">
            Esta jornada ya esta publicada. Cualquier cambio en resultados oficiales se refleja en vivo dentro de la app.
          </p>
        ) : null}
      </section>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="space-y-1 px-3 py-2">
          <p className="text-xs uppercase tracking-[0.25em] text-steel">Jornada seleccionada</p>
          <p className="text-3xl font-semibold text-ink">
            {selectedMatchday ? `J${selectedMatchday.number}` : "--"}
          </p>
          <p className="text-sm text-steel">{selectedSeason?.name ?? "Sin temporada"}</p>
        </div>

        <div className="space-y-1 px-3 py-2">
          <p className="text-xs uppercase tracking-[0.25em] text-steel">Oficiales</p>
          <p className="text-3xl font-semibold text-ink">{officialCount}</p>
          <p className="text-sm text-steel">Partidos ya marcados para scoring.</p>
        </div>

        <div className="space-y-1 px-3 py-2">
          <p className="text-xs uppercase tracking-[0.25em] text-steel">Publicados</p>
          <p className="text-3xl font-semibold text-ink">{publishedCount}</p>
          <p className="text-sm text-steel">Resultados visibles en la app.</p>
        </div>
      </div>

      <section>
        <div className="no-scrollbar overflow-x-auto overscroll-x-contain touch-pan-x [WebkitOverflowScrolling:touch]">
          <table className={`${showAdvancingColumn ? "min-w-[1160px]" : "min-w-[1020px]"} text-left text-[11px] text-steel`}>
            <thead className="app-table-head">
              <tr>
                <th className="px-3 pb-1">Partido</th>
                <th className="px-3 pb-1">Kickoff</th>
                <th className="px-3 pb-1">Fase</th>
                <th className="px-3 pb-1">Local</th>
                <th className="px-3 pb-1">Visitante</th>
                {showAdvancingColumn ? <th className="px-3 pb-1">Avanza</th> : null}
                <th className="px-3 pb-1">Oficial</th>
                <th className="px-3 pb-1">Publicado</th>
                <th className="px-3 pb-1">Accion</th>
              </tr>
            </thead>
            <tbody>
              {results.map((result) => {
                const draft = drafts[result.match_id] ?? buildDraft(result);
                return (
                  <tr key={result.match_id} className="app-table-row border-b last:border-b-0">
                    <td className="px-3 py-3 align-middle">
                      <p className="text-sm font-semibold text-ink">
                        {result.home_team_name} vs {result.away_team_name}
                      </p>
                      <p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-steel">
                        {result.match_status} · {result.stage_type}
                      </p>
                      <p className="mt-1 text-[10px] text-steel/85">
                        Fuente:{" "}
                        {result.is_manual_override
                          ? "manual"
                          : result.source_provider_name ?? "sin proveedor"}
                      </p>
                      {!result.is_ready_for_picks ? (
                        <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-100">
                          Llave sembrada, equipos pendientes
                        </p>
                      ) : null}
                    </td>
                    <td className="px-3 py-3 align-middle text-xs text-steel">
                      {formatMexicoCityDateTime(result.kickoff_at)}
                    </td>
                    <td className="px-3 py-3 align-middle text-xs text-steel">
                      {result.group_label
                        ? `Grupo ${result.group_label}`
                        : result.bracket_slot ?? result.stage_type}
                    </td>
                    <td className="px-3 py-3 align-middle">
                      <input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        step={1}
                        value={draft.home_score}
                        onChange={(event) => {
                          const nextHomeScore = event.target.value;
                          updateDraft(result.match_id, {
                            home_score: nextHomeScore,
                            is_official: shouldAutoMarkOfficial(nextHomeScore, draft.away_score, draft)
                              ? true
                              : draft.is_official,
                          });
                        }}
                        disabled={!result.is_ready_for_picks}
                        className={`${compactControlClass} w-20`}
                        placeholder="-"
                      />
                    </td>
                    <td className="px-3 py-3 align-middle">
                      <input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        step={1}
                        value={draft.away_score}
                        onChange={(event) => {
                          const nextAwayScore = event.target.value;
                          updateDraft(result.match_id, {
                            away_score: nextAwayScore,
                            is_official: shouldAutoMarkOfficial(draft.home_score, nextAwayScore, draft)
                              ? true
                              : draft.is_official,
                          });
                        }}
                        disabled={!result.is_ready_for_picks}
                        className={`${compactControlClass} w-20`}
                        placeholder="-"
                      />
                    </td>
                    {showAdvancingColumn ? (
                      <td className="px-3 py-3 align-middle">
                        {requiresAdvancingTeam(result, selectedSeasonForTable) && result.is_ready_for_picks ? (
                          <select
                            value={draft.advancing_team_id}
                            onChange={(event) =>
                              updateDraft(result.match_id, { advancing_team_id: event.target.value })
                            }
                            className={`${compactControlClass} min-w-[140px]`}
                          >
                            <option value="">Selecciona</option>
                            {result.home_team_id ? <option value={result.home_team_id}>{result.home_team_name}</option> : null}
                            {result.away_team_id ? <option value={result.away_team_id}>{result.away_team_name}</option> : null}
                          </select>
                        ) : requiresAdvancingTeam(result, selectedSeasonForTable) ? (
                          <span className="text-xs text-steel">Pendiente de definir</span>
                        ) : (
                          <span className="text-xs text-steel">No aplica</span>
                        )}
                      </td>
                    ) : null}
                    <td className="px-3 py-3 align-middle">
                      <label className="inline-flex items-center gap-2 text-xs text-ink">
                        <input
                          type="checkbox"
                          checked={draft.is_official}
                          onChange={(event) =>
                            updateDraft(result.match_id, { is_official: event.target.checked })
                          }
                          disabled={!result.is_ready_for_picks}
                          className="h-4 w-4 rounded border-white/20 bg-night/60"
                        />
                        <span className={getStatusPillClass(draft.is_official)}>
                          {draft.is_official ? "Activa" : "Pendiente"}
                        </span>
                      </label>
                    </td>
                    <td className="px-3 py-3 align-middle">
                      <span className={getStatusPillClass(result.is_published)}>
                        {result.is_published ? "Publicado" : "No publicado"}
                      </span>
                    </td>
                    <td className="px-3 py-3 align-middle">
                      <div className="flex items-center gap-2">
                        {result.home_score !== null || result.away_score !== null ? (
                          <button
                            type="button"
                            onClick={() => void handleClearResult(result.match_id)}
                            disabled={clearingResultMatchId === result.match_id}
                            className={dangerActionClass}
                          >
                            {clearingResultMatchId === result.match_id ? "Limpiando..." : "Limpiar"}
                          </button>
                        ) : null}
                        {result.is_manual_override ? (
                          <button
                            type="button"
                            onClick={() => void handleClearOverride(result.match_id)}
                            disabled={clearingMatchId === result.match_id}
                            className={warningActionClass}
                          >
                            {clearingMatchId === result.match_id ? "Quitando..." : "Quitar override"}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => void handleSave(result.match_id)}
                          disabled={savingMatchId === result.match_id || !result.is_ready_for_picks}
                          className={neutralActionClass}
                        >
                          {savingMatchId === result.match_id ? "Guardando..." : "Guardar"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {!loading && results.length === 0 ? (
          <p className="mt-4 text-sm text-steel">
            No hay partidos en esta jornada. Carga juegos en `Partidos` o cambia de jornada.
          </p>
        ) : null}
      </section>
    </div>
  );
}
