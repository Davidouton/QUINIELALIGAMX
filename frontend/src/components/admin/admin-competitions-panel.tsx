"use client";

import { FormEvent, useEffect, useState } from "react";

import { backendFetch } from "@/lib/api/backend";
import { getBrowserAccessToken } from "@/lib/supabase/session";
import type { Competition } from "@/types/api";

type CompetitionFormState = {
  sport_name: string;
  name: string;
  slug: string;
  provider_league_id: string;
  is_active: boolean;
  sort_order: string;
};

const initialCompetitionForm: CompetitionFormState = {
  sport_name: "",
  name: "",
  slug: "",
  provider_league_id: "",
  is_active: true,
  sort_order: "100",
};

export function AdminCompetitionsPanel() {
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [competitionForm, setCompetitionForm] = useState<CompetitionFormState>(initialCompetitionForm);
  const [editingCompetitionId, setEditingCompetitionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function loadCompetitions() {
    const rows = await backendFetch<Competition[]>("/competitions");
    setCompetitions(rows);
  }

  useEffect(() => {
    async function load() {
      try {
        await loadCompetitions();
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "No se pudieron cargar las competencias");
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, []);

  async function handleSaveCompetition(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const accessToken = await getBrowserAccessToken();
      const path = editingCompetitionId ? `/admin/competitions/${editingCompetitionId}` : "/admin/competitions";
      const method = editingCompetitionId ? "PUT" : "POST";
      await backendFetch(path, accessToken, {
        method,
        body: JSON.stringify({
          ...competitionForm,
          provider_league_id: competitionForm.provider_league_id || null,
          sort_order: Number(competitionForm.sort_order || "100"),
        }),
      });
      await loadCompetitions();
      setCompetitionForm(initialCompetitionForm);
      setEditingCompetitionId(null);
      setMessage(editingCompetitionId ? "Competencia actualizada." : "Competencia creada.");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo guardar la competencia");
    } finally {
      setSaving(false);
    }
  }

  function beginEditCompetition(competition: Competition) {
    setEditingCompetitionId(competition.id);
    setCompetitionForm({
      sport_name: competition.sport_name,
      name: competition.name,
      slug: competition.slug,
      provider_league_id: competition.provider_league_id ?? "",
      is_active: competition.is_active,
      sort_order: String(competition.sort_order),
    });
    setError(null);
    setMessage(null);
  }

  function resetForm() {
    setEditingCompetitionId(null);
    setCompetitionForm(initialCompetitionForm);
    setError(null);
    setMessage(null);
  }

  return (
    <div className="space-y-6">
      <section className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-[0.22em] text-ink">
              {editingCompetitionId ? "Editar competencia" : "Crear competencia"}
            </h2>
            <p className="mt-2 text-sm text-steel">
              Aqui defines el contenedor base para ordenar equipos y temporadas: Liga MX, FIFA, NFL, MLB, etc.
            </p>
          </div>
          {editingCompetitionId ? (
            <button type="button" onClick={resetForm} className="app-pill px-4">
              Cancelar
            </button>
          ) : null}
        </div>

        <form onSubmit={handleSaveCompetition} className="grid gap-4 md:grid-cols-2">
          <input
            value={competitionForm.sport_name}
            onChange={(event) => setCompetitionForm((current) => ({ ...current, sport_name: event.target.value }))}
            placeholder="Futbol / Futbol Americano / Baseball"
            className="field-control"
            required
          />
          <input
            value={competitionForm.name}
            onChange={(event) => setCompetitionForm((current) => ({ ...current, name: event.target.value }))}
            placeholder="Liga MX / FIFA World Cup / NFL"
            className="field-control"
            required
          />
          <input
            value={competitionForm.slug}
            onChange={(event) => setCompetitionForm((current) => ({ ...current, slug: event.target.value }))}
            placeholder="liga-mx"
            className="field-control"
            required
          />
          <input
            value={competitionForm.provider_league_id}
            onChange={(event) =>
              setCompetitionForm((current) => ({ ...current, provider_league_id: event.target.value }))
            }
            placeholder="ID del proveedor / opcional"
            className="field-control"
          />
          <input
            value={competitionForm.sort_order}
            onChange={(event) => setCompetitionForm((current) => ({ ...current, sort_order: event.target.value }))}
            placeholder="100"
            className="field-control"
            inputMode="numeric"
          />
          <label className="flex items-center gap-3 text-sm text-ink">
            <input
              type="checkbox"
              checked={competitionForm.is_active}
              onChange={(event) =>
                setCompetitionForm((current) => ({ ...current, is_active: event.target.checked }))
              }
            />
            Competencia activa
          </label>
          <div className="md:col-span-2">
            <button type="submit" disabled={saving} className="app-pill-active px-4 disabled:opacity-60">
              {saving ? "Guardando..." : editingCompetitionId ? "Actualizar competencia" : "Crear competencia"}
            </button>
          </div>
        </form>

        {message ? <p className="mt-4 text-sm text-moss">{message}</p> : null}
        {error ? <p className="mt-4 text-sm text-coral">{error}</p> : null}
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-[0.22em] text-ink">Competencias registradas</h3>
        {loading ? <p className="mt-4 text-sm text-steel">Cargando competencias...</p> : null}
        <div className="no-scrollbar overflow-x-auto touch-pan-x">
          <table className="min-w-[760px] table-fixed text-left text-sm text-ink">
            <colgroup>
              <col className="w-[140px]" />
              <col className="w-[220px]" />
              <col className="w-[120px]" />
              <col className="w-[160px]" />
              <col className="w-[110px]" />
              <col className="w-[120px]" />
            </colgroup>
            <thead className="app-table-head">
              <tr>
                <th className="px-3 py-3">Deporte</th>
                <th className="px-3 py-3">Competencia</th>
                <th className="px-3 py-3">Slug</th>
                <th className="px-3 py-3">Proveedor</th>
                <th className="px-3 py-3">Estado</th>
                <th className="px-3 py-3">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {competitions.map((competition) => (
                <tr key={competition.id} className="app-table-row border-b last:border-b-0">
                  <td className="px-3 py-3 text-steel">{competition.sport_name}</td>
                  <td className="px-3 py-3 font-medium text-ink">{competition.name}</td>
                  <td className="px-3 py-3 text-steel">{competition.slug}</td>
                  <td className="px-3 py-3 text-steel">{competition.provider_league_id ?? "N/A"}</td>
                  <td className="px-3 py-3 text-steel">{competition.is_active ? "Activa" : "Inactiva"}</td>
                  <td className="px-3 py-3">
                    <button
                      type="button"
                      onClick={() => beginEditCompetition(competition)}
                      className="app-pill h-9 px-3 text-[11px]"
                    >
                      Editar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {!loading && competitions.length === 0 ? (
            <p className="text-sm text-steel">Todavia no hay competencias cargadas.</p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
