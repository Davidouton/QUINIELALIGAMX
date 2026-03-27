"use client";

import { FormEvent, useEffect, useState } from "react";

import { backendFetch } from "@/lib/api/backend";
import { formatMexicoCityDateTime } from "@/lib/datetime/mexico-city";
import { getBrowserAccessToken } from "@/lib/supabase/session";
import type { AdminSettings, Matchday, Season } from "@/types/api";

type SettingsFormState = {
  active_season_id: string;
  start_matchday_id: string;
  end_matchday_id: string;
  result_correct_points: string;
  exact_score_points: string;
};

const initialForm: SettingsFormState = {
  active_season_id: "",
  start_matchday_id: "",
  end_matchday_id: "",
  result_correct_points: "3",
  exact_score_points: "2",
};

export function AdminSettingsPanel() {
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [matchdays, setMatchdays] = useState<Matchday[]>([]);
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [form, setForm] = useState<SettingsFormState>(initialForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function loadSettings() {
    const accessToken = await getBrowserAccessToken();
    const [seasonRows, matchdayRows, settingsResponse] = await Promise.all([
      backendFetch<Season[]>("/seasons", accessToken),
      backendFetch<Matchday[]>("/matchdays", accessToken),
      backendFetch<AdminSettings>("/admin/settings", accessToken),
    ]);

    const fallbackSeasonId = settingsResponse.active_season_id ?? seasonRows[0]?.id ?? "";
    setSeasons(seasonRows);
    setMatchdays(matchdayRows);
    setSettings(settingsResponse);
    setForm({
      active_season_id: fallbackSeasonId,
      start_matchday_id: settingsResponse.start_matchday_id ?? "",
      end_matchday_id: settingsResponse.end_matchday_id ?? "",
      result_correct_points: String(settingsResponse.result_correct_points),
      exact_score_points: String(settingsResponse.exact_score_points),
    });
  }

  useEffect(() => {
    async function runLoad() {
      try {
        await loadSettings();
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "No se pudo cargar la configuracion");
      } finally {
        setLoading(false);
      }
    }

    void runLoad();
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const accessToken = await getBrowserAccessToken();
      const result = await backendFetch<AdminSettings>("/admin/settings", accessToken, {
        method: "PUT",
        body: JSON.stringify({
          active_season_id: form.active_season_id,
          start_matchday_id: form.start_matchday_id || null,
          end_matchday_id: form.end_matchday_id || null,
          entry_fee_amount: settings?.entry_fee_amount ?? 0,
          weekly_first_place_amount: settings?.weekly_first_place_amount ?? 0,
          weekly_second_place_amount: settings?.weekly_second_place_amount ?? 0,
          weekly_third_place_amount: settings?.weekly_third_place_amount ?? 0,
          admin_commission_pct: settings?.admin_commission_pct ?? 0,
          reserve_pct: settings?.reserve_pct ?? 0,
          first_place_pct: settings?.first_place_pct ?? 0,
          second_place_pct: settings?.second_place_pct ?? 0,
          third_place_pct: settings?.third_place_pct ?? 0,
          result_correct_points: Number(form.result_correct_points),
          exact_score_points: Number(form.exact_score_points),
        }),
      });
      await loadSettings();
      setMessage(
        [
          "Configuracion guardada.",
          result.participants_lock_at
            ? `Corte de participantes: ${formatMexicoCityDateTime(result.participants_lock_at)}.`
            : null,
          result.evaluated_picks !== null ? `${result.evaluated_picks} picks recalculados.` : null,
          result.weekly_leaders !== null ? `${result.weekly_leaders} lideres semanales actualizados.` : null,
        ]
          .filter(Boolean)
          .join(" "),
      );
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo guardar la configuracion");
    } finally {
      setSaving(false);
    }
  }

  const activeSeason = seasons.find((season) => season.id === form.active_season_id) ?? null;
  const seasonMatchdays = matchdays
    .filter((matchday) => matchday.season_id === form.active_season_id)
    .sort((left, right) => left.number - right.number);

  return (
    <div className="space-y-6">
      <section className="space-y-4">
        <form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-2">
          <label className="space-y-2 md:col-span-2">
            <span className="text-sm text-steel">Torneo activo</span>
            <select
              value={form.active_season_id}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  active_season_id: event.target.value,
                  start_matchday_id: "",
                  end_matchday_id: "",
                }))
              }
              className="field-control"
              required
              disabled={loading || seasons.length === 0}
            >
              <option value="" disabled>
                {loading ? "Cargando torneos..." : "Selecciona un torneo"}
              </option>
              {seasons.map((season) => (
                <option key={season.id} value={season.id}>
                  {season.name}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-2 md:col-span-2">
            <span className="text-sm text-steel">Jornada de inicio del torneo</span>
            <select
              value={form.start_matchday_id}
              onChange={(event) => setForm((current) => ({ ...current, start_matchday_id: event.target.value }))}
              className="field-control"
              disabled={loading || !form.active_season_id}
            >
              <option value="">Sin corte configurado</option>
              {seasonMatchdays.map((matchday) => (
                <option key={matchday.id} value={matchday.id}>
                  Jornada {matchday.number} · {matchday.name}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-2 md:col-span-2">
            <span className="text-sm text-steel">Jornada final del torneo</span>
            <select
              value={form.end_matchday_id}
              onChange={(event) => setForm((current) => ({ ...current, end_matchday_id: event.target.value }))}
              className="field-control"
              disabled={loading || !form.active_season_id}
            >
              <option value="">Ultima jornada disponible</option>
              {seasonMatchdays.map((matchday) => (
                <option key={matchday.id} value={matchday.id}>
                  Jornada {matchday.number} · {matchday.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center justify-between gap-3 py-2">
            <span className="text-sm text-steel">Puntos por ganador</span>
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              value={form.result_correct_points}
              onChange={(event) =>
                setForm((current) => ({ ...current, result_correct_points: event.target.value }))
              }
              className="w-20 rounded-xl bg-white/[0.06] px-3 py-2 text-right text-sm font-semibold text-ink outline-none transition focus:bg-white/[0.1]"
              required
            />
          </label>

          <label className="flex items-center justify-between gap-3 py-2">
            <span className="text-sm text-steel">Puntos por marcador exacto</span>
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              value={form.exact_score_points}
              onChange={(event) =>
                setForm((current) => ({ ...current, exact_score_points: event.target.value }))
              }
              className="w-20 rounded-xl bg-white/[0.06] px-3 py-2 text-right text-sm font-semibold text-ink outline-none transition focus:bg-white/[0.1]"
              required
            />
          </label>

          <div className="md:col-span-2">
            <button
              type="submit"
              disabled={saving || loading || seasons.length === 0 || !form.active_season_id}
              className="secondary-button disabled:opacity-60"
            >
              {saving ? "Guardando..." : "Guardar"}
            </button>
          </div>
        </form>

        {message ? <p className="mt-4 text-sm text-moss">{message}</p> : null}
        {error ? <p className="mt-4 text-sm text-coral">{error}</p> : null}
        {!loading && seasons.length === 0 ? (
          <p className="mt-4 text-sm text-steel">Primero crea al menos una temporada para poder activarla aqui.</p>
        ) : null}
      </section>

      <section className="space-y-4">
        <h3 className="text-sm font-semibold uppercase tracking-[0.22em] text-ink">Reglas en uso</h3>
        <div className="space-y-1">
          <div className="grid grid-cols-[1.15fr_1fr] gap-4 px-3 py-2 text-[10px] uppercase tracking-[0.18em] text-steel">
            <p>Regla</p>
            <p className="text-right">Valor</p>
          </div>
          <div className="grid grid-cols-[1.15fr_1fr] gap-4 px-3 py-2">
            <p className="text-sm text-steel">Torneo activo</p>
            <p className="text-right text-sm font-medium text-ink">{activeSeason?.name ?? "Sin torneo activo"}</p>
          </div>
          <div className="grid grid-cols-[1.15fr_1fr] gap-4 px-3 py-2">
            <p className="text-sm text-steel">Jornada de inicio</p>
            <div className="text-right">
              <p className="text-sm font-medium text-ink">
                {seasonMatchdays.find((matchday) => matchday.id === form.start_matchday_id)?.name ?? "Sin definir"}
              </p>
              {settings?.participants_lock_at ? (
                <p className="mt-1 text-[11px] text-steel">
                  Corte: {formatMexicoCityDateTime(settings.participants_lock_at)}
                </p>
              ) : null}
            </div>
          </div>
          <div className="grid grid-cols-[1.15fr_1fr] gap-4 px-3 py-2">
            <p className="text-sm text-steel">Participantes confirmados</p>
            <div className="text-right">
              <p className="text-sm font-medium text-ink">{settings?.confirmed_participants ?? 0}</p>
              <p className="mt-1 text-[11px] text-steel">
                {settings?.participants_locked ? "Listado congelado" : "Listado editable"}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-[1.15fr_1fr] gap-4 px-3 py-2">
            <p className="text-sm text-steel">Jornada final</p>
            <p className="text-right text-sm font-medium text-ink">
              {seasonMatchdays.find((matchday) => matchday.id === form.end_matchday_id)?.name ?? "Ultima disponible"}
            </p>
          </div>
          <div className="grid grid-cols-[1.15fr_1fr] gap-4 px-3 py-2">
            <p className="text-sm text-steel">Ganador correcto</p>
            <p className="text-right text-sm font-medium text-ink">{form.result_correct_points} pts</p>
          </div>
          <div className="grid grid-cols-[1.15fr_1fr] gap-4 px-3 py-2">
            <p className="text-sm text-steel">Marcador exacto</p>
            <p className="text-right text-sm font-medium text-ink">{form.exact_score_points} pts</p>
          </div>
        </div>
      </section>
    </div>
  );
}
