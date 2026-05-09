"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

import { backendFetch } from "@/lib/api/backend";
import { getBrowserAccessToken } from "@/lib/supabase/session";
import type { Competition, Season, TournamentFormat } from "@/types/api";

type SeasonFormState = {
  name: string;
  slug: string;
  competition_id: string;
  tournament_format: TournamentFormat;
  is_active: boolean;
};

const initialSeasonForm: SeasonFormState = {
  name: "",
  slug: "",
  competition_id: "",
  tournament_format: "standard",
  is_active: false,
};

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

  async function loadSeasons() {
    const rows = await backendFetch<Season[]>("/seasons");
    setSeasons(rows);
  }

  useEffect(() => {
    async function load() {
      try {
        const [seasonRows, competitionRows] = await Promise.all([
          backendFetch<Season[]>("/seasons"),
          backendFetch<Competition[]>("/competitions"),
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
          competition_id: seasonForm.competition_id || null,
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
    setSaving(`season:${season.id}`);
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
          is_active: true,
        }),
      });
      await loadSeasons();
      setMessage(`Temporada activa: ${season.name}.`);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo activar la temporada");
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

        <form onSubmit={handleSaveSeason} className="space-y-4">
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
            placeholder="cl26"
            className="field-control"
            required
          />
          <select
            value={seasonForm.competition_id}
            onChange={(event) =>
              setSeasonForm((current) => ({ ...current, competition_id: event.target.value }))
            }
            className="field-control"
          >
            <option value="">Sin competencia base</option>
            {competitions.map((competition) => (
              <option key={competition.id} value={competition.id}>
                {competition.sport_name} · {competition.name}
              </option>
            ))}
          </select>
          <select
            value={seasonForm.tournament_format}
            onChange={(event) =>
              setSeasonForm((current) => ({
                ...current,
                tournament_format: event.target.value as TournamentFormat,
              }))
            }
            className="field-control"
          >
            <option value="standard">Liga / torneo normal</option>
            <option value="world_cup">Mundial</option>
          </select>
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
        <div className="no-scrollbar overflow-x-auto touch-pan-x">
          <table className="min-w-[860px] table-fixed text-left text-sm text-ink">
            <colgroup>
              <col className="w-[180px]" />
              <col className="w-[200px]" />
              <col className="w-[110px]" />
              <col className="w-[130px]" />
              <col className="w-[110px]" />
              <col className="w-[190px]" />
            </colgroup>
            <thead className="app-table-head">
              <tr>
                <th className="px-3 py-3">Competencia</th>
                <th className="px-3 py-3">Temporada</th>
                <th className="px-3 py-3">Slug</th>
                <th className="px-3 py-3">Formato</th>
                <th className="px-3 py-3">Estado</th>
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
                    {season.tournament_format === "world_cup" ? "Mundial" : "Standard"}
                  </td>
                  <td className="px-3 py-3 text-steel">{season.is_active ? "Activa" : "Historica"}</td>
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
                            is_active: season.is_active,
                          });
                        }}
                        className="app-pill h-9 min-w-[76px] px-3 text-[11px]"
                      >
                        Editar
                      </button>
                      {!season.is_active ? (
                        <button
                          type="button"
                          onClick={() => void handleSetActiveSeason(season)}
                          disabled={saving === `season:${season.id}`}
                          className="app-pill h-9 min-w-[76px] px-3 text-[11px]"
                        >
                          {saving === `season:${season.id}` ? "..." : "Act"}
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
