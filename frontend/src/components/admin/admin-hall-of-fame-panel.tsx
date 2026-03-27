"use client";

import { FormEvent, useEffect, useState } from "react";

import { backendFetch } from "@/lib/api/backend";
import { getBrowserAccessToken } from "@/lib/supabase/session";
import type { AdminUser, HistoricalChampionRecord, Season, TrophyAssetRecord } from "@/types/api";

type ChampionFormState = {
  tournament_name: string;
  user_name: string;
  awarded_profile_id: string;
  place_label: string;
  trophy_asset_id: string;
  total_points: string;
};

const initialForm: ChampionFormState = {
  tournament_name: "",
  user_name: "",
  awarded_profile_id: "",
  place_label: "Campeon",
  trophy_asset_id: "",
  total_points: "",
};

const PLACE_OPTIONS = [
  "Campeon",
  "2do Lugar",
  "3er Lugar",
  "Record de Puntos Torneo Regular",
  "Record de Puntos Liguilla",
  "Record de Puntos Jornada",
] as const;

function isAwardAsset(trophy: TrophyAssetRecord) {
  return Boolean(trophy.matchday_number && trophy.award_place_label);
}

export function AdminHallOfFamePanel() {
  const [rows, setRows] = useState<HistoricalChampionRecord[]>([]);
  const [trophies, setTrophies] = useState<TrophyAssetRecord[]>([]);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [form, setForm] = useState<ChampionFormState>(initialForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function loadRows() {
    const accessToken = await getBrowserAccessToken();
    const [champions, trophyAssets, seasonRows, adminUsers] = await Promise.all([
      backendFetch<HistoricalChampionRecord[]>("/admin/historical-champions", accessToken),
      backendFetch<TrophyAssetRecord[]>("/admin/trophy-assets", accessToken),
      backendFetch<Season[]>("/seasons", accessToken),
      backendFetch<AdminUser[]>("/admin/users", accessToken),
    ]);
    setRows(champions);
    setTrophies(trophyAssets);
    setSeasons(seasonRows);
    setUsers(adminUsers);
  }

  useEffect(() => {
    async function load() {
      try {
        await loadRows();
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "No se pudo cargar el historico de campeones");
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const accessToken = await getBrowserAccessToken();
      const path = editingId ? `/admin/historical-champions/${editingId}` : "/admin/historical-champions";
      const method = editingId ? "PUT" : "POST";
      await backendFetch(path, accessToken, {
        method,
        body: JSON.stringify({
          tournament_name: form.tournament_name,
          user_name: form.user_name,
          awarded_profile_id: form.awarded_profile_id || null,
          place_label: form.place_label,
          trophy_asset_id: form.trophy_asset_id || null,
          total_points: Number(form.total_points),
        }),
      });
      await loadRows();
      setForm(initialForm);
      setEditingId(null);
      setMessage(editingId ? "Registro historico actualizado." : "Registro historico agregado.");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo guardar el campeon historico");
    } finally {
      setSaving(false);
    }
  }

  const tournamentOptions = Array.from(
    new Set([
      "Historico",
      ...seasons.map((season) => season.name),
      ...rows.map((row) => row.tournament_name),
    ]),
  );
  const manualTrophies = trophies.filter((trophy) => !isAwardAsset(trophy));
  const weeklyAwards = trophies.filter((trophy) => isAwardAsset(trophy));

  async function handleDelete(id: string) {
    setError(null);
    setMessage(null);

    try {
      const accessToken = await getBrowserAccessToken();
      await backendFetch(`/admin/historical-champions/${id}`, accessToken, { method: "DELETE" });
      await loadRows();
      setMessage("Registro eliminado.");
      if (editingId === id) {
        setEditingId(null);
        setForm(initialForm);
      }
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo eliminar el registro");
    }
  }

  return (
    <div className="space-y-6">
      <section className="space-y-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-ink">
              {editingId ? "Editar registro historico" : "Agregar registro historico"}
            </h2>
          </div>
          {editingId ? (
            <button
              type="button"
              onClick={() => {
                setEditingId(null);
                setForm(initialForm);
              }}
              className="secondary-button"
            >
              Cancelar
            </button>
          ) : null}
        </div>

        <form onSubmit={handleSubmit} className="mt-5 grid gap-4 md:grid-cols-5">
          <select
            value={form.tournament_name}
            onChange={(event) => setForm((current) => ({ ...current, tournament_name: event.target.value }))}
            className="field-control"
            required
          >
            <option value="">Selecciona torneo</option>
            {tournamentOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <select
            value={form.awarded_profile_id}
            onChange={(event) => {
              const profileId = event.target.value;
              const selectedUser = users.find((user) => user.id === profileId) ?? null;
              setForm((current) => ({
                ...current,
                awarded_profile_id: profileId,
                user_name: selectedUser?.display_name ?? current.user_name,
              }));
            }}
            className="field-control"
          >
            <option value="">Sin ligar a usuario</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.display_name} {user.email ? `· ${user.email}` : ""}
              </option>
            ))}
          </select>
          <input
            value={form.user_name}
            onChange={(event) => setForm((current) => ({ ...current, user_name: event.target.value }))}
            placeholder="Nombre visible"
            className="field-control"
            required
          />
          <select
            value={form.place_label}
            onChange={(event) => setForm((current) => ({ ...current, place_label: event.target.value }))}
            className="field-control"
          >
            {PLACE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <select
            value={form.trophy_asset_id}
            onChange={(event) => setForm((current) => ({ ...current, trophy_asset_id: event.target.value }))}
            className="field-control"
          >
            <option value="">Sin trofeo</option>
            {manualTrophies.length > 0 ? (
              <optgroup label="Trofeos">
                {manualTrophies.map((trophy) => (
                  <option key={trophy.id} value={trophy.id}>
                    {trophy.name} · {trophy.category}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {weeklyAwards.length > 0 ? (
              <optgroup label="Awards semanales">
                {weeklyAwards.map((trophy) => (
                  <option key={trophy.id} value={trophy.id}>
                    {trophy.name} · J{trophy.matchday_number} · {trophy.award_place_label}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </select>
          <input
            type="number"
            min="0"
            value={form.total_points}
            onChange={(event) => setForm((current) => ({ ...current, total_points: event.target.value }))}
            placeholder="142"
            className="field-control"
            required
          />
          <div className="md:col-span-5">
            <p className="mb-3 text-xs text-steel">
              Los trofeos historicos y los awards semanales ya aparecen separados para no mezclar insignias automaticas con premios manuales.
            </p>
            <button type="submit" disabled={saving} className="primary-button disabled:opacity-60">
              {saving ? "Guardando..." : editingId ? "Actualizar" : "Guardar"}
            </button>
          </div>
        </form>

        {message ? <p className="mt-4 text-sm text-moss">{message}</p> : null}
        {error ? <p className="mt-4 text-sm text-coral">{error}</p> : null}
      </section>

      <section className="space-y-3">
        <h3 className="text-base font-semibold text-ink">Historico cargado</h3>
        {loading ? <p className="mt-4 text-sm text-steel">Cargando historico...</p> : null}
        <div className="no-scrollbar overflow-x-auto overscroll-x-contain touch-pan-x [WebkitOverflowScrolling:touch]">
          <table className="min-w-full table-fixed text-left text-[11px] text-steel">
            <thead className="text-[10px] uppercase tracking-[0.16em] text-steel/80">
              <tr>
                <th className="w-[240px] px-3 py-3 font-medium">Torneo</th>
                <th className="w-[220px] px-3 py-3 font-medium">Usuario</th>
                <th className="w-[160px] px-3 py-3 font-medium">Ligado</th>
                <th className="w-[260px] px-3 py-3 font-medium">Lugar</th>
                <th className="w-[240px] px-3 py-3 font-medium">Trofeo</th>
                <th className="w-[120px] px-3 py-3 font-medium">Puntos</th>
                <th className="w-[190px] px-3 py-3 font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td className="px-3 py-3 font-medium text-ink">{row.tournament_name}</td>
              <td className="px-3 py-3 text-ink">{row.user_name}</td>
              <td className="px-3 py-3 text-steel">{row.awarded_profile_id ? "Si" : "No"}</td>
              <td className="px-3 py-3 text-steel">{row.place_label}</td>
              <td className="px-3 py-3 text-steel">{row.trophy_name ?? "-"}</td>
              <td className="px-3 py-3 text-ink">{row.total_points}</td>
              <td className="px-3 py-3">
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(row.id);
                      setForm({
                        tournament_name: row.tournament_name,
                        user_name: row.user_name,
                        awarded_profile_id: row.awarded_profile_id ?? "",
                        place_label: row.place_label,
                        trophy_asset_id: row.trophy_asset_id ?? "",
                        total_points: String(row.total_points),
                      });
                    }}
                    className="secondary-button"
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete(row.id)}
                    className="secondary-button border-coral/35 bg-coral/10 text-coral hover:border-coral/60 hover:bg-coral/15"
                  >
                    Borrar
                  </button>
                </div>
              </td>
            </tr>
          ))}
              {!loading && rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-sm text-steel">
                    Todavia no hay historico cargado.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
