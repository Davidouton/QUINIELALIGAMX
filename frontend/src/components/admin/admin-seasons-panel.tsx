"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

import { backendFetch } from "@/lib/api/backend";
import { getBrowserAccessToken } from "@/lib/supabase/session";
import type { AdminUser, Competition, Season, SeasonVisibilityStatus, TournamentFormat } from "@/types/api";

type SeasonFormState = {
  name: string;
  description: string;
  slug: string;
  competition_id: string;
  tournament_format: TournamentFormat;
  visibility_status: SeasonVisibilityStatus;
  is_active: boolean;
  registration_closed: boolean;
  registration_lock_mode: "automatic" | "date";
  participants_lock_at: string;
  survivor_enabled: boolean;
  survivor_name: string;
  survivor_description: string;
  survivor_max_lives: string;
};

const initialSeasonForm: SeasonFormState = {
  name: "",
  description: "",
  slug: "",
  competition_id: "",
  tournament_format: "standard",
  visibility_status: "testing",
  is_active: false,
  registration_closed: false,
  registration_lock_mode: "automatic",
  participants_lock_at: "",
  survivor_enabled: false,
  survivor_name: "",
  survivor_description: "",
  survivor_max_lives: "1",
};

function getStructureLabel(competition: Competition | null | undefined) {
  if (competition?.structure_format === "league_playoff") return "Tabla general + playoff";
  if (competition?.structure_format === "groups_playoff") return "Grupos + playoff";
  if (competition?.structure_format === "conferences_playoff") return "Conferencias/divisiones + playoff";
  if (competition?.structure_format === "leagues_cup") return "Leagues Cup";
  if (competition?.structure_format === "knockout") return "Eliminación directa";
  return "Tabla general";
}

function getSeasonStatusPresentation(status: SeasonVisibilityStatus) {
  if (status === "testing") return { label: "Draft", dotClass: "bg-gold" };
  if (status === "live") return { label: "Live", dotClass: "bg-moss" };
  if (status === "closed") return { label: "Cerrada", dotClass: "bg-coral" };
  return { label: "Archivada", dotClass: "bg-steel" };
}

function toDatetimeLocalValue(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 16);
}

function toUtcIsoValue(value: string) {
  return value ? new Date(value).toISOString() : null;
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
  const [approvalSeasonId, setApprovalSeasonId] = useState("");
  const [approvalUsers, setApprovalUsers] = useState<AdminUser[]>([]);
  const [loadingApprovals, setLoadingApprovals] = useState(false);

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
        setApprovalSeasonId((current) => current || seasonRows.find((season) => season.visibility_status === "live")?.id || seasonRows[0]?.id || "");
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "No se pudieron cargar las temporadas");
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, []);

  async function loadApprovals(seasonId: string) {
    if (!seasonId) {
      setApprovalUsers([]);
      return;
    }
    setLoadingApprovals(true);
    try {
      const accessToken = await getBrowserAccessToken();
      const rows = await backendFetch<AdminUser[]>(`/admin/users?season_id=${seasonId}`, accessToken);
      setApprovalUsers(rows);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudieron cargar las solicitudes");
    } finally {
      setLoadingApprovals(false);
    }
  }

  useEffect(() => {
    void loadApprovals(approvalSeasonId);
  }, [approvalSeasonId]);

  async function handleApproveMembership(profileId: string, type: "season" | "survivor") {
    const savingKey = `approve:${type}:${profileId}`;
    setSaving(savingKey);
    setError(null);
    try {
      const accessToken = await getBrowserAccessToken();
      await backendFetch(
        type === "season"
          ? `/admin/users/${profileId}/season-membership`
          : `/admin/users/${profileId}/survivor-membership`,
        accessToken,
        {
          method: "PUT",
          body: JSON.stringify(
            type === "season"
              ? {
                  season_id: approvalSeasonId,
                  is_active: true,
                  is_paid: approvalUsers.find((user) => user.id === profileId)?.season_memberships.find((row) => row.season_id === approvalSeasonId)?.is_paid ?? false,
                  notes: "Aprobado desde Temporadas",
                }
              : { season_id: approvalSeasonId, is_active: true },
          ),
        },
      );
      await loadApprovals(approvalSeasonId);
      setMessage("Solicitud aprobada.");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo aprobar la solicitud");
    } finally {
      setSaving(null);
    }
  }

  async function handleRejectMembership(profileId: string, type: "season" | "survivor") {
    const productLabel = type === "season" ? "Quiniela" : "Survivor";
    if (!window.confirm(`¿No aprobar esta solicitud de ${productLabel}? El jugador podrá solicitar nuevamente.`)) {
      return;
    }
    const savingKey = `reject:${type}:${profileId}`;
    setSaving(savingKey);
    setError(null);
    try {
      const accessToken = await getBrowserAccessToken();
      await backendFetch(`/admin/users/${profileId}/membership-rejection`, accessToken, {
        method: "POST",
        body: JSON.stringify({ season_id: approvalSeasonId, membership_type: type }),
      });
      await loadApprovals(approvalSeasonId);
      setMessage("Solicitud no aprobada. El jugador puede solicitar nuevamente.");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo rechazar la solicitud");
    } finally {
      setSaving(null);
    }
  }

  const pendingApprovals = useMemo(
    () => approvalUsers.flatMap((user) => {
      const rows: Array<{ key: string; profileId: string; name: string; modality: string; type: "season" | "survivor"; paid: boolean }> = [];
      const hasAvalAccess = user.modality === "aval" && Boolean(user.aval_profile_id);
      if (hasAvalAccess) return rows;
      const seasonMembership = user.season_memberships.find((row) => row.season_id === approvalSeasonId);
      if (seasonMembership && !seasonMembership.is_active && !seasonMembership.is_rejected) {
        rows.push({ key: `season:${user.id}`, profileId: user.id, name: user.display_name, modality: user.modality, type: "season", paid: seasonMembership.is_paid });
      }
      const survivorMembership = user.survivor_memberships.find((row) => row.season_id === approvalSeasonId);
      if (survivorMembership && !survivorMembership.is_active && !survivorMembership.is_rejected) {
        rows.push({ key: `survivor:${user.id}`, profileId: user.id, name: user.display_name, modality: user.modality, type: "survivor", paid: survivorMembership.is_paid });
      }
      return rows;
    }),
    [approvalSeasonId, approvalUsers],
  );

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
          survivor_description: seasonForm.survivor_description || null,
          survivor_max_lives: Number(seasonForm.survivor_max_lives || 1),
          participants_lock_at:
            seasonForm.registration_lock_mode === "date"
              ? toUtcIsoValue(seasonForm.participants_lock_at)
              : null,
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
          description: season.description,
          slug: season.slug,
          competition_id: season.competition_id,
          tournament_format: season.tournament_format,
          visibility_status: season.visibility_status,
          is_active: true,
          registration_closed: season.registration_closed,
          survivor_enabled: season.survivor_enabled,
          survivor_name: season.survivor_name,
          survivor_description: season.survivor_description,
          survivor_max_lives: season.survivor_max_lives,
          participants_lock_at: season.participants_lock_at,
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

  async function handleToggleRegistration(season: Season) {
    const savingKey = `registration:${season.id}`;
    setSaving(savingKey);
    setError(null);
    setMessage(null);

    try {
      const accessToken = await getBrowserAccessToken();
      await backendFetch(`/admin/seasons/${season.id}`, accessToken, {
        method: "PUT",
        body: JSON.stringify({
          name: season.name,
          description: season.description,
          slug: season.slug,
          competition_id: season.competition_id,
          tournament_format: season.tournament_format,
          visibility_status: season.visibility_status,
          is_active: season.is_active,
          registration_closed: !season.registration_closed,
          survivor_enabled: season.survivor_enabled,
          survivor_name: season.survivor_name,
          survivor_description: season.survivor_description,
          survivor_max_lives: season.survivor_max_lives,
          participants_lock_at: season.participants_lock_at,
        }),
      });
      await loadSeasons();
      setMessage(
        season.registration_closed
          ? `Inscripciones abiertas: ${season.name}.`
          : `Inscripciones cerradas: ${season.name}.`,
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
          description: season.description,
          slug: season.slug,
          competition_id: season.competition_id,
          tournament_format: season.tournament_format,
          visibility_status: "archived",
          is_active: false,
          registration_closed: true,
          survivor_enabled: season.survivor_enabled,
          survivor_name: season.survivor_name,
          survivor_description: season.survivor_description,
          survivor_max_lives: season.survivor_max_lives,
          participants_lock_at: season.participants_lock_at,
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
              <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.14em] text-steel md:col-span-2">
                Descripción para inscripciones
                <textarea
                  value={seasonForm.description}
                  onChange={(event) => setSeasonForm((current) => ({ ...current, description: event.target.value }))}
                  placeholder="Explica brevemente de qué trata el torneo, cómo se juega o a quién está dirigido."
                  rows={3}
                  maxLength={2000}
                  className="field-control mt-2 min-h-[96px] w-full normal-case tracking-normal"
                />
                <span className="block text-xs font-normal normal-case tracking-normal text-steel">Se mostrará a los jugadores en el hub de Inscripciones.</span>
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
          <label className="block space-y-2 text-xs font-semibold uppercase tracking-[0.14em] text-steel">
            Estado de la temporada
            <select
              value={seasonForm.visibility_status}
              onChange={(event) =>
                setSeasonForm((current) => ({
                  ...current,
                  visibility_status: event.target.value as SeasonVisibilityStatus,
                  is_active: event.target.value === "testing" || event.target.value === "archived" ? false : current.is_active,
                }))
              }
              className="field-control mt-2 normal-case tracking-normal"
            >
              <option value="testing">Draft</option>
              <option value="live">Live</option>
              <option value="closed">Cerrada</option>
              <option value="archived">Archivada</option>
            </select>
          </label>
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
              ? "Las temporadas Draft no pueden ser la temporada default"
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
            Cerrar inscripciones de Quiniela y Survivor
          </label>
          <label className="block space-y-2 text-xs font-semibold uppercase tracking-[0.14em] text-steel">
            Cierre automático
            <select
              value={seasonForm.registration_lock_mode}
              onChange={(event) =>
                setSeasonForm((current) => ({
                  ...current,
                  registration_lock_mode: event.target.value as "automatic" | "date",
                }))
              }
              className="field-control mt-2 w-full normal-case tracking-normal md:max-w-md"
            >
              <option value="automatic">Al iniciar la primera jornada configurada</option>
              <option value="date">En una fecha específica</option>
            </select>
            <span className="block text-xs font-normal normal-case tracking-normal text-steel">
              Aplica tanto a la Quiniela como a Survivor.
            </span>
          </label>
          {seasonForm.registration_lock_mode === "date" ? (
            <label className="block space-y-2 text-xs font-semibold uppercase tracking-[0.14em] text-steel">
              Fecha de cierre
              <input
                type="datetime-local"
                value={seasonForm.participants_lock_at}
                onChange={(event) =>
                  setSeasonForm((current) => ({ ...current, participants_lock_at: event.target.value }))
                }
                className="field-control mt-2 w-full normal-case tracking-normal md:max-w-md"
                required
              />
            </label>
          ) : null}
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
              <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.14em] text-steel">
                Nombre de Survivor
                <input
                  value={seasonForm.survivor_name}
                  onChange={(event) => setSeasonForm((current) => ({ ...current, survivor_name: event.target.value }))}
                  placeholder="Survivor Leagues Cup"
                  className="field-control mt-2 w-full normal-case tracking-normal"
                />
              </label>
              <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.14em] text-steel">
                Número de vidas
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={seasonForm.survivor_max_lives}
                  onChange={(event) =>
                    setSeasonForm((current) => ({ ...current, survivor_max_lives: event.target.value }))
                  }
                  className="field-control mt-2 w-full normal-case tracking-normal"
                />
              </label>
              <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.14em] text-steel md:col-span-2">
                Descripción de Survivor
                <textarea
                  value={seasonForm.survivor_description}
                  onChange={(event) => setSeasonForm((current) => ({ ...current, survivor_description: event.target.value }))}
                  placeholder="Explica la dinámica, reglas principales o condiciones específicas de Survivor."
                  rows={3}
                  maxLength={2000}
                  className="field-control mt-2 min-h-[96px] w-full normal-case tracking-normal"
                />
                <span className="block text-xs font-normal normal-case tracking-normal text-steel">Solo se mostrará en la inscripción de Survivor.</span>
              </label>
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

      <section className="space-y-4 border-y border-white/[0.1] py-5">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-[0.22em] text-ink">Solicitudes de ingreso</h3>
          <p className="mt-2 text-sm text-steel">Aprueba aquí las altas de Quiniela y Survivor que no cuentan con aval.</p>
        </div>
        <select value={approvalSeasonId} onChange={(event) => setApprovalSeasonId(event.target.value)} className="field-control max-w-md">
          <option value="">Selecciona una temporada</option>
          {seasons.filter((season) => season.visibility_status !== "archived").map((season) => (
            <option key={`approval-${season.id}`} value={season.id}>{season.name}</option>
          ))}
        </select>
        {loadingApprovals ? <p className="text-sm text-steel">Cargando solicitudes...</p> : null}
        {!loadingApprovals && pendingApprovals.length === 0 ? (
          <p className="border-t border-white/[0.08] py-4 text-sm text-steel">No hay solicitudes pendientes para esta temporada.</p>
        ) : null}
        {pendingApprovals.length ? (
          <div className="divide-y divide-white/[0.08] border-y border-white/[0.08]">
            {pendingApprovals.map((request) => (
              <div key={request.key} className="grid gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_130px_110px_270px] sm:items-center">
                <p className="font-semibold text-ink">{request.name}</p>
                <p className="text-sm text-steel">{request.type === "season" ? "Quiniela" : "Survivor"}</p>
                <p className="text-sm text-steel">{request.paid ? "Pagado" : request.modality === "aval" ? "Con aval" : "Pre-pago"}</p>
                <div className="flex flex-wrap gap-2 sm:flex-nowrap sm:justify-end">
                  <button type="button" onClick={() => void handleRejectMembership(request.profileId, request.type)} disabled={Boolean(saving)} className="shrink-0 border border-coral/60 px-3 py-2 text-sm font-semibold text-coral transition hover:bg-coral/10 disabled:opacity-50">
                    {saving === `reject:${request.type}:${request.profileId}` ? "Procesando..." : "No aprobar"}
                  </button>
                  <button type="button" onClick={() => void handleApproveMembership(request.profileId, request.type)} disabled={Boolean(saving)} className="shrink-0 border border-[#4f7df3]/60 px-3 py-2 text-sm font-semibold text-[#4f7df3] transition hover:bg-[#4f7df3]/10 disabled:opacity-50">
                    {saving === `approve:${request.type}:${request.profileId}` ? "Aprobando..." : "Aprobar"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : null}
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
                          : season.structure_format === "leagues_cup"
                            ? "Leagues Cup"
                          : season.structure_format === "knockout"
                            ? "Eliminación directa"
                            : "Tabla general"}
                  </td>
                  <td className="px-3 py-3 text-steel">
                    {season.survivor_enabled ? `${season.survivor_name ?? "Survivor"} · ${season.survivor_max_lives} vidas` : "Off"}
                  </td>
                  <td className="px-3 py-3 text-steel">
                    <div className="flex flex-col gap-1">
                      <span>{season.registration_closed ? "Inscripciones cerradas" : "Inscripciones abiertas"}</span>
                      <span>{season.participants_lock_at ? `Cierre: ${new Date(season.participants_lock_at).toLocaleString("es-MX")}` : "Sin fecha de cierre"}</span>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-steel">
                    <span className="inline-flex items-center gap-2 font-semibold text-ink">
                      <i className={`h-2 w-2 rounded-full ${getSeasonStatusPresentation(season.visibility_status).dotClass}`} />
                      {getSeasonStatusPresentation(season.visibility_status).label}
                    </span>
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
                            description: season.description ?? "",
                            slug: season.slug,
                            competition_id: season.competition_id ?? "",
                            tournament_format: season.tournament_format,
                            visibility_status: season.visibility_status,
                            is_active: season.is_active,
                            registration_closed:
                              season.registration_closed ||
                              (season.survivor_enabled && season.survivor_registration_closed),
                            registration_lock_mode:
                              season.participants_lock_at || season.survivor_registration_lock_at
                                ? "date"
                                : "automatic",
                            participants_lock_at: toDatetimeLocalValue(
                              season.participants_lock_at ?? season.survivor_registration_lock_at,
                            ),
                            survivor_enabled: season.survivor_enabled,
                            survivor_name: season.survivor_name ?? "",
                            survivor_description: season.survivor_description ?? "",
                            survivor_max_lives: String(season.survivor_max_lives ?? 1),
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
                        onClick={() => void handleToggleRegistration(season)}
                        disabled={Boolean(saving)}
                        className="app-pill h-9 min-w-[104px] px-3 text-[11px]"
      >
        {saving === `registration:${season.id}`
                          ? "..."
                          : season.registration_closed
                            ? "Abrir inscripciones"
                            : "Cerrar inscripciones"}
                      </button>
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
