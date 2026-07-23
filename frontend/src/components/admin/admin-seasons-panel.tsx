"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

import { backendFetch } from "@/lib/api/backend";
import { getBrowserAccessToken } from "@/lib/supabase/session";
import type { Competition, Season, SeasonVisibilityStatus, TournamentFormat } from "@/types/api";

type SeasonFormState = {
  name: string;
  slug: string;
  competition_id: string;
  tournament_format: TournamentFormat;
  visibility_status: SeasonVisibilityStatus;
  is_active: boolean;
  registration_closed: boolean;
  survivor_enabled: boolean;
  survivor_name: string;
  survivor_max_lives: string;
  survivor_registration_closed: boolean;
  survivor_registration_lock_at: string;
};

const initialSeasonForm: SeasonFormState = {
  name: "",
  slug: "",
  competition_id: "",
  tournament_format: "standard",
  visibility_status: "live",
  is_active: false,
  registration_closed: false,
  survivor_enabled: false,
  survivor_name: "",
  survivor_max_lives: "1",
  survivor_registration_closed: false,
  survivor_registration_lock_at: "",
};

function getStructureLabel(competition: Competition | null | undefined) {
  if (competition?.structure_format === "league_playoff") return "Tabla general + playoff";
  if (competition?.structure_format === "groups_playoff") return "Grupos + playoff";
  if (competition?.structure_format === "conferences_playoff") return "Conferencias/divisiones + playoff";
  if (competition?.structure_format === "knockout") return "Eliminación directa";
  return "Tabla general";
}

export function AdminSeasonsPanel() {
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [selectedCompetitionId, setSelectedCompetitionId] = useState("");
  const [seasonForm, setSeasonForm] = useState<SeasonFormState>(initialSeasonForm);
  const [editingSeasonId, setEditingSeasonId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const visibleSeasons = useMemo(
    () => seasons.filter((season) => (selectedCompetitionId ? season.competition_id === selectedCompetitionId : true)),
    [selectedCompetitionId, seasons],
  );
  const selectedFormCompetition = useMemo(
    () => competitions.find((competition) => competition.id === seasonForm.competition_id) ?? null,
    [competitions, seasonForm.competition_id],
  );

  async function loadSeasons() {
    const accessToken = await getBrowserAccessToken();
    const rows = await backendFetch<Season[]>("/seasons", accessToken);
    setSeasons(rows);
  }

  useEffect(() => {
    async function load() {
      try {
        const accessToken = await getBrowserAccessToken();
        const [seasonRows, competitionRows] = await Promise.all([
          backendFetch<Season[]>("/seasons", accessToken),
          backendFetch<Competition[]>("/competitions", accessToken),
        ]);
        setSeasons(seasonRows);
        setCompetitions(competitionRows);
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "No se pudieron cargar las temporadas");
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, []);

  async function handleSaveSeason(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving("season");
    setError(null);
    setMessage(null);

    try {
      const accessToken = await getBrowserAccessToken();
      const path = editingSeasonId ? `/admin/seasons/${editingSeasonId}` : "/admin/seasons";
      const method = editingSeasonId ? "PUT" : "POST";
      await backendFetch(path, accessToken, {
        method,
        body: JSON.stringify({
          ...seasonForm,
          competition_id: seasonForm.competition_id,
          survivor_name: seasonForm.survivor_name || null,
          survivor_max_lives: Number(seasonForm.survivor_max_lives || 1),
          survivor_registration_lock_at: seasonForm.survivor_registration_lock_at || null,
        }),
      });
      await loadSeasons();
      setSeasonForm(initialSeasonForm);
      setEditingSeasonId(null);
      setMessage(editingSeasonId ? "Temporada actualizada." : "Temporada creada.");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo guardar la temporada");
    } finally {
      setSaving(null);
    }
  }

  async function handleSetActiveSeason(season: Season) {
    setSaving(`activate:${season.id}`);
    setError(null);
    setMessage(null);

    try {
      const accessToken = await getBrowserAccessToken();
      await backendFetch(`/admin/seasons/${season.id}`, accessToken, {
        method: "PUT",
        body: JSON.stringify({
          name: season.name,
          slug: season.slug,
          competition_id: season.competition_id,
          tournament_format: season.tournament_format,
          visibility_status: season.visibility_status,
          is_active: true,
          registration_closed: season.registration_closed,
          survivor_enabled: season.survivor_enabled,
          survivor_name: season.survivor_name,
          survivor_max_lives: season.survivor_max_lives,
          survivor_registration_closed: season.survivor_registration_closed,
          survivor_registration_lock_at: season.survivor_registration_lock_at,
        }),
      });
      await loadSeasons();
      setMessage(`Temporada default: ${season.name}.`);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo activar la temporada");
    } finally {
      setSaving(null);
    }
  }

  async function handleToggleRegistration(season: Season, target: "season" | "survivor") {
    const savingKey = `${target}:${season.id}`;
    setSaving(savingKey);
    setError(null);
    setMessage(null);

    try {
      const accessToken = await getBrowserAccessToken();
      await backendFetch(`/admin/seasons/${season.id}`, accessToken, {
        method: "PUT",
        body: JSON.stringify({
          name: season.name,
          slug: season.slug,
          competition_id: season.competition_id,
          tournament_format: season.tournament_format,
          visibility_status: season.visibility_status,
          is_active: season.is_active,
          registration_closed: target === "season" ? !season.registration_closed : season.registration_closed,
          survivor_enabled: season.survivor_enabled,
          survivor_name: season.survivor_name,
          survivor_max_lives: season.survivor_max_lives,
          survivor_registration_closed:
            target === "survivor" ? !season.survivor_registration_closed : season.survivor_registration_closed,
          survivor_registration_lock_at: season.survivor_registration_lock_at,
        }),
      });
      await loadSeasons();
      setMessage(
        target === "season"
          ? season.registration_closed
            ? `Registro de liga abierto: ${season.name}.`
            : `Registro de liga cerrado: ${season.name}.`
          : season.survivor_registration_closed
            ? `Registro de survivor abierto: ${season.name}.`
            : `Registro de survivor cerrado: ${season.name}.`,
      );
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo actualizar el bloqueo de registro");
    } finally {
      setSaving(null);
    }
  }

  async function handleArchiveSeason(season: Season) {
    if (!window.confirm(`Archivar ${season.name}? Sus resultados, picks y rankings se conservaran en Historico.`)) {
      return;
    }
    setSaving(`archive:${season.id}`);
    setError(null);
    setMessage(null);

    try {
      const accessToken = await getBrowserAccessToken();
      await backendFetch(`/admin/seasons/${season.id}`, accessToken, {
        method: "PUT",
        body: JSON.stringify({
          name: season.name,
          slug: season.slug,
          competition_id: season.competition_id,
          tournament_format: season.tournament_format,
          visibility_status: "archived",
          is_active: false,
          registration_closed: true,
          survivor_enabled: season.survivor_enabled,
          survivor_name: season.survivor_name,
          survivor_max_lives: season.survivor_max_lives,
          survivor_registration_closed: true,
          survivor_registration_lock_at: season.survivor_registration_lock_at,
        }),
      });
      await loadSeasons();
      setMessage(`Temporada archivada: ${season.name}.`);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo archivar la temporada");
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="space-y-6">
      <section className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-[0.22em] text-ink">
              {editingSeasonId ? "Editar temporada" : "Crear temporada"}
            </h2>
          </div>
          {editingSeasonId ? (
            <button
              type="button"
              onClick={() => {
                setEditingSeasonId(null);
                setSeasonForm(initialSeasonForm);
              }}
              className="app-pill px-4"
            >
              Cancelar
            </button>
          ) : null}
        </div>

        <form onSubmit={handleSaveSeason} className="space-y-7">
          <section className="space-y-4 border-y border-white/[0.08] py-5">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-steel">Identidad y competencia</h3>
              <p className="mt-2 text-sm text-steel">La estructura se hereda de la competencia y queda congelada en este torneo.</p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.14em] text-steel">
                Competencia
                <select
                  value={seasonForm.competition_id}
                  onChange={(event) => {
                    const competition = competitions.find((row) => row.id === event.target.value);
                    setSeasonForm((current) => ({
                      ...current,
                      competition_id: event.target.value,
                      tournament_format: competition?.structure_format === "groups_playoff" ? "world_cup" : "standard",
                    }));
                  }}
                  className="field-control mt-2 w-full normal-case tracking-normal"
                  required
                >
                  <option value="" disabled>Selecciona una competencia</option>
                  {competitions
                    .filter((competition) => competition.is_active || competition.id === seasonForm.competition_id)
                    .map((competition) => (
                    <option key={competition.id} value={competition.id}>
                      {competition.sport_name} · {competition.name}
                    </option>
                    ))}
                </select>
              </label>
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-steel">Estructura heredada</p>
                <div className="field-control flex items-center text-sm text-ink">
                  {selectedFormCompetition ? getStructureLabel(selectedFormCompetition) : "Selecciona una competencia"}
                </div>
              </div>
              <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.14em] text-steel">
                Nombre del torneo
                <input
                  value={seasonForm.name}
                  onChange={(event) => setSeasonForm((current) => ({ ...current, name: event.target.value }))}
                  placeholder="Temporada 2026"
                  className="field-control mt-2 w-full normal-case tracking-normal"
                  required
                />
              </label>
              <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.14em] text-steel">
                Identificador
                <input
                  value={seasonForm.slug}
                  onChange={(event) => setSeasonForm((current) => ({ ...current, slug: event.target.value }))}
                  placeholder="temporada-2026"
                  className="field-control mt-2 w-full normal-case tracking-normal"
                  required
                />
              </label>
            </div>
          </section>

          <section className="space-y-4 border-b border-white/[0.08] pb-5">
            <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-steel">Estado y registro</h3>
          <select
            value={seasonForm.visibility_status}
            onChange={(event) =>
              setSeasonForm((current) => ({
                ...current,
                visibility_status: event.target.value as SeasonVisibilityStatus,
                is_active: event.target.value === "testing" || event.target.value === "archived" ? false : current.is_active,
              }))
            }
            className="field-control"
          >
            <option value="live">Operativa</option>
            <option value="testing">Pruebas · solo usuarios asignados</option>
            <option value="closed">Cerrada</option>
            <option value="archived">Archivada</option>
          </select>
          <label className="flex items-center gap-3 text-sm text-ink">
            <input
              type="checkbox"
              checked={seasonForm.is_active}
              disabled={seasonForm.visibility_status === "testing"}
              onChange={(event) =>
                setSeasonForm((current) => ({ ...current, is_active: event.target.checked }))
              }
            />
            {seasonForm.visibility_status === "testing"
              ? "Los torneos de prueba no pueden ser temporada default"
              : "Usar como temporada default del admin"}
          </label>
          <label className="flex items-center gap-3 text-sm text-ink">
            <input
              type="checkbox"
              checked={seasonForm.registration_closed}
              onChange={(event) =>
                setSeasonForm((current) => ({ ...current, registration_closed: event.target.checked }))
              }
            />
            Cerrar registro de la liga
          </label>
          </section>

          <section className="space-y-4 border-b border-white/[0.08] pb-5">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-steel">Survivor</h3>
              <p className="mt-2 text-sm text-steel">Módulo opcional asociado a este torneo.</p>
            </div>
            <label className="flex items-center gap-3 text-sm text-ink">
              <input
                type="checkbox"
                checked={seasonForm.survivor_enabled}
                onChange={(event) =>
                  setSeasonForm((current) => ({ ...current, survivor_enabled: event.target.checked }))
                }
              />
              Habilitar survivor en esta temporada
            </label>
            {seasonForm.survivor_enabled ? <div className="grid gap-4 md:grid-cols-2">
              <input
                value={seasonForm.survivor_name}
                onChange={(event) => setSeasonForm((current) => ({ ...current, survivor_name: event.target.value }))}
                placeholder="Survivor Liga MX"
                className="field-control"
                disabled={!seasonForm.survivor_enabled}
              />
              <input
                type="number"
                min={1}
                max={10}
                value={seasonForm.survivor_max_lives}
                onChange={(event) =>
                  setSeasonForm((current) => ({ ...current, survivor_max_lives: event.target.value }))
                }
                className="field-control"
                disabled={!seasonForm.survivor_enabled}
              />
              <label className="flex items-center gap-3 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={seasonForm.survivor_registration_closed}
                  onChange={(event) =>
                    setSeasonForm((current) => ({ ...current, survivor_registration_closed: event.target.checked }))
                  }
                  disabled={!seasonForm.survivor_enabled}
                />
                Cerrar registro de survivor
              </label>
              <input
                type="datetime-local"
                value={seasonForm.survivor_registration_lock_at}
                onChange={(event) =>
                  setSeasonForm((current) => ({ ...current, survivor_registration_lock_at: event.target.value }))
                }
                className="field-control"
                disabled={!seasonForm.survivor_enabled}
              />
            </div> : null}
          </section>
          <button type="submit" disabled={saving === "season"} className="app-pill-active px-4 disabled:opacity-60">
            {saving === "season"
              ? "Guardando..."
              : editingSeasonId
                ? "Actualizar temporada"
                : "Crear temporada"}
          </button>
        </form>

        {message ? <p className="mt-4 text-sm text-moss">{message}</p> : null}
        {error ? <p className="mt-4 text-sm text-coral">{error}</p> : null}
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-[0.22em] text-ink">Temporadas registradas</h3>
        {loading ? <p className="mt-4 text-sm text-steel">Cargando temporadas...</p> : null}
        <div className="max-w-[320px]">
          <select
            value={selectedCompetitionId}
            onChange={(event) => setSelectedCompetitionId(event.target.value)}
            className="field-control"
          >
            <option value="">Todas las competencias</option>
            {competitions.map((competition) => (
              <option key={competition.id} value={competition.id}>
                {competition.sport_name} · {competition.name}
              </option>
            ))}
          </select>
        </div>
        <div className="android-scroll-x">
          <table className="min-w-[1080px] table-fixed text-left text-sm text-ink">
            <colgroup>
              <col className="w-[180px]" />
              <col className="w-[200px]" />
              <col className="w-[110px]" />
              <col className="w-[130px]" />
              <col className="w-[150px]" />
              <col className="w-[170px]" />
              <col className="w-[110px]" />
              <col className="w-[110px]" />
              <col className="w-[290px]" />
            </colgroup>
            <thead className="app-table-head">
              <tr>
                <th className="px-3 py-3">Competencia</th>
                <th className="px-3 py-3">Temporada</th>
                <th className="px-3 py-3">Slug</th>
                <th className="px-3 py-3">Formato</th>
                <th className="px-3 py-3">Survivor</th>
                <th className="px-3 py-3">Registro</th>
                <th className="px-3 py-3">Visibilidad</th>
                <th className="px-3 py-3">Default</th>
                <th className="px-3 py-3">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {visibleSeasons.map((season) => (
                <tr key={season.id} className="app-table-row border-b last:border-b-0">
                  <td className="px-3 py-3 text-steel">
                    {season.competition_name ? `${season.competition_sport_name} · ${season.competition_name}` : "Sin asignar"}
                  </td>
                  <td className="truncate px-3 py-3 font-medium text-ink">{season.name}</td>
                  <td className="px-3 py-3 text-steel">{season.slug}</td>
                  <td className="px-3 py-3 text-steel">
                    {season.structure_format === "league_playoff"
                      ? "Tabla + playoff"
                      : season.structure_format === "groups_playoff"
                        ? "Grupos + playoff"
                        : season.structure_format === "conferences_playoff"
                          ? "Conferencias + playoff"
                          : season.structure_format === "knockout"
                            ? "Eliminación directa"
                            : "Tabla general"}
                  </td>
                  <td className="px-3 py-3 text-steel">
                    {season.survivor_enabled ? `${season.survivor_name ?? "Survivor"} · ${season.survivor_max_lives} vidas` : "Off"}
                  </td>
                  <td className="px-3 py-3 text-steel">
                    <div className="flex flex-col gap-1">
                      <span>{season.registration_closed ? "Liga cerrada" : "Liga abierta"}</span>
                      <span>
                        {season.survivor_enabled
                          ? season.survivor_registration_closed
                            ? "Survivor cerrado"
                            : "Survivor abierto"
                          : "Survivor off"}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-steel">
                    {season.visibility_status === "live"
                      ? "Operativa"
                      : season.visibility_status === "testing"
                        ? "Pruebas"
                      : season.visibility_status === "closed"
                        ? "Cerrada"
                        : "Archivada"}
                  </td>
                  <td className="px-3 py-3 text-steel">{season.is_active ? "Si" : "No"}</td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingSeasonId(season.id);
                          setSeasonForm({
                            name: season.name,
                            slug: season.slug,
                            competition_id: season.competition_id ?? "",
                            tournament_format: season.tournament_format,
                            visibility_status: season.visibility_status,
                            is_active: season.is_active,
                            registration_closed: season.registration_closed,
                            survivor_enabled: season.survivor_enabled,
                            survivor_name: season.survivor_name ?? "",
                            survivor_max_lives: String(season.survivor_max_lives ?? 1),
                            survivor_registration_closed: season.survivor_registration_closed,
                            survivor_registration_lock_at: season.survivor_registration_lock_at
                              ? season.survivor_registration_lock_at.slice(0, 16)
                              : "",
                          });
                        }}
                        className="app-pill h-9 min-w-[76px] px-3 text-[11px]"
                      >
                        Editar
                      </button>
                      {season.visibility_status !== "archived" ? (
                        <button
                          type="button"
                          onClick={() => void handleArchiveSeason(season)}
                          disabled={Boolean(saving)}
                          className="app-pill h-9 min-w-[90px] px-3 text-[11px]"
                        >
                          {saving === `archive:${season.id}` ? "..." : "Archivar"}
                        </button>
                      ) : null}
                      {!season.is_active && season.visibility_status === "live" ? (
                        <button
                          type="button"
                          onClick={() => void handleSetActiveSeason(season)}
          disabled={saving === `activate:${season.id}`}
          className="app-pill h-9 min-w-[76px] px-3 text-[11px]"
        >
          {saving === `activate:${season.id}` ? "..." : "Act"}
        </button>
      ) : null}
                      <button
                        type="button"
                        onClick={() => void handleToggleRegistration(season, "season")}
                        disabled={Boolean(saving)}
                        className="app-pill h-9 min-w-[104px] px-3 text-[11px]"
      >
        {saving === `season:${season.id}`
                          ? "..."
                          : season.registration_closed
                            ? "Abrir liga"
                            : "Cerrar liga"}
                      </button>
                      {season.survivor_enabled ? (
                        <button
                          type="button"
                          onClick={() => void handleToggleRegistration(season, "survivor")}
                          disabled={Boolean(saving)}
                          className="app-pill h-9 min-w-[120px] px-3 text-[11px]"
                        >
                          {saving === `survivor:${season.id}`
                            ? "..."
                            : season.survivor_registration_closed
                              ? "Abrir survivor"
                              : "Cerrar survivor"}
                          </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {!loading && visibleSeasons.length === 0 ? (
            <p className="text-sm text-steel">Todavia no hay temporadas cargadas.</p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
