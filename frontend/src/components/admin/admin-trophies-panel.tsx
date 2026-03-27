"use client";

import { FormEvent, useEffect, useState } from "react";

import { backendFetch } from "@/lib/api/backend";
import { getBrowserAccessToken } from "@/lib/supabase/session";
import type { Season, TrophyAssetRecord } from "@/types/api";

type TrophyFormState = {
  name: string;
  season_id: string;
  matchday_number: string;
  award_place_label: string;
  image_url: string;
};

const initialForm: TrophyFormState = {
  name: "",
  season_id: "",
  matchday_number: "",
  award_place_label: "",
  image_url: "",
};

const BADGE_PLACE_OPTIONS = ["1er Lugar", "2do Lugar", "3er Lugar"] as const;

function isAwardAsset(row: TrophyAssetRecord) {
  return Boolean(row.matchday_number && row.award_place_label);
}

function AssetSection({
  title,
  emptyLabel,
  rows,
  seasons,
  loading,
  onEdit,
  onDelete,
}: {
  title: string;
  emptyLabel: string;
  rows: TrophyAssetRecord[];
  seasons: Season[];
  loading: boolean;
  onEdit: (row: TrophyAssetRecord) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-ink">{title}</h3>
          <p className="mt-1 text-xs text-steel">{rows.length} registros</p>
        </div>
      </div>
      {loading ? <p className="mt-4 text-sm text-steel">Cargando...</p> : null}
      <div className="no-scrollbar overflow-x-auto overscroll-x-contain touch-pan-x [WebkitOverflowScrolling:touch]">
        <table className="min-w-full table-fixed text-left text-[11px] text-steel">
          <thead className="app-table-head">
            <tr>
              <th className="w-[220px] px-3 py-3">Nombre</th>
              <th className="w-[220px] px-3 py-3">Ligado a</th>
              <th className="w-[320px] px-3 py-3">Imagen</th>
              <th className="w-[100px] px-3 py-3">Preview</th>
              <th className="w-[190px] px-3 py-3">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="app-table-row border-b last:border-b-0">
                <td className="px-3 py-3 font-medium text-ink">{row.name}</td>
                <td className="px-3 py-3 text-steel">
                  {row.season_id && row.matchday_number && row.award_place_label
                    ? `${seasons.find((season) => season.id === row.season_id)?.name ?? "Temporada"} · J${row.matchday_number} · ${row.award_place_label}`
                    : row.category}
                </td>
                <td className="px-3 py-3 text-steel">{row.image_url ?? "-"}</td>
                <td className="px-3 py-3">
                  {row.image_url ? (
                    <img src={row.image_url} alt={row.name} className="h-12 w-12 object-contain p-1" />
                  ) : (
                    <div className="flex h-12 w-12 items-center justify-center text-[10px] text-steel">
                      Sin
                    </div>
                  )}
                </td>
                <td className="px-3 py-3">
                  <div className="flex gap-2">
                    <button type="button" onClick={() => onEdit(row)} className="app-pill h-9 px-3 text-[11px]">
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(row.id)}
                      className="app-pill h-9 px-3 text-[11px]"
                    >
                      Borrar
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-sm text-steel">
                  {emptyLabel}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function AdminTrophiesPanel() {
  const [rows, setRows] = useState<TrophyAssetRecord[]>([]);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [form, setForm] = useState<TrophyFormState>(initialForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const trophyRows = rows.filter((row) => !isAwardAsset(row));
  const awardRows = rows.filter((row) => isAwardAsset(row));

  async function loadRows() {
    const accessToken = await getBrowserAccessToken();
    const [data, seasonRows] = await Promise.all([
      backendFetch<TrophyAssetRecord[]>("/admin/trophy-assets", accessToken),
      backendFetch<Season[]>("/seasons", accessToken),
    ]);
    setRows(data);
    setSeasons(seasonRows);
  }

  useEffect(() => {
    async function load() {
      try {
        await loadRows();
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "No se pudieron cargar los trofeos");
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
      const path = editingId ? `/admin/trophy-assets/${editingId}` : "/admin/trophy-assets";
      const method = editingId ? "PUT" : "POST";
      await backendFetch(path, accessToken, {
        method,
        body: JSON.stringify({
          name: form.name,
          asset_code: null,
          season_id: form.season_id || null,
          matchday_number: form.matchday_number ? Number(form.matchday_number) : null,
          award_place_label: form.award_place_label || null,
          image_url: form.image_url || null,
        }),
      });
      await loadRows();
      setForm(initialForm);
      setEditingId(null);
      setMessage(editingId ? "Asset actualizado." : "Asset agregado.");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo guardar el trofeo");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setError(null);
    setMessage(null);

    try {
      const accessToken = await getBrowserAccessToken();
      await backendFetch(`/admin/trophy-assets/${id}`, accessToken, { method: "DELETE" });
      await loadRows();
      setMessage("Trofeo eliminado.");
      if (editingId === id) {
        setEditingId(null);
        setForm(initialForm);
      }
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo eliminar el trofeo");
    }
  }

  return (
    <div className="space-y-6">
      <section className="space-y-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-ink">
              {editingId ? "Editar asset" : "Agregar asset"}
            </h2>
            <p className="mt-1 text-sm text-steel">
              Los assets se muestran separados abajo entre trofeos manuales y awards semanales.
            </p>
          </div>
          {editingId ? (
            <button
              type="button"
              onClick={() => {
                setEditingId(null);
                setForm(initialForm);
              }}
              className="app-pill px-4"
            >
              Cancelar
            </button>
          ) : null}
        </div>

        <form onSubmit={handleSubmit} className="mt-5 grid gap-4 md:grid-cols-3">
          <input
            value={form.name}
            onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            placeholder="Trofeo Campeon"
            className="field-control"
            required
          />
          <select
            value={form.season_id}
            onChange={(event) => setForm((current) => ({ ...current, season_id: event.target.value }))}
            className="field-control"
          >
            <option value="">Sin temporada fija</option>
            {seasons.map((season) => (
              <option key={season.id} value={season.id}>
                {season.name}
              </option>
            ))}
          </select>
          <input
            type="number"
            min="1"
            max="99"
            value={form.matchday_number}
            onChange={(event) => setForm((current) => ({ ...current, matchday_number: event.target.value }))}
            placeholder="Jornada"
            className="field-control"
          />
          <select
            value={form.award_place_label}
            onChange={(event) => setForm((current) => ({ ...current, award_place_label: event.target.value }))}
            className="field-control"
          >
            <option value="">Sin lugar fijo</option>
            {BADGE_PLACE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <input
            value={form.image_url}
            onChange={(event) => setForm((current) => ({ ...current, image_url: event.target.value }))}
            placeholder="https://...supabase.co/storage/v1/object/public/..."
            className="field-control md:col-span-2"
            required
          />
          <div className="md:col-span-3 grid gap-3 md:grid-cols-2">
            <div className="text-xs text-steel">
              <p className="font-semibold uppercase tracking-[0.18em] text-steel/80">Nombre</p>
              <p className="mt-1">Nombre genérico del trofeo o badge.</p>
            </div>
            <div className="text-xs text-steel">
              <p className="font-semibold uppercase tracking-[0.18em] text-steel/80">Imagen URL</p>
              <p className="mt-1">Liga pública de Supabase Storage.</p>
            </div>
            <div className="text-xs text-steel">
              <p className="font-semibold uppercase tracking-[0.18em] text-steel/80">Badge por jornada</p>
              <p className="mt-1">Si defines temporada + jornada + lugar, se otorgara en automatico al recalcular scoring.</p>
            </div>
          </div>
          <div className="md:col-span-3">
            <button type="submit" disabled={saving} className="app-pill-active px-4 disabled:opacity-60">
              {saving ? "Guardando..." : editingId ? "Actualizar" : "Guardar"}
            </button>
          </div>
        </form>

        {message ? <p className="mt-4 text-sm text-moss">{message}</p> : null}
        {error ? <p className="mt-4 text-sm text-coral">{error}</p> : null}
      </section>

      <AssetSection
        title="Trofeos manuales"
        emptyLabel="Todavia no hay trofeos manuales cargados."
        rows={trophyRows}
        seasons={seasons}
        loading={loading}
        onEdit={(row) => {
          setEditingId(row.id);
          setForm({
            name: row.name,
            season_id: row.season_id ?? "",
            matchday_number: row.matchday_number ? String(row.matchday_number) : "",
            award_place_label: row.award_place_label ?? "",
            image_url: row.image_url ?? "",
          });
        }}
        onDelete={(id) => void handleDelete(id)}
      />
      <AssetSection
        title="Awards semanales"
        emptyLabel="Todavia no hay awards semanales cargados."
        rows={awardRows}
        seasons={seasons}
        loading={loading}
        onEdit={(row) => {
          setEditingId(row.id);
          setForm({
            name: row.name,
            season_id: row.season_id ?? "",
            matchday_number: row.matchday_number ? String(row.matchday_number) : "",
            award_place_label: row.award_place_label ?? "",
            image_url: row.image_url ?? "",
          });
        }}
        onDelete={(id) => void handleDelete(id)}
      />
    </div>
  );
}
