"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

import { backendFetch } from "@/lib/api/backend";
import { getBrowserAccessToken } from "@/lib/supabase/session";
import type { Competition, Team, TeamBulkImportResult } from "@/types/api";

type TeamFormState = {
  competition_ids: string[];
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

const initialTeamForm: TeamFormState = {
  competition_ids: [],
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

export function AdminTeamsPanel() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [selectedCompetitionId, setSelectedCompetitionId] = useState("");
  const [teamForm, setTeamForm] = useState<TeamFormState>(initialTeamForm);
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [bulkResult, setBulkResult] = useState<TeamBulkImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const visibleTeams = useMemo(
    () => teams.filter((team) => (selectedCompetitionId ? team.competition_ids.includes(selectedCompetitionId) : true)),
    [selectedCompetitionId, teams],
  );

  async function loadTeams() {
    const rows = await backendFetch<Team[]>("/teams");
    setTeams(rows);
  }

  useEffect(() => {
    async function load() {
      try {
        const [teamRows, competitionRows] = await Promise.all([
          backendFetch<Team[]>("/teams"),
          backendFetch<Competition[]>("/competitions"),
        ]);
        setTeams(teamRows);
        setCompetitions(competitionRows);
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "No se pudieron cargar los equipos");
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  async function handleCreateTeam(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const accessToken = await getBrowserAccessToken();
      const path = editingTeamId ? `/admin/teams/${editingTeamId}` : "/admin/teams";
      const method = editingTeamId ? "PUT" : "POST";
      await backendFetch(path, accessToken, {
        method,
        body: JSON.stringify({
          ...teamForm,
          competition_id: teamForm.competition_ids[0] ?? null,
          external_id: teamForm.external_id || null,
          crest_url: teamForm.crest_url || null,
          home_venue: teamForm.home_venue || null,
          primary_color: teamForm.primary_color || null,
          secondary_color: teamForm.secondary_color || null,
          accent_color: teamForm.accent_color || null,
        }),
      });
      await loadTeams();
      setTeamForm(initialTeamForm);
      setEditingTeamId(null);
      setMessage(editingTeamId ? "Equipo actualizado." : "Equipo creado.");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo guardar el equipo");
    } finally {
      setSaving(false);
    }
  }

  function beginEditTeam(team: Team) {
    setEditingTeamId(team.id);
    setTeamForm({
      competition_ids: team.competition_ids,
      name: team.name,
      short_name: team.short_name,
      slug: team.slug,
      external_id: team.external_id ?? "",
      crest_url: team.crest_url ?? "",
      home_venue: team.home_venue ?? "",
      primary_color: team.primary_color ?? "",
      secondary_color: team.secondary_color ?? "",
      accent_color: team.accent_color ?? "",
    });
    setError(null);
    setMessage(null);
  }

  function resetForm() {
    setEditingTeamId(null);
    setTeamForm(initialTeamForm);
    setError(null);
    setMessage(null);
  }

  function downloadCsvTemplate() {
    const csv = [
      "name,short_name,slug,external_id,crest_url,home_venue",
      "Equipo Demo,DEM,equipo-demo,provider-123,https://example.com/logo.png,Estadio Demo",
    ].join("\n");
    const url = URL.createObjectURL(new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "plantilla-equipos.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  async function importCsv(file: File | null) {
    if (!file) return;
    if (!selectedCompetitionId) {
      setError("Selecciona la competencia donde se cargarán los equipos.");
      return;
    }
    setImporting(true);
    setBulkResult(null);
    setError(null);
    setMessage(null);
    try {
      const accessToken = await getBrowserAccessToken();
      const result = await backendFetch<TeamBulkImportResult>("/admin/teams/import-csv", accessToken, {
        method: "POST",
        body: JSON.stringify({
          competition_id: selectedCompetitionId,
          csv_text: await file.text(),
        }),
      });
      setBulkResult(result);
      await loadTeams();
      setMessage(`Importación terminada: ${result.created} creados, ${result.updated} actualizados${result.failed ? ` y ${result.failed} con error` : ""}.`);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo importar el CSV");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="space-y-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-ink">
              {editingTeamId ? "Editar equipo" : "Crear equipo"}
            </h2>
          </div>
          {editingTeamId ? (
            <button type="button" onClick={resetForm} className="app-pill px-4">
              Cancelar
            </button>
          ) : null}
        </div>
        <form onSubmit={handleCreateTeam} className="mt-5 grid gap-4 md:grid-cols-2">
          <fieldset className="space-y-3 border-y border-white/[0.08] py-4 md:col-span-2">
            <legend className="text-sm font-semibold text-ink">Competencias del equipo</legend>
            <p className="text-xs text-steel">Selecciona todas las competencias donde puede participar este mismo equipo.</p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {competitions.filter((competition) => competition.is_active).map((competition) => (
                <label key={competition.id} className="flex items-center gap-3 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={teamForm.competition_ids.includes(competition.id)}
                    onChange={(event) => setTeamForm((current) => ({
                      ...current,
                      competition_ids: event.target.checked
                        ? [...current.competition_ids, competition.id]
                        : current.competition_ids.filter((competitionId) => competitionId !== competition.id),
                    }))}
                  />
                  {competition.sport_name} · {competition.name}
                </label>
              ))}
            </div>
          </fieldset>
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
          <input
            value={teamForm.home_venue}
            onChange={(event) => setTeamForm((current) => ({ ...current, home_venue: event.target.value }))}
            placeholder="Estadio local"
            className="field-control md:col-span-2"
          />
          <div className="border-y border-white/[0.08] py-4 md:col-span-2">
            <p className="text-sm font-semibold text-ink">Paleta automática del escudo</p>
            <p className="mt-1 text-xs text-steel">Los colores se calculan al guardar usando la imagen de crest_url.</p>
            {editingTeamId && (teamForm.primary_color || teamForm.secondary_color || teamForm.accent_color) ? (
              <div className="mt-3 flex items-center gap-3">
                {[teamForm.primary_color, teamForm.secondary_color, teamForm.accent_color]
                  .filter(Boolean)
                  .map((color) => (
                    <span key={color} className="inline-flex items-center gap-2 text-xs text-steel">
                      <i className="h-5 w-5 rounded-full border border-white/[0.1]" style={{ backgroundColor: color }} />
                      {color}
                    </span>
                  ))}
              </div>
            ) : null}
          </div>
          <button type="submit" disabled={saving} className="app-pill-active w-fit px-4 disabled:opacity-60">
            {saving ? "Guardando..." : editingTeamId ? "Actualizar equipo" : "Crear equipo"}
          </button>
        </form>
        {message ? <p className="mt-4 text-sm text-moss">{message}</p> : null}
        {error ? <p className="mt-4 text-sm text-coral">{error}</p> : null}
      </section>

      <section className="space-y-4 border-y border-white/[0.08] py-5">
        <div>
          <h3 className="text-base font-semibold text-ink">Carga masiva de equipos</h3>
          <p className="mt-1 text-sm text-steel">
            Selecciona una competencia y sube el CSV. Los equipos existentes se actualizan por slug sin perder sus otras competencias.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-[minmax(0,320px)_auto_auto] md:items-center">
          <select
            value={selectedCompetitionId}
            onChange={(event) => setSelectedCompetitionId(event.target.value)}
            className="field-control"
          >
            <option value="">Selecciona una competencia</option>
            {competitions.map((competition) => (
              <option key={competition.id} value={competition.id}>
                {competition.sport_name} · {competition.name}
              </option>
            ))}
          </select>
          <button type="button" onClick={downloadCsvTemplate} className="app-pill h-10 px-4">
            Descargar plantilla
          </button>
          <label className={`app-pill-active flex h-10 cursor-pointer items-center justify-center px-4 ${importing ? "pointer-events-none opacity-50" : ""}`}>
            {importing ? "Importando..." : "Subir CSV"}
            <input
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={(event) => {
                void importCsv(event.target.files?.[0] ?? null);
                event.target.value = "";
              }}
            />
          </label>
        </div>
        {bulkResult?.failed ? (
          <div className="border-y border-coral/25 py-3 text-sm text-coral">
            {bulkResult.rows.filter((row) => row.status === "failed").map((row) => (
              <p key={`${row.row_number}-${row.slug ?? "row"}`}>
                Fila {row.row_number}{row.name ? ` · ${row.name}` : ""}: {row.detail ?? "No se pudo importar"}
              </p>
            ))}
          </div>
        ) : null}
      </section>

      <section className="space-y-3">
        <h3 className="text-base font-semibold text-ink">Equipos registrados</h3>
        {loading ? <p className="mt-4 text-sm text-steel">Cargando equipos...</p> : null}
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
          <table className="min-w-[1080px] table-fixed text-left text-[11px] text-steel">
            <thead className="app-table-head">
              <tr>
                <th className="w-[210px] px-3 py-3">Competencia</th>
                <th className="w-[180px] px-3 py-3">Equipo</th>
                <th className="w-[90px] px-3 py-3">Short</th>
                <th className="w-[140px] px-3 py-3">Slug</th>
                <th className="w-[200px] px-3 py-3">Estadio</th>
                <th className="w-[220px] px-3 py-3">Colores</th>
                <th className="w-[100px] px-3 py-3">Acc</th>
              </tr>
            </thead>
            <tbody>
          {visibleTeams.map((team) => (
            <tr key={team.id} className="app-table-row border-b last:border-b-0">
              <td className="px-3 py-3 text-steel">
                {team.competition_names.length ? team.competition_names.join(", ") : "Sin asignar"}
              </td>
              <td className="px-3 py-3 font-medium text-ink">{team.name}</td>
              <td className="px-3 py-3 text-steel">{team.short_name}</td>
              <td className="px-3 py-3 text-steel">{team.slug}</td>
              <td className="px-3 py-3 text-steel">{team.home_venue ?? "-"}</td>
              <td className="px-3 py-3">
                {(team.primary_color || team.secondary_color || team.accent_color) ? (
                <div className="flex flex-wrap items-center gap-2">
                  {[team.primary_color, team.secondary_color, team.accent_color]
                    .filter((color): color is string => Boolean(color))
                    .map((color) => (
                      <div key={`${team.id}-${color}`} className="flex items-center gap-2 px-1 py-1 text-xs text-steel">
                        <span className="h-3 w-3 rounded-full" style={{ backgroundColor: color }} />
                        {color}
                      </div>
                    ))}
                </div>
                ) : (
                  <span className="text-steel">-</span>
                )}
              </td>
              <td className="px-3 py-3">
                <button type="button" onClick={() => beginEditTeam(team)} className="app-pill h-9 px-4 text-[11px]">
                  Editar
                </button>
              </td>
            </tr>
          ))}
            </tbody>
          </table>
          {!loading && visibleTeams.length === 0 ? (
            <p className="text-sm text-steel">Todavia no hay equipos cargados.</p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
