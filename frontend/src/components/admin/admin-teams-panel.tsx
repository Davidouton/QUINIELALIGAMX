"use client";

import { FormEvent, useEffect, useState } from "react";

import { backendFetch } from "@/lib/api/backend";
import { getBrowserAccessToken } from "@/lib/supabase/session";
import type { Team } from "@/types/api";

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

function toColorInputValue(value: string) {
  return /^#[0-9A-F]{6}$/i.test(value) ? value : "#000000";
}

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

export function AdminTeamsPanel() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamForm, setTeamForm] = useState<TeamFormState>(initialTeamForm);
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function loadTeams() {
    const rows = await backendFetch<Team[]>("/teams");
    setTeams(rows);
  }

  useEffect(() => {
    async function load() {
      try {
        await loadTeams();
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
          <input
            value={teamForm.primary_color}
            onChange={(event) => setTeamForm((current) => ({ ...current, primary_color: event.target.value.toUpperCase() }))}
            placeholder="#001F5B color principal"
            className="field-control"
          />
          <input
            value={teamForm.secondary_color}
            onChange={(event) => setTeamForm((current) => ({ ...current, secondary_color: event.target.value.toUpperCase() }))}
            placeholder="#FFD100 color secundario"
            className="field-control"
          />
          <input
            value={teamForm.accent_color}
            onChange={(event) => setTeamForm((current) => ({ ...current, accent_color: event.target.value.toUpperCase() }))}
            placeholder="#E10600 color acento"
            className="field-control md:col-span-2"
          />
          <div className="grid gap-4 md:col-span-2 md:grid-cols-3">
            <label className="space-y-2 text-sm">
              <span className="text-steel">Color principal</span>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={toColorInputValue(teamForm.primary_color)}
                  onChange={(event) =>
                    setTeamForm((current) => ({ ...current, primary_color: event.target.value.toUpperCase() }))
                  }
                  className="h-11 w-16 rounded-xl bg-transparent"
                />
                <input
                  value={teamForm.primary_color}
                  onChange={(event) =>
                    setTeamForm((current) => ({ ...current, primary_color: event.target.value.toUpperCase() }))
                  }
                  placeholder="#001F5B"
                  className="field-control"
                />
              </div>
            </label>
            <label className="space-y-2 text-sm">
              <span className="text-steel">Color secundario</span>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={toColorInputValue(teamForm.secondary_color)}
                  onChange={(event) =>
                    setTeamForm((current) => ({ ...current, secondary_color: event.target.value.toUpperCase() }))
                  }
                  className="h-11 w-16 rounded-xl bg-transparent"
                />
                <input
                  value={teamForm.secondary_color}
                  onChange={(event) =>
                    setTeamForm((current) => ({ ...current, secondary_color: event.target.value.toUpperCase() }))
                  }
                  placeholder="#FFD100"
                  className="field-control"
                />
              </div>
            </label>
            <label className="space-y-2 text-sm">
              <span className="text-steel">Color acento</span>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={toColorInputValue(teamForm.accent_color)}
                  onChange={(event) =>
                    setTeamForm((current) => ({ ...current, accent_color: event.target.value.toUpperCase() }))
                  }
                  className="h-11 w-16 rounded-xl bg-transparent"
                />
                <input
                  value={teamForm.accent_color}
                  onChange={(event) =>
                    setTeamForm((current) => ({ ...current, accent_color: event.target.value.toUpperCase() }))
                  }
                  placeholder="#E10600"
                  className="field-control"
                />
              </div>
            </label>
          </div>
          <button type="submit" disabled={saving} className="app-pill-active w-fit px-4 disabled:opacity-60">
            {saving ? "Guardando..." : editingTeamId ? "Actualizar equipo" : "Crear equipo"}
          </button>
        </form>
        {message ? <p className="mt-4 text-sm text-moss">{message}</p> : null}
        {error ? <p className="mt-4 text-sm text-coral">{error}</p> : null}
      </section>

      <section className="space-y-3">
        <h3 className="text-base font-semibold text-ink">Equipos registrados</h3>
        {loading ? <p className="mt-4 text-sm text-steel">Cargando equipos...</p> : null}
        <div className="no-scrollbar overflow-x-auto overscroll-x-contain touch-pan-x [WebkitOverflowScrolling:touch]">
          <table className="min-w-full table-fixed text-left text-[11px] text-steel">
            <thead className="app-table-head">
              <tr>
                <th className="w-[180px] px-3 py-3">Equipo</th>
                <th className="w-[90px] px-3 py-3">Short</th>
                <th className="w-[140px] px-3 py-3">Slug</th>
                <th className="w-[200px] px-3 py-3">Estadio</th>
                <th className="w-[220px] px-3 py-3">Colores</th>
                <th className="w-[100px] px-3 py-3">Acc</th>
              </tr>
            </thead>
            <tbody>
          {teams.map((team) => (
            <tr key={team.id} className="app-table-row border-b last:border-b-0">
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
          {!loading && teams.length === 0 ? (
            <p className="text-sm text-steel">Todavia no hay equipos cargados.</p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
