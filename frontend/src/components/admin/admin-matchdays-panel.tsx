"use client";

import { FormEvent, useEffect, useState } from "react";

import { backendFetch } from "@/lib/api/backend";
import { getBrowserAccessToken } from "@/lib/supabase/session";
import { toMexicoCityInputValue } from "@/lib/datetime/mexico-city";
import type { Matchday, MatchdayStatus, Season } from "@/types/api";

type MatchdayFormState = {
  season_id: string;
  number: string;
  name: string;
  default_lock_offset_minutes: string;
  status: MatchdayStatus;
  starts_at: string;
  ends_at: string;
};

const SHORT_DATE_FORMATTER = new Intl.DateTimeFormat("es-MX", {
  timeZone: "America/Mexico_City",
  day: "2-digit",
  month: "2-digit",
  year: "2-digit",
});

const initialMatchdayForm: MatchdayFormState = {
  season_id: "",
  number: "",
  name: "",
  default_lock_offset_minutes: "10",
  status: "draft",
  starts_at: "",
  ends_at: "",
};

function formatShortMexicoCityDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return SHORT_DATE_FORMATTER.format(parsed);
}

export function AdminMatchdaysPanel() {
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [matchdays, setMatchdays] = useState<Matchday[]>([]);
  const [selectedSeasonFilter, setSelectedSeasonFilter] = useState<string>("");
  const [matchdayForm, setMatchdayForm] = useState<MatchdayFormState>(initialMatchdayForm);
  const [editingMatchdayId, setEditingMatchdayId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingMatchdayId, setDeletingMatchdayId] = useState<string | null>(null);
  const [reopeningMatchdayId, setReopeningMatchdayId] = useState<string | null>(null);
  const [restoringMatchdayId, setRestoringMatchdayId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function loadData() {
    const [seasonRows, matchdayRows] = await Promise.all([
      backendFetch<Season[]>("/seasons"),
      backendFetch<Matchday[]>("/matchdays"),
    ]);
    setSeasons(seasonRows);
    setMatchdays(matchdayRows);
    setSelectedSeasonFilter((current) => current || seasonRows.find((season) => season.is_active)?.id || "");
    setMatchdayForm((current) => ({
      ...current,
      season_id: current.season_id || seasonRows.find((season) => season.is_active)?.id || seasonRows[0]?.id || "",
    }));
  }

  useEffect(() => {
    async function load() {
      try {
        await loadData();
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "No se pudieron cargar las jornadas");
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  const seasonsById = new Map(seasons.map((season) => [season.id, season]));
  const filteredMatchdays = matchdays.filter((matchday) =>
    selectedSeasonFilter ? matchday.season_id === selectedSeasonFilter : true,
  );

  async function handleSaveMatchday(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const accessToken = await getBrowserAccessToken();
      const payload = {
        ...matchdayForm,
        number: Number(matchdayForm.number),
        default_lock_offset_minutes: Number(matchdayForm.default_lock_offset_minutes),
      };
      const path = editingMatchdayId ? `/admin/matchdays/${editingMatchdayId}` : "/admin/matchdays";
      const method = editingMatchdayId ? "PUT" : "POST";
      await backendFetch(path, accessToken, {
        method,
        body: JSON.stringify(payload),
      });
      await loadData();
      setMatchdayForm((current) => ({ ...initialMatchdayForm, season_id: current.season_id }));
      setEditingMatchdayId(null);
      setMessage(editingMatchdayId ? "Jornada actualizada." : "Jornada creada.");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo guardar la jornada");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteMatchday(matchday: Matchday) {
    const confirmed = window.confirm(`Vas a borrar ${matchday.name}. Esta accion elimina tambien sus partidos asociados. Continuar?`);
    if (!confirmed) {
      return;
    }

    setDeletingMatchdayId(matchday.id);
    setError(null);
    setMessage(null);

    try {
      const accessToken = await getBrowserAccessToken();
      await backendFetch(`/admin/matchdays/${matchday.id}`, accessToken, {
        method: "DELETE",
      });
      await loadData();
      if (editingMatchdayId === matchday.id) {
        setEditingMatchdayId(null);
        setMatchdayForm((current) => ({
          ...initialMatchdayForm,
          season_id: current.season_id || seasons.find((season) => season.is_active)?.id || seasons[0]?.id || "",
        }));
      }
      setMessage("Jornada borrada.");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo borrar la jornada");
    } finally {
      setDeletingMatchdayId(null);
    }
  }

  async function handleReopenPicks(matchday: Matchday) {
    const confirmed = window.confirm(`Vas a reabrir los picks de ${matchday.name}. Continuar?`);
    if (!confirmed) {
      return;
    }

    setReopeningMatchdayId(matchday.id);
    setError(null);
    setMessage(null);

    try {
      const accessToken = await getBrowserAccessToken();
      const payload = await backendFetch<{ affected_matches: number }>(
        `/admin/matchdays/${matchday.id}/reopen-picks`,
        accessToken,
        { method: "POST" },
      );
      await loadData();
      setMessage(`Picks reabiertos para ${payload.affected_matches} partidos.`);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudieron reabrir los picks");
    } finally {
      setReopeningMatchdayId(null);
    }
  }

  async function handleRestorePicksLock(matchday: Matchday) {
    const confirmed = window.confirm(`Vas a cerrar los picks de ${matchday.name} y restaurar el cierre automatico. Continuar?`);
    if (!confirmed) {
      return;
    }

    setRestoringMatchdayId(matchday.id);
    setError(null);
    setMessage(null);

    try {
      const accessToken = await getBrowserAccessToken();
      const payload = await backendFetch<{ affected_matches: number }>(
        `/admin/matchdays/${matchday.id}/restore-picks-lock`,
        accessToken,
        { method: "POST" },
      );
      await loadData();
      setMessage(`Picks cerrados y cierre automatico restaurado para ${payload.affected_matches} partidos.`);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudieron cerrar los picks");
    } finally {
      setRestoringMatchdayId(null);
    }
  }

  return (
    <div className="space-y-6">
      <section className="space-y-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-ink">
              {editingMatchdayId ? "Editar jornada" : "Crear jornada"}
            </h2>
          </div>
          {editingMatchdayId ? (
            <button
              type="button"
              onClick={() => {
                setEditingMatchdayId(null);
                setMatchdayForm((current) => ({
                  ...initialMatchdayForm,
                  season_id: current.season_id || seasons.find((season) => season.is_active)?.id || "",
                }));
              }}
              className="app-pill px-4"
            >
              Cancelar
            </button>
          ) : null}
        </div>
        <form onSubmit={handleSaveMatchday} className="mt-5 space-y-4">
          <select
            value={matchdayForm.season_id}
            onChange={(event) => setMatchdayForm((current) => ({ ...current, season_id: event.target.value }))}
            className="field-control"
            required
          >
            <option value="">Selecciona temporada</option>
            {seasons.map((season) => (
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
              placeholder="Jornada 12"
              className="field-control md:col-span-2"
              required
            />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2">
              <span className="text-sm text-steel">Minutos de cierre picks</span>
              <input
                value={matchdayForm.default_lock_offset_minutes}
                onChange={(event) =>
                  setMatchdayForm((current) => ({ ...current, default_lock_offset_minutes: event.target.value }))
                }
                type="number"
                min={-1000000}
                max={1000000}
                className="field-control"
                required
              />
            </label>
            <label className="space-y-2">
              <span className="text-sm text-steel">Estado de la jornada</span>
              <select
                value={matchdayForm.status}
                onChange={(event) =>
                  setMatchdayForm((current) => ({ ...current, status: event.target.value as MatchdayStatus }))
                }
                className="field-control"
              >
                <option value="draft">Draft</option>
                <option value="active">Active</option>
                <option value="closed">Closed</option>
                <option value="published">Published</option>
              </select>
            </label>
          </div>
          <div className="space-y-2 text-sm text-steel">
            <div className="flex flex-wrap gap-2">
              <span className="inline-flex px-2 py-1 text-[11px] text-steel">
                `+10` = cierra 10 min antes del kickoff
              </span>
              <span className="inline-flex px-2 py-1 text-[11px] text-steel">
                `0` = cierra al arrancar el partido
              </span>
              <span className="inline-flex px-2 py-1 text-[11px] text-amber-100">
                negativo = reabre picks historicos
              </span>
            </div>
          </div>
          <div className="space-y-2 text-sm text-steel">
            <div className="flex flex-wrap gap-2">
              <span className="inline-flex px-2 py-1 text-[11px] text-steel">
                Draft: se esta armando
              </span>
              <span className="inline-flex px-2 py-1 text-[11px] text-emerald-100">
                Active: jornada vigente
              </span>
              <span className="inline-flex px-2 py-1 text-[11px] text-steel">
                Closed: picks cerrados
              </span>
              <span className="inline-flex px-2 py-1 text-[11px] text-coral">
                Published: resultados visibles
              </span>
            </div>
          </div>
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
          <button type="submit" disabled={saving} className="app-pill-active px-4 disabled:opacity-60">
            {saving ? "Guardando..." : editingMatchdayId ? "Actualizar jornada" : "Crear jornada"}
          </button>
        </form>
        {message ? <p className="mt-4 text-sm text-moss">{message}</p> : null}
        {error ? <p className="mt-4 text-sm text-coral">{error}</p> : null}
      </section>

      <section className="space-y-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h3 className="text-base font-semibold text-ink">Jornadas registradas</h3>
            <p className="mt-1 text-sm text-steel">
              {selectedSeasonFilter
                ? `Mostrando ${filteredMatchdays.length} jornadas de ${seasonsById.get(selectedSeasonFilter)?.name ?? "la temporada"}`
                : `Mostrando ${matchdays.length} jornadas de todas las temporadas`}
            </p>
          </div>
          <label className="space-y-2 text-sm md:min-w-[280px]">
            <span className="text-steel">Filtrar por torneo</span>
            <select
              value={selectedSeasonFilter}
              onChange={(event) => setSelectedSeasonFilter(event.target.value)}
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
        </div>
        {loading ? <p className="mt-4 text-sm text-steel">Cargando jornadas...</p> : null}
        <div className="no-scrollbar overflow-x-scroll overscroll-x-contain touch-pan-x [WebkitOverflowScrolling:touch]">
          <table className="min-w-[1080px] table-fixed text-left text-[11px] text-steel">
            <thead className="app-table-head">
              <tr>
                <th className="w-[220px] px-3 py-3 text-left">Jornada</th>
                <th className="w-[180px] px-3 py-3 text-left">Torneo</th>
                <th className="w-[180px] px-3 py-3 text-left">Estado</th>
                <th className="w-[120px] px-3 py-3 text-left">Cierre</th>
                <th className="w-[180px] px-3 py-3 text-left">Fechas</th>
                <th className="w-[200px] px-3 py-3 text-left">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filteredMatchdays.map((matchday) => (
                <tr key={matchday.id} className="app-table-row border-b last:border-b-0">
                  <td className="px-3 py-3 text-left align-top">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingMatchdayId(matchday.id);
                        setMatchdayForm({
                          season_id: matchday.season_id,
                          number: String(matchday.number),
                          name: matchday.name,
                          default_lock_offset_minutes: String(matchday.default_lock_offset_minutes),
                          status: matchday.status,
                          starts_at: toMexicoCityInputValue(matchday.starts_at),
                          ends_at: toMexicoCityInputValue(matchday.ends_at),
                        });
                      }}
                      className="block text-left"
                    >
                      <p className="font-medium text-ink">{matchday.name}</p>
                      <p className="mt-1 text-xs text-steel">#{matchday.number}</p>
                    </button>
                  </td>
                  <td className="px-3 py-3 text-left align-top text-steel">
                    {seasonsById.get(matchday.season_id)?.name ?? "Temporada"}
                  </td>
                  <td className="px-3 py-3 text-left align-top text-steel">
                    {matchday.status}
                    <span className="ml-2 text-[10px] text-amber-100">
                      {matchday.picks_reopened_override ? "· picks abiertos" : ""}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-left align-top text-steel">
                    {matchday.default_lock_offset_minutes} min
                  </td>
                  <td className="px-3 py-3 text-left align-top text-steel">
                    <p>{formatShortMexicoCityDate(matchday.starts_at)}</p>
                    <p className="mt-1">{formatShortMexicoCityDate(matchday.ends_at)}</p>
                  </td>
                  <td className="px-3 py-3 text-left">
                    <div className="flex flex-nowrap items-center gap-1.5 whitespace-nowrap">
                  {matchday.picks_reopened_override ? (
                    <button
                      type="button"
                      onClick={() => void handleRestorePicksLock(matchday)}
                      disabled={restoringMatchdayId === matchday.id || reopeningMatchdayId === matchday.id}
                      className="app-pill h-9 justify-start px-3 text-[11px]"
                    >
                      {restoringMatchdayId === matchday.id ? "Cerrando..." : "Cerrar picks"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void handleReopenPicks(matchday)}
                      disabled={reopeningMatchdayId === matchday.id || restoringMatchdayId === matchday.id}
                      className="app-pill h-9 justify-start px-3 text-[11px]"
                    >
                      {reopeningMatchdayId === matchday.id ? "Reabriendo..." : "Reabrir picks"}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setEditingMatchdayId(matchday.id);
                      setMatchdayForm({
                        season_id: matchday.season_id,
                        number: String(matchday.number),
                        name: matchday.name,
                        default_lock_offset_minutes: String(matchday.default_lock_offset_minutes),
                        status: matchday.status,
                      starts_at: toMexicoCityInputValue(matchday.starts_at),
                      ends_at: toMexicoCityInputValue(matchday.ends_at),
                    });
                  }}
                    className="app-pill h-9 justify-start px-3 text-[11px]"
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDeleteMatchday(matchday)}
                    disabled={deletingMatchdayId === matchday.id}
                    className="app-pill h-9 justify-start px-3 text-[11px]"
                    >
                      {deletingMatchdayId === matchday.id ? "Borrando..." : "Borrar jornada"}
                    </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && filteredMatchdays.length === 0 ? (
            <p className="text-sm text-steel">
              {selectedSeasonFilter ? "No hay jornadas para ese torneo." : "Todavia no hay jornadas cargadas."}
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
