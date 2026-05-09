"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

import { backendFetch } from "@/lib/api/backend";
import { getBrowserAccessToken } from "@/lib/supabase/session";
import type { Season, Team, WorldCupAdminGroup } from "@/types/api";

type GroupFormState = {
  group_label: string;
  display_name: string;
  sort_order: string;
};

const initialGroupForm: GroupFormState = {
  group_label: "",
  display_name: "",
  sort_order: "100",
};

export function AdminWorldCupGroupsPanel() {
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [groups, setGroups] = useState<WorldCupAdminGroup[]>([]);
  const [selectedSeasonId, setSelectedSeasonId] = useState("");
  const [groupForm, setGroupForm] = useState<GroupFormState>(initialGroupForm);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [draftTeamsByGroupId, setDraftTeamsByGroupId] = useState<Record<string, string[]>>({});
  const [pendingTeamByGroupId, setPendingTeamByGroupId] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const worldCupSeasons = useMemo(
    () => seasons.filter((season) => season.tournament_format === "world_cup"),
    [seasons],
  );

  const selectedSeason = worldCupSeasons.find((season) => season.id === selectedSeasonId) ?? null;

  const eligibleTeams = useMemo(
    () =>
      teams.filter((team) =>
        selectedSeason?.competition_id ? team.competition_id === selectedSeason.competition_id : true,
      ),
    [selectedSeason?.competition_id, teams],
  );

  async function loadBase() {
    const [seasonRows, teamRows] = await Promise.all([
      backendFetch<Season[]>("/seasons"),
      backendFetch<Team[]>("/teams"),
    ]);
    const nextWorldCupSeasons = seasonRows.filter((season) => season.tournament_format === "world_cup");
    const nextSeasonId = nextWorldCupSeasons.find((season) => season.is_active)?.id ?? nextWorldCupSeasons[0]?.id ?? "";
    setSeasons(seasonRows);
    setTeams(teamRows);
    setSelectedSeasonId((current) => current || nextSeasonId);
    return nextSeasonId;
  }

  async function loadGroups(seasonId: string) {
    if (!seasonId) {
      setGroups([]);
      setDraftTeamsByGroupId({});
      setPendingTeamByGroupId({});
      return;
    }
    const accessToken = await getBrowserAccessToken();
    const rows = await backendFetch<WorldCupAdminGroup[]>(`/admin/world-cup/groups?season_id=${seasonId}`, accessToken);
    setGroups(rows);
    setDraftTeamsByGroupId(
      Object.fromEntries(rows.map((group) => [group.id, group.teams.map((team) => team.team_id)])),
    );
    setPendingTeamByGroupId({});
  }

  useEffect(() => {
    async function load() {
      try {
        const seasonId = await loadBase();
        await loadGroups(seasonId);
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "No se pudieron cargar los grupos mundialistas");
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  async function handleSeasonChange(seasonId: string) {
    setSelectedSeasonId(seasonId);
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      await loadGroups(seasonId);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudieron cargar los grupos");
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedSeasonId) {
      setError("Selecciona una temporada mundialista.");
      return;
    }
    setSaving("group");
    setError(null);
    setMessage(null);
    try {
      const accessToken = await getBrowserAccessToken();
      const path = editingGroupId ? `/admin/world-cup/groups/${editingGroupId}` : "/admin/world-cup/groups";
      const method = editingGroupId ? "PUT" : "POST";
      await backendFetch(path, accessToken, {
        method,
        body: JSON.stringify({
          season_id: selectedSeasonId,
          group_label: groupForm.group_label,
          display_name: groupForm.display_name || null,
          sort_order: Number(groupForm.sort_order || "100"),
        }),
      });
      await loadGroups(selectedSeasonId);
      setGroupForm(initialGroupForm);
      setEditingGroupId(null);
      setMessage(editingGroupId ? "Grupo actualizado." : "Grupo creado.");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo guardar el grupo");
    } finally {
      setSaving(null);
    }
  }

  async function handleDeleteGroup(groupId: string) {
    const confirmed = window.confirm("Vas a borrar este grupo mundialista. Continuar?");
    if (!confirmed) {
      return;
    }
    setSaving(`delete:${groupId}`);
    setError(null);
    setMessage(null);
    try {
      const accessToken = await getBrowserAccessToken();
      await backendFetch(`/admin/world-cup/groups/${groupId}`, accessToken, { method: "DELETE" });
      await loadGroups(selectedSeasonId);
      setMessage("Grupo borrado.");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo borrar el grupo");
    } finally {
      setSaving(null);
    }
  }

  function addTeam(groupId: string, teamId: string) {
    if (!teamId) {
      return;
    }
    setDraftTeamsByGroupId((current) => {
      const existing = current[groupId] ?? [];
      if (existing.includes(teamId)) {
        return current;
      }
      return {
        ...current,
        [groupId]: [...existing, teamId],
      };
    });
    setPendingTeamByGroupId((current) => ({ ...current, [groupId]: "" }));
  }

  function removeTeam(groupId: string, teamId: string) {
    setDraftTeamsByGroupId((current) => ({
      ...current,
      [groupId]: (current[groupId] ?? []).filter((row) => row !== teamId),
    }));
  }

  async function handleSaveTeams(groupId: string) {
    setSaving(`teams:${groupId}`);
    setError(null);
    setMessage(null);
    try {
      const accessToken = await getBrowserAccessToken();
      await backendFetch(`/admin/world-cup/groups/${groupId}/teams`, accessToken, {
        method: "PUT",
        body: JSON.stringify({ team_ids: draftTeamsByGroupId[groupId] ?? [] }),
      });
      await loadGroups(selectedSeasonId);
      setMessage("Equipos del grupo actualizados.");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudieron actualizar los equipos del grupo");
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="space-y-6">
      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.22em] text-ink">Grupos mundialistas</h2>
          <p className="mt-2 text-sm text-steel">
            Aqui defines los grupos y sus equipos. La tabla publica toma esta estructura como base para armar stats.
          </p>
        </div>

        <div className="max-w-[360px]">
          <select
            value={selectedSeasonId}
            onChange={(event) => void handleSeasonChange(event.target.value)}
            className="field-control"
          >
            <option value="">Selecciona temporada mundialista</option>
            {worldCupSeasons.map((season) => (
              <option key={season.id} value={season.id}>
                {season.name}
              </option>
            ))}
          </select>
        </div>

        <form onSubmit={handleSaveGroup} className="grid gap-4 md:grid-cols-3">
          <input
            value={groupForm.group_label}
            onChange={(event) => setGroupForm((current) => ({ ...current, group_label: event.target.value.toUpperCase() }))}
            placeholder="A"
            className="field-control"
            required
          />
          <input
            value={groupForm.display_name}
            onChange={(event) => setGroupForm((current) => ({ ...current, display_name: event.target.value }))}
            placeholder="Grupo A"
            className="field-control"
          />
          <input
            value={groupForm.sort_order}
            onChange={(event) => setGroupForm((current) => ({ ...current, sort_order: event.target.value }))}
            placeholder="100"
            className="field-control"
            inputMode="numeric"
          />
          <div className="md:col-span-3 flex flex-wrap gap-2">
            <button type="submit" disabled={saving === "group"} className="app-pill-active px-4 disabled:opacity-60">
              {saving === "group" ? "Guardando..." : editingGroupId ? "Actualizar grupo" : "Crear grupo"}
            </button>
            {editingGroupId ? (
              <button
                type="button"
                onClick={() => {
                  setEditingGroupId(null);
                  setGroupForm(initialGroupForm);
                }}
                className="app-pill px-4"
              >
                Cancelar
              </button>
            ) : null}
          </div>
        </form>

        {message ? <p className="text-sm text-moss">{message}</p> : null}
        {error ? <p className="text-sm text-coral">{error}</p> : null}
      </section>

      <section className="space-y-4">
        {loading ? <p className="text-sm text-steel">Cargando grupos...</p> : null}
        {!loading && groups.length === 0 ? (
          <p className="text-sm text-steel">Todavia no hay grupos definidos para esta temporada.</p>
        ) : null}

        <div className="grid gap-4 xl:grid-cols-2">
          {groups.map((group) => {
            const selectedTeamIds = draftTeamsByGroupId[group.id] ?? [];
            return (
              <div key={group.id} className="rounded-[18px] border border-white/[0.06] bg-white/[0.03] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-semibold text-ink">{group.display_name ?? `Grupo ${group.group_label}`}</h3>
                    <p className="mt-1 text-xs uppercase tracking-[0.16em] text-steel">
                      {selectedTeamIds.length} equipos asignados
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingGroupId(group.id);
                        setGroupForm({
                          group_label: group.group_label,
                          display_name: group.display_name ?? "",
                          sort_order: String(group.sort_order),
                        });
                      }}
                      className="app-pill px-3 text-[11px]"
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDeleteGroup(group.id)}
                      disabled={saving === `delete:${group.id}`}
                      className="app-pill px-3 text-[11px] disabled:opacity-60"
                    >
                      {saving === `delete:${group.id}` ? "..." : "Borrar"}
                    </button>
                  </div>
                </div>

                <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,240px)_minmax(0,1fr)]">
                  <div className="space-y-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-steel">Agregar equipo</p>
                    <select
                      value={pendingTeamByGroupId[group.id] ?? ""}
                      onChange={(event) =>
                        setPendingTeamByGroupId((current) => ({ ...current, [group.id]: event.target.value }))
                      }
                      className="field-control"
                    >
                      <option value="">Selecciona un equipo</option>
                      {eligibleTeams
                        .filter((team) => !selectedTeamIds.includes(team.id))
                        .map((team) => (
                          <option key={team.id} value={team.id}>
                            {team.short_name} · {team.name}
                          </option>
                        ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => addTeam(group.id, pendingTeamByGroupId[group.id] ?? "")}
                      disabled={!pendingTeamByGroupId[group.id]}
                      className="app-pill-active w-full px-4 text-[11px] disabled:opacity-60"
                    >
                      Agregar al grupo
                    </button>
                  </div>

                  <div className="space-y-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-steel">Equipos agregados</p>
                    {selectedTeamIds.length === 0 ? (
                      <div className="rounded-[14px] border border-dashed border-white/[0.08] px-4 py-5 text-sm text-steel">
                        Este grupo todavia no tiene equipos.
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {selectedTeamIds.map((teamId) => {
                          const team = eligibleTeams.find((row) => row.id === teamId);
                          if (!team) {
                            return null;
                          }
                          return (
                            <button
                              key={team.id}
                              type="button"
                              onClick={() => removeTeam(group.id, team.id)}
                              className="app-pill-active px-3 text-xs text-ink"
                            >
                              {team.short_name} · {team.name} ×
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between gap-3">
                  <p className="text-xs text-steel">
                    Usa esta pantalla para definir el grupo. Los partidos de fase de grupos siguen viviendo en `Partidos`.
                  </p>
                  <button
                    type="button"
                    onClick={() => void handleSaveTeams(group.id)}
                    disabled={saving === `teams:${group.id}`}
                    className="app-pill-active px-4 text-[11px] disabled:opacity-60"
                  >
                    {saving === `teams:${group.id}` ? "Guardando..." : "Guardar equipos"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
