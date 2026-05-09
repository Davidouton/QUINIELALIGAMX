"use client";

import { FormEvent, useEffect, useState } from "react";

import { backendFetch } from "@/lib/api/backend";
import { formatMexicoCityDateTime } from "@/lib/datetime/mexico-city";
import { getBrowserAccessToken } from "@/lib/supabase/session";
import type {
  AdminSettings,
  AdminVipCompetition,
  Matchday,
  PaymentScopeType,
  PricingRule,
  Season,
} from "@/types/api";

type PricingScopeType = Exclude<PaymentScopeType, "quiniela_plus">;

type SettingsFormState = {
  active_season_id: string;
  start_matchday_id: string;
  end_matchday_id: string;
  result_correct_points: string;
  exact_score_points: string;
  advancing_team_points: string;
};

type PricingFormState = {
  editing_id: string | null;
  scope_type: PricingScopeType;
  scope_id: string;
  label: string;
  amount: string;
  currency: string;
  starts_at: string;
  ends_at: string;
  start_matchday_number: string;
  end_matchday_number: string;
  is_active: boolean;
};

const initialForm: SettingsFormState = {
  active_season_id: "",
  start_matchday_id: "",
  end_matchday_id: "",
  result_correct_points: "3",
  exact_score_points: "2",
  advancing_team_points: "1",
};

const initialPricingForm: PricingFormState = {
  editing_id: null,
  scope_type: "season",
  scope_id: "",
  label: "",
  amount: "",
  currency: "mxn",
  starts_at: "",
  ends_at: "",
  start_matchday_number: "",
  end_matchday_number: "",
  is_active: true,
};

function toDatetimeLocalInputValue(value: string | null) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export function AdminSettingsPanel() {
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [matchdays, setMatchdays] = useState<Matchday[]>([]);
  const [adminVips, setAdminVips] = useState<AdminVipCompetition[]>([]);
  const [pricingRules, setPricingRules] = useState<PricingRule[]>([]);
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [form, setForm] = useState<SettingsFormState>(initialForm);
  const [pricingForm, setPricingForm] = useState<PricingFormState>(initialPricingForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pricingSaving, setPricingSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pricingError, setPricingError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pricingMessage, setPricingMessage] = useState<string | null>(null);

  async function loadSettings() {
    const accessToken = await getBrowserAccessToken();
    const [seasonRows, matchdayRows, settingsResponse, vipRows, pricingRuleRows] = await Promise.all([
      backendFetch<Season[]>("/seasons", accessToken),
      backendFetch<Matchday[]>("/matchdays", accessToken),
      backendFetch<AdminSettings>("/admin/settings", accessToken),
      backendFetch<AdminVipCompetition[]>("/admin/vip", accessToken),
      backendFetch<PricingRule[]>("/payments/pricing-rules", accessToken),
    ]);

    const fallbackSeasonId = settingsResponse.active_season_id ?? seasonRows[0]?.id ?? "";
    setSeasons(seasonRows);
    setMatchdays(matchdayRows);
    setAdminVips(vipRows);
    setPricingRules(pricingRuleRows);
    setSettings(settingsResponse);
    setForm({
      active_season_id: fallbackSeasonId,
      start_matchday_id: settingsResponse.start_matchday_id ?? "",
      end_matchday_id: settingsResponse.end_matchday_id ?? "",
      result_correct_points: String(settingsResponse.result_correct_points),
      exact_score_points: String(settingsResponse.exact_score_points),
      advancing_team_points: String(settingsResponse.advancing_team_points),
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
          advancing_team_points: Number(form.advancing_team_points),
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

function resetPricingForm(nextScopeType: PricingScopeType = "season") {
    setPricingForm({
      ...initialPricingForm,
      scope_type: nextScopeType,
    });
    setPricingError(null);
    setPricingMessage(null);
  }

  function beginEditPricingRule(rule: PricingRule) {
    if (rule.scope_type === "quiniela_plus") {
      return;
    }
    setPricingForm({
      editing_id: rule.id,
      scope_type: rule.scope_type,
      scope_id: rule.scope_id,
      label: rule.label,
      amount: String(rule.amount),
      currency: rule.currency,
      starts_at: toDatetimeLocalInputValue(rule.starts_at),
      ends_at: toDatetimeLocalInputValue(rule.ends_at),
      start_matchday_number: rule.start_matchday_number ? String(rule.start_matchday_number) : "",
      end_matchday_number: rule.end_matchday_number ? String(rule.end_matchday_number) : "",
      is_active: rule.is_active,
    });
    setPricingError(null);
    setPricingMessage(null);
  }

  async function handlePricingSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPricingSaving(true);
    setPricingError(null);
    setPricingMessage(null);

    try {
      const accessToken = await getBrowserAccessToken();
      const path = pricingForm.editing_id
        ? `/payments/pricing-rules/${pricingForm.editing_id}`
        : "/payments/pricing-rules";
      const method = pricingForm.editing_id ? "PUT" : "POST";
      await backendFetch<PricingRule>(path, accessToken, {
        method,
        body: JSON.stringify({
          scope_type: pricingForm.scope_type,
          scope_id: pricingForm.scope_id,
          label: pricingForm.label.trim(),
          amount: Number(pricingForm.amount),
          currency: pricingForm.currency.trim().toLowerCase(),
          starts_at: pricingForm.starts_at || null,
          ends_at: pricingForm.ends_at || null,
          start_matchday_number: pricingForm.start_matchday_number
            ? Number(pricingForm.start_matchday_number)
            : null,
          end_matchday_number: pricingForm.end_matchday_number
            ? Number(pricingForm.end_matchday_number)
            : null,
          is_active: pricingForm.is_active,
        }),
      });
      await loadSettings();
      setPricingMessage(pricingForm.editing_id ? "Regla de precio actualizada." : "Regla de precio creada.");
      resetPricingForm(pricingForm.scope_type);
    } catch (caughtError) {
      setPricingError(
        caughtError instanceof Error ? caughtError.message : "No se pudo guardar la regla de precio",
      );
    } finally {
      setPricingSaving(false);
    }
  }

  const activeSeason = seasons.find((season) => season.id === form.active_season_id) ?? null;
  const seasonMatchdays = matchdays
    .filter((matchday) => matchday.season_id === form.active_season_id)
    .sort((left, right) => left.number - right.number);
  const pricingTargetOptions =
    pricingForm.scope_type === "season"
      ? seasons.map((season) => ({ id: season.id, label: season.name }))
      : adminVips.map((vip) => ({ id: vip.id, label: `${vip.name} · ${vip.season_name}` }));
  const pricingRulesForSelectedScope = pricingRules.filter((rule) => rule.scope_type === pricingForm.scope_type);

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

          <label className="flex items-center justify-between gap-3 py-2">
            <span className="text-sm text-steel">Punto extra por clasificado</span>
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              value={form.advancing_team_points}
              onChange={(event) =>
                setForm((current) => ({ ...current, advancing_team_points: event.target.value }))
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
          <div className="grid grid-cols-[1.15fr_1fr] gap-4 px-3 py-2">
            <p className="text-sm text-steel">Clasificado en knockout</p>
            <p className="text-right text-sm font-medium text-ink">{form.advancing_team_points} pts</p>
          </div>
        </div>
      </section>

      <section className="space-y-5">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-[0.22em] text-ink">Reglas de precio</h3>
          <p className="mt-2 text-sm text-steel">
            Aqui decides cuanto cuesta una temporada o una VIP y en que ventana aplica ese precio.
          </p>
        </div>

        <form onSubmit={handlePricingSubmit} className="grid gap-4 md:grid-cols-2">
          <label className="space-y-2">
            <span className="text-sm text-steel">Tipo</span>
            <select
              value={pricingForm.scope_type}
              onChange={(event) => {
                const nextScopeType = event.target.value as PricingScopeType;
                setPricingForm((current) => ({
                  ...current,
                  scope_type: nextScopeType,
                  scope_id: "",
                }));
              }}
              className="field-control"
            >
              <option value="season">Temporada</option>
              <option value="vip">VIP</option>
            </select>
          </label>

          <label className="space-y-2">
            <span className="text-sm text-steel">Objetivo</span>
            <select
              value={pricingForm.scope_id}
              onChange={(event) => setPricingForm((current) => ({ ...current, scope_id: event.target.value }))}
              className="field-control"
              required
            >
              <option value="">Selecciona</option>
              {pricingTargetOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-2 md:col-span-2">
            <span className="text-sm text-steel">Etiqueta</span>
            <input
              value={pricingForm.label}
              onChange={(event) => setPricingForm((current) => ({ ...current, label: event.target.value }))}
              className="field-control"
              placeholder="VIP Early Bird / Liga + Liguilla General"
              required
            />
          </label>

          <label className="space-y-2">
            <span className="text-sm text-steel">Monto</span>
            <input
              type="number"
              min={1}
              step="0.01"
              value={pricingForm.amount}
              onChange={(event) => setPricingForm((current) => ({ ...current, amount: event.target.value }))}
              className="field-control"
              placeholder="1500"
              required
            />
          </label>

          <label className="space-y-2">
            <span className="text-sm text-steel">Moneda</span>
            <input
              value={pricingForm.currency}
              onChange={(event) => setPricingForm((current) => ({ ...current, currency: event.target.value }))}
              className="field-control"
              placeholder="mxn"
              required
            />
          </label>

          <label className="space-y-2">
            <span className="text-sm text-steel">Desde fecha</span>
            <input
              type="datetime-local"
              value={pricingForm.starts_at}
              onChange={(event) => setPricingForm((current) => ({ ...current, starts_at: event.target.value }))}
              className="field-control"
            />
          </label>

          <label className="space-y-2">
            <span className="text-sm text-steel">Hasta fecha</span>
            <input
              type="datetime-local"
              value={pricingForm.ends_at}
              onChange={(event) => setPricingForm((current) => ({ ...current, ends_at: event.target.value }))}
              className="field-control"
            />
          </label>

          <label className="space-y-2">
            <span className="text-sm text-steel">Desde jornada</span>
            <input
              type="number"
              min={1}
              value={pricingForm.start_matchday_number}
              onChange={(event) =>
                setPricingForm((current) => ({ ...current, start_matchday_number: event.target.value }))
              }
              className="field-control"
              placeholder="Opcional"
            />
          </label>

          <label className="space-y-2">
            <span className="text-sm text-steel">Hasta jornada</span>
            <input
              type="number"
              min={1}
              value={pricingForm.end_matchday_number}
              onChange={(event) =>
                setPricingForm((current) => ({ ...current, end_matchday_number: event.target.value }))
              }
              className="field-control"
              placeholder="Opcional"
            />
          </label>

          <label className="flex items-center justify-between gap-3 md:col-span-2">
            <span className="text-sm text-steel">Regla activa</span>
            <select
              value={pricingForm.is_active ? "si" : "no"}
              onChange={(event) =>
                setPricingForm((current) => ({ ...current, is_active: event.target.value === "si" }))
              }
              className="field-control max-w-[180px]"
            >
              <option value="si">Activa</option>
              <option value="no">Inactiva</option>
            </select>
          </label>

          <div className="flex flex-wrap gap-3 md:col-span-2">
            <button
              type="submit"
              disabled={pricingSaving || !pricingForm.scope_id || !pricingForm.label.trim() || !pricingForm.amount}
              className="secondary-button disabled:opacity-60"
            >
              {pricingSaving
                ? "Guardando..."
                : pricingForm.editing_id
                  ? "Guardar regla"
                  : "Crear regla"}
            </button>
            {pricingForm.editing_id ? (
              <button
                type="button"
                onClick={() => resetPricingForm(pricingForm.scope_type)}
                className="app-pill px-4 text-sm"
              >
                Nueva regla
              </button>
            ) : null}
          </div>
        </form>

        {pricingMessage ? <p className="text-sm text-moss">{pricingMessage}</p> : null}
        {pricingError ? <p className="text-sm text-coral">{pricingError}</p> : null}

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-steel">
              Reglas {pricingForm.scope_type === "season" ? "de temporada" : "de VIP"}
            </p>
            <p className="text-xs text-steel">{pricingRulesForSelectedScope.length} registradas</p>
          </div>

          <div className="space-y-2">
            {pricingRulesForSelectedScope.map((rule) => (
              <button
                key={rule.id}
                type="button"
                onClick={() => beginEditPricingRule(rule)}
                className="w-full rounded-[14px] border border-white/[0.06] bg-white/[0.02] px-4 py-4 text-left transition hover:border-white/[0.12]"
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-ink">{rule.label}</p>
                    <p className="mt-1 text-xs text-steel">
                      {rule.scope_type === "season" ? "Temporada" : "VIP"} · {rule.currency.toUpperCase()}
                    </p>
                  </div>
                  <div className="text-left lg:text-right">
                    <p className="text-base font-semibold text-ink">
                      {new Intl.NumberFormat("es-MX", {
                        style: "currency",
                        currency: rule.currency.toUpperCase(),
                        maximumFractionDigits: 2,
                      }).format(rule.amount)}
                    </p>
                    <p className={`mt-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${rule.is_active ? "text-moss" : "text-steel"}`}>
                      {rule.is_active ? "Activa" : "Inactiva"}
                    </p>
                  </div>
                </div>

                <div className="mt-3 grid gap-2 text-xs text-steel md:grid-cols-2">
                  <p>
                    Fecha: {rule.starts_at ? formatMexicoCityDateTime(rule.starts_at) : "sin inicio"} ·{" "}
                    {rule.ends_at ? formatMexicoCityDateTime(rule.ends_at) : "sin fin"}
                  </p>
                  <p className="md:text-right">
                    Jornadas: {rule.start_matchday_number ?? "-"} a {rule.end_matchday_number ?? "-"}
                  </p>
                </div>
              </button>
            ))}

            {pricingRulesForSelectedScope.length === 0 ? (
              <p className="text-sm text-steel">Todavia no hay reglas para este tipo.</p>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}
