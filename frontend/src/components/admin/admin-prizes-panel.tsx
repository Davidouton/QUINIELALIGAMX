"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

import { backendFetch } from "@/lib/api/backend";
import { getBrowserAccessToken } from "@/lib/supabase/session";
import type { AdminSettings, Season } from "@/types/api";

type PrizeFormState = {
  entry_fee_amount: string;
  weekly_first_place_amount: string;
  weekly_second_place_amount: string;
  weekly_third_place_amount: string;
  admin_commission_pct: string;
  reserve_pct: string;
  first_place_pct: string;
  second_place_pct: string;
  third_place_pct: string;
};

const initialForm: PrizeFormState = {
  entry_fee_amount: "0",
  weekly_first_place_amount: "0",
  weekly_second_place_amount: "0",
  weekly_third_place_amount: "0",
  admin_commission_pct: "0",
  reserve_pct: "0",
  first_place_pct: "0",
  second_place_pct: "0",
  third_place_pct: "0",
};

function mapSettingsToPrizeForm(settings: AdminSettings): PrizeFormState {
  return {
    entry_fee_amount: String(settings.entry_fee_amount),
    weekly_first_place_amount: String(settings.weekly_first_place_amount),
    weekly_second_place_amount: String(settings.weekly_second_place_amount),
    weekly_third_place_amount: String(settings.weekly_third_place_amount),
    admin_commission_pct: String(settings.admin_commission_pct),
    reserve_pct: String(settings.reserve_pct),
    first_place_pct: String(settings.first_place_pct),
    second_place_pct: String(settings.second_place_pct),
    third_place_pct: String(settings.third_place_pct),
  };
}

export function AdminPrizesPanel() {
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [selectedSeasonId, setSelectedSeasonId] = useState("");
  const [prizeScope, setPrizeScope] = useState<"season" | "survivor">("season");
  const [form, setForm] = useState<PrizeFormState>(initialForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function loadPrizeSettings(seasonId?: string, scope: "season" | "survivor" = prizeScope) {
    const accessToken = await getBrowserAccessToken();
    const params = new URLSearchParams({ prize_scope: scope });
    if (seasonId) params.set("season_id", seasonId);
    const [seasonRows, settingsResponse] = await Promise.all([
      backendFetch<Season[]>("/seasons", accessToken),
      backendFetch<AdminSettings>(`/admin/settings?${params.toString()}`, accessToken),
    ]);

    setSeasons(seasonRows);
    setSettings(settingsResponse);
    setSelectedSeasonId(settingsResponse.selected_season_id ?? settingsResponse.active_season_id ?? "");
    setPrizeScope(settingsResponse.prize_scope);
    setForm(mapSettingsToPrizeForm(settingsResponse));
  }

  useEffect(() => {
    async function runLoad() {
      try {
        await loadPrizeSettings();
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "No se pudo cargar premios");
      } finally {
        setLoading(false);
      }
    }

    void runLoad();
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings) {
      setError("Todavia no termina de cargar la configuracion de premios.");
      return;
    }
    if (!selectedSeasonId) {
      setError("Selecciona una temporada para editar sus premios.");
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const accessToken = await getBrowserAccessToken();
      const savedSettings = await backendFetch<AdminSettings>(
        "/admin/settings?set_active=false&update_prizes=true&update_pricing=true",
        accessToken,
        {
        method: "PUT",
        body: JSON.stringify({
          active_season_id: selectedSeasonId,
          prize_scope: prizeScope,
          app_icon_url: settings.app_icon_url,
          show_live_tab: settings.show_live_tab,
          start_matchday_id: settings.start_matchday_id,
          end_matchday_id: settings.end_matchday_id,
          entry_fee_amount: Number(form.entry_fee_amount),
          weekly_first_place_amount: Number(form.weekly_first_place_amount),
          weekly_second_place_amount: Number(form.weekly_second_place_amount),
          weekly_third_place_amount: Number(form.weekly_third_place_amount),
          admin_commission_pct: Number(form.admin_commission_pct),
          commission_allocations: [],
          reserve_pct: Number(form.reserve_pct),
          first_place_pct: Number(form.first_place_pct),
          second_place_pct: Number(form.second_place_pct),
          third_place_pct: Number(form.third_place_pct),
          result_correct_points: settings.result_correct_points,
          exact_score_points: settings.exact_score_points,
          advancing_team_points: settings.advancing_team_points,
        }),
        },
      );
      setSettings(savedSettings);
      setSelectedSeasonId(savedSettings.selected_season_id ?? selectedSeasonId);
      setForm(mapSettingsToPrizeForm(savedSettings));
      setMessage(`Premios actualizados para ${savedSettings.selected_season_name ?? "la temporada"}.`);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo guardar premios");
    } finally {
      setSaving(false);
    }
  }

  const selectedSeason = useMemo(
    () => seasons.find((season) => season.id === selectedSeasonId) ?? null,
    [seasons, selectedSeasonId],
  );
  const tournamentTypeLabel = selectedSeason?.competition_name ?? selectedSeason?.structure_format ?? "Sin competencia";

  const formatMoney = (value: number) =>
    new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 2 }).format(value);
  const netIncomeAmount =
    (settings?.income_after_commission_amount ?? 0) - (settings?.reserve_amount ?? 0);

  return (
    <div className="space-y-6">
      <section>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 className="text-xl font-semibold text-ink">Premios del torneo</h2>
          <button
            type="submit"
            form="season-prizes-form"
            disabled={saving || loading || !selectedSeasonId}
            className="secondary-button disabled:opacity-60"
          >
            {saving ? "Guardando..." : "Guardar premios"}
          </button>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2 lg:grid-cols-[minmax(0,320px)_minmax(0,260px)_auto] lg:items-end">
          <label className="space-y-2 text-left text-sm">
            <span className="text-steel">Temporada</span>
            <select
              value={selectedSeasonId}
              onChange={(event) => {
                const nextSeasonId = event.target.value;
                setSelectedSeasonId(nextSeasonId);
                setLoading(true);
                setError(null);
                setMessage(null);
                const nextSeason = seasons.find((season) => season.id === nextSeasonId);
                const nextScope = prizeScope === "survivor" && !nextSeason?.survivor_enabled ? "season" : prizeScope;
                setPrizeScope(nextScope);
                void loadPrizeSettings(nextSeasonId, nextScope).finally(() => setLoading(false));
              }}
              className="field-control"
              disabled={loading || seasons.length === 0}
            >
              {seasons.map((season) => (
                <option key={season.id} value={season.id}>
                  {season.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-2 text-left text-sm">
            <span className="text-steel">Modalidad</span>
            <select
              value={prizeScope}
              onChange={(event) => {
                const nextScope = event.target.value as "season" | "survivor";
                setPrizeScope(nextScope);
                setLoading(true);
                setError(null);
                setMessage(null);
                void loadPrizeSettings(selectedSeasonId, nextScope).finally(() => setLoading(false));
              }}
              className="field-control"
              disabled={loading || !selectedSeasonId}
            >
              <option value="season">Quiniela</option>
              {selectedSeason?.survivor_enabled ? <option value="survivor">Survivor</option> : null}
            </select>
          </label>
          <div className="pb-1">
            <p className="text-[10px] uppercase tracking-[0.16em] text-steel">Competencia</p>
            <p className="mt-2 text-sm font-semibold text-ink">{tournamentTypeLabel}</p>
          </div>
        </div>
        <p className="mt-3 text-sm text-steel">
          {selectedSeason ? `Editando la bolsa de ${prizeScope === "survivor" ? "Survivor" : "Quiniela"} para ${selectedSeason.name}.` : "Selecciona una temporada para editar su esquema de premios."}
        </p>
        <p className="mt-1 text-xs text-steel/80">
          El costo, los premios semanales y los porcentajes se guardan para esta temporada y modalidad.
        </p>
      </section>

      <form id="season-prizes-form" onSubmit={handleSubmit} className="space-y-6">
        <section className="space-y-4">
          <h3 className="text-sm font-semibold uppercase tracking-[0.22em] text-ink">Base financiera</h3>
          <div className="space-y-2">
            <label className="grid grid-cols-[1fr_auto] items-center gap-4 border-b border-white/[0.06] py-3">
              <span className="text-sm text-steel">Costo por ingreso</span>
              <input
                type="number"
                min={0.01}
                max={1000000}
                step={0.01}
                value={form.entry_fee_amount}
                onChange={(event) =>
                  setForm((current) => ({ ...current, entry_fee_amount: event.target.value }))
                }
                className="field-control w-32 text-right"
                required
              />
            </label>

            <label className="grid grid-cols-[1fr_auto] items-center gap-4 py-2">
              <span className="text-sm text-steel">% comision administracion</span>
              <input
                type="number"
                min={0}
                max={100}
                step={0.01}
                value={form.admin_commission_pct}
                onChange={(event) => setForm((current) => ({ ...current, admin_commission_pct: event.target.value }))}
                className="field-control w-28 text-right"
                required
              />
            </label>


            <label className="grid grid-cols-[1fr_auto] items-center gap-4 py-2">
              <span className="text-sm text-steel">% reserva</span>
              <input
                type="number"
                min={0}
                max={100}
                step={0.01}
                value={form.reserve_pct}
                onChange={(event) => setForm((current) => ({ ...current, reserve_pct: event.target.value }))}
                className="field-control w-28 text-right"
                required
              />
            </label>
          </div>
        </section>

        <div className="grid gap-6 xl:grid-cols-2">
          <section className="space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-[0.22em] text-ink">Premios semanales editables</h3>
              </div>
            </div>
            <div className="space-y-2">
              <label className="grid grid-cols-[1fr_auto] items-center gap-4 py-2">
                <span className="text-sm text-steel">Premio jornada 1er lugar</span>
                <input
                  type="number"
                  min={0}
                  max={1000000}
                  step={0.01}
                  value={form.weekly_first_place_amount}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, weekly_first_place_amount: event.target.value }))
                  }
                  className="field-control w-28 text-right"
                  required
                />
              </label>

              <label className="grid grid-cols-[1fr_auto] items-center gap-4 py-2">
                <span className="text-sm text-steel">Premio jornada 2do lugar</span>
                <input
                  type="number"
                  min={0}
                  max={1000000}
                  step={0.01}
                  value={form.weekly_second_place_amount}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, weekly_second_place_amount: event.target.value }))
                  }
                  className="field-control w-28 text-right"
                  required
                />
              </label>

              <label className="grid grid-cols-[1fr_auto] items-center gap-4 py-2">
                <span className="text-sm text-steel">Premio jornada 3er lugar</span>
                <input
                  type="number"
                  min={0}
                  max={1000000}
                  step={0.01}
                  value={form.weekly_third_place_amount}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, weekly_third_place_amount: event.target.value }))
                  }
                  className="field-control w-28 text-right"
                  required
                />
              </label>
            </div>
          </section>

          <section className="space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-[0.22em] text-ink">Trofeos del torneo</h3>
              </div>
            </div>
            <div className="space-y-2">
              <label className="grid grid-cols-[1fr_auto] items-center gap-4 py-2">
                <span className="text-sm text-steel">% premio primer lugar</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.01}
                  value={form.first_place_pct}
                  onChange={(event) => setForm((current) => ({ ...current, first_place_pct: event.target.value }))}
                  className="field-control w-24 text-right"
                  required
                />
              </label>

              <label className="grid grid-cols-[1fr_auto] items-center gap-4 py-2">
                <span className="text-sm text-steel">% premio segundo lugar</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.01}
                  value={form.second_place_pct}
                  onChange={(event) => setForm((current) => ({ ...current, second_place_pct: event.target.value }))}
                  className="field-control w-24 text-right"
                  required
                />
              </label>

              <label className="grid grid-cols-[1fr_auto] items-center gap-4 py-2">
                <span className="text-sm text-steel">% premio tercer lugar</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.01}
                  value={form.third_place_pct}
                  onChange={(event) => setForm((current) => ({ ...current, third_place_pct: event.target.value }))}
                  className="field-control w-24 text-right"
                  required
                />
              </label>
            </div>
          </section>
        </div>

        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-[0.22em] text-ink">Guardar</h3>
            </div>
            <button
              type="submit"
              disabled={saving || loading || !selectedSeasonId}
              className="secondary-button disabled:opacity-60"
            >
              {saving ? "Guardando..." : "Guardar"}
            </button>
          </div>

          {message ? <p className="mt-4 text-sm text-moss">{message}</p> : null}
          {error ? <p className="mt-4 text-sm text-coral">{error}</p> : null}
        </section>
      </form>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-[0.22em] text-ink">Bolsa y reparto</h3>
        <div className="overflow-x-auto">
          <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.9fr)] gap-3 px-4 py-3 text-[11px] uppercase tracking-[0.28em] text-steel">
            <span>Concepto</span>
            <span>Valor</span>
            <span>Detalle</span>
          </div>
          <div>
            <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.9fr)] gap-3 px-4 py-3 text-sm text-ink">
              <span>Participantes confirmados</span>
              <span className="font-medium">{settings?.confirmed_participants ?? 0}</span>
              <span className="text-steel">Activos en el torneo</span>
            </div>
            <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.9fr)] gap-3 px-4 py-3 text-sm text-ink">
              <span>Costo por ingreso</span>
              <span className="font-medium">{formatMoney(settings?.entry_fee_amount ?? 0)}</span>
              <span className="text-steel">Por participante</span>
            </div>
            <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.9fr)] gap-3 px-4 py-3 text-sm text-ink">
              <span>Ingreso total</span>
              <span className="font-medium">{formatMoney(settings?.gross_pool_amount ?? 0)}</span>
              <span className="text-steel">Antes de descuentos</span>
            </div>
            <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.9fr)] gap-3 px-4 py-3 text-sm text-ink">
              <span>Comisión administración</span>
              <span className="font-medium">{formatMoney(settings?.admin_commission_amount ?? 0)}</span>
              <span className="text-steel">{Number(settings?.admin_commission_pct ?? 0).toFixed(2)}%</span>
            </div>
            <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.9fr)] gap-3 px-4 py-3 text-sm text-ink">
              <span>Reserva</span>
              <span className="font-medium">{formatMoney(settings?.reserve_amount ?? 0)}</span>
              <span className="text-steel">{Number(settings?.reserve_pct ?? 0).toFixed(2)}%</span>
            </div>
            <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.9fr)] gap-3 px-4 py-3 text-sm text-ink">
              <span>Ingreso neto</span>
              <span className="font-medium">{formatMoney(netIncomeAmount)}</span>
              <span className="text-steel">Ingreso - comisión - reserva</span>
            </div>
            <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.9fr)] gap-3 px-4 py-3 text-sm text-ink">
              <span>Premio jornada 1er lugar</span>
              <span className="font-medium">{formatMoney(settings?.weekly_first_place_amount ?? 0)}</span>
              <span className="text-steel">Semanal</span>
            </div>
            <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.9fr)] gap-3 px-4 py-3 text-sm text-ink">
              <span>Premio jornada 2do lugar</span>
              <span className="font-medium">{formatMoney(settings?.weekly_second_place_amount ?? 0)}</span>
              <span className="text-steel">Semanal</span>
            </div>
            <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.9fr)] gap-3 px-4 py-3 text-sm text-ink">
              <span>Premio jornada 3er lugar</span>
              <span className="font-medium">{formatMoney(settings?.weekly_third_place_amount ?? 0)}</span>
              <span className="text-steel">Semanal</span>
            </div>
            <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.9fr)] gap-3 px-4 py-3 text-sm text-ink">
              <span>Premios por jornada</span>
              <span className="font-medium">{formatMoney(settings?.weekly_total_prize_amount ?? 0)}</span>
              <span className="text-steel">{settings?.tournament_matchdays_count ?? 0} jornadas</span>
            </div>
            <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.9fr)] gap-3 px-4 py-3 text-sm text-ink">
              <span>Premios por jornada total</span>
              <span className="font-medium">{formatMoney(settings?.total_weekly_prizes_amount ?? 0)}</span>
              <span className="text-steel">Suma del torneo</span>
            </div>
            <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.9fr)] gap-3 px-4 py-3 text-sm text-ink">
              <span>Bolsa a repartir</span>
              <span className="font-medium">{formatMoney(settings?.distributable_prize_pool_amount ?? 0)}</span>
              <span className="text-steel">Final del torneo</span>
            </div>
            <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.9fr)] gap-3 px-4 py-3 text-sm text-ink">
              <span>1er lugar</span>
              <span className="font-medium">{formatMoney(settings?.first_place_amount ?? 0)}</span>
              <span className="text-steel">{Number(settings?.first_place_pct ?? 0).toFixed(2)}%</span>
            </div>
            <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.9fr)] gap-3 px-4 py-3 text-sm text-ink">
              <span>2do lugar</span>
              <span className="font-medium">{formatMoney(settings?.second_place_amount ?? 0)}</span>
              <span className="text-steel">{Number(settings?.second_place_pct ?? 0).toFixed(2)}%</span>
            </div>
            <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.9fr)] gap-3 px-4 py-3 text-sm text-ink">
              <span>3er lugar</span>
              <span className="font-medium">{formatMoney(settings?.third_place_amount ?? 0)}</span>
              <span className="text-steel">{Number(settings?.third_place_pct ?? 0).toFixed(2)}%</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
