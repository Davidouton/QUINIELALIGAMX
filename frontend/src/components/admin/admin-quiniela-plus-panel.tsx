"use client";

import { FormEvent, useEffect, useState } from "react";

import { backendFetch } from "@/lib/api/backend";
import { getBrowserAccessToken } from "@/lib/supabase/session";
import type {
  OddsPullResult,
  QuinielaPlusAdminConsole,
  QuinielaPlusBillingPeriod,
  QuinielaPlusLeague,
  QuinielaPlusPlan,
} from "@/types/api";

type SettingsFormState = {
  checkout_enabled: boolean;
  checkout_message: string;
};

type LeagueFormState = {
  editing_id: string | null;
  sport_name: string;
  league_name: string;
  slug: string;
  sort_order: string;
  is_active: boolean;
};

type PlanFormState = {
  editing_id: string | null;
  name: string;
  billing_period: QuinielaPlusBillingPeriod;
  includes_all_leagues: boolean;
  included_leagues_count: string;
  price_amount: string;
  currency: string;
  sort_order: string;
  is_active: boolean;
};

const periodLabels: Record<QuinielaPlusBillingPeriod, string> = {
  weekly: "Semanal",
  monthly: "Mensual",
  quarterly: "Trimestral",
  semiannual: "Semestral",
  annual: "Anual",
};

const initialSettingsForm: SettingsFormState = {
  checkout_enabled: false,
  checkout_message: "",
};

const initialLeagueForm: LeagueFormState = {
  editing_id: null,
  sport_name: "",
  league_name: "",
  slug: "",
  sort_order: "100",
  is_active: true,
};

const initialPlanForm: PlanFormState = {
  editing_id: null,
  name: "",
  billing_period: "monthly",
  includes_all_leagues: false,
  included_leagues_count: "1",
  price_amount: "",
  currency: "mxn",
  sort_order: "100",
  is_active: true,
};

function planBundleLabel(plan: QuinielaPlusPlan) {
  if (plan.includes_all_leagues) {
    return "Todas las ligas";
  }
  const count = plan.included_leagues_count ?? 0;
  return `${count} ${count === 1 ? "liga" : "ligas"}`;
}

export function AdminQuinielaPlusPanel() {
  const [consoleState, setConsoleState] = useState<QuinielaPlusAdminConsole | null>(null);
  const [settingsForm, setSettingsForm] = useState<SettingsFormState>(initialSettingsForm);
  const [leagueForm, setLeagueForm] = useState<LeagueFormState>(initialLeagueForm);
  const [planForm, setPlanForm] = useState<PlanFormState>(initialPlanForm);
  const [loading, setLoading] = useState(true);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [leagueSaving, setLeagueSaving] = useState(false);
  const [planSaving, setPlanSaving] = useState(false);
  const [oddsLoading, setOddsLoading] = useState(false);
  const [oddsResult, setOddsResult] = useState<OddsPullResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function loadConsole() {
    const accessToken = await getBrowserAccessToken();
    const response = await backendFetch<QuinielaPlusAdminConsole>("/quiniela-plus/admin/console", accessToken);
    setConsoleState(response);
    setSettingsForm({
      checkout_enabled: response.settings.checkout_enabled,
      checkout_message: response.settings.checkout_message ?? "",
    });
  }

  useEffect(() => {
    async function runLoad() {
      try {
        await loadConsole();
        setError(null);
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "No se pudo cargar Quiniela + admin");
      } finally {
        setLoading(false);
      }
    }

    void runLoad();
  }, []);

  function resetLeagueForm() {
    setLeagueForm(initialLeagueForm);
  }

  function resetPlanForm() {
    setPlanForm(initialPlanForm);
  }

  function beginEditLeague(league: QuinielaPlusLeague) {
    setLeagueForm({
      editing_id: league.id,
      sport_name: league.sport_name,
      league_name: league.league_name,
      slug: league.slug,
      sort_order: String(league.sort_order),
      is_active: league.is_active,
    });
  }

  function beginEditPlan(plan: QuinielaPlusPlan) {
    setPlanForm({
      editing_id: plan.id,
      name: plan.name,
      billing_period: plan.billing_period,
      includes_all_leagues: plan.includes_all_leagues,
      included_leagues_count: plan.included_leagues_count ? String(plan.included_leagues_count) : "1",
      price_amount: String(plan.price_amount),
      currency: plan.currency,
      sort_order: String(plan.sort_order),
      is_active: plan.is_active,
    });
  }

  async function handleSettingsSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSettingsSaving(true);
    setError(null);
    setMessage(null);
    try {
      const accessToken = await getBrowserAccessToken();
      await backendFetch("/quiniela-plus/admin/settings", accessToken, {
        method: "PUT",
        body: JSON.stringify({
          checkout_enabled: settingsForm.checkout_enabled,
          checkout_message: settingsForm.checkout_message.trim() || null,
        }),
      });
      await loadConsole();
      setMessage("Configuracion de checkout actualizada.");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo guardar el switch de checkout");
    } finally {
      setSettingsSaving(false);
    }
  }

  async function handleLeagueSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLeagueSaving(true);
    setError(null);
    setMessage(null);
    try {
      const accessToken = await getBrowserAccessToken();
      const path = leagueForm.editing_id
        ? `/quiniela-plus/admin/leagues/${leagueForm.editing_id}`
        : "/quiniela-plus/admin/leagues";
      const method = leagueForm.editing_id ? "PUT" : "POST";
      await backendFetch(path, accessToken, {
        method,
        body: JSON.stringify({
          sport_name: leagueForm.sport_name.trim(),
          league_name: leagueForm.league_name.trim(),
          slug: leagueForm.slug.trim(),
          sort_order: Number(leagueForm.sort_order),
          is_active: leagueForm.is_active,
        }),
      });
      await loadConsole();
      setMessage(leagueForm.editing_id ? "Liga actualizada." : "Liga creada.");
      resetLeagueForm();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo guardar la liga");
    } finally {
      setLeagueSaving(false);
    }
  }

  async function handlePlanSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPlanSaving(true);
    setError(null);
    setMessage(null);
    try {
      const accessToken = await getBrowserAccessToken();
      const path = planForm.editing_id
        ? `/quiniela-plus/admin/plans/${planForm.editing_id}`
        : "/quiniela-plus/admin/plans";
      const method = planForm.editing_id ? "PUT" : "POST";
      await backendFetch(path, accessToken, {
        method,
        body: JSON.stringify({
          name: planForm.name.trim(),
          billing_period: planForm.billing_period,
          includes_all_leagues: planForm.includes_all_leagues,
          included_leagues_count: planForm.includes_all_leagues ? null : Number(planForm.included_leagues_count),
          price_amount: Number(planForm.price_amount),
          currency: planForm.currency.trim().toLowerCase(),
          sort_order: Number(planForm.sort_order),
          is_active: planForm.is_active,
        }),
      });
      await loadConsole();
      setMessage(planForm.editing_id ? "Plan actualizado." : "Plan creado.");
      resetPlanForm();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo guardar el plan");
    } finally {
      setPlanSaving(false);
    }
  }

  async function handleWorldCupOddsPull() {
    setOddsLoading(true);
    setError(null);
    setMessage(null);
    setOddsResult(null);
    try {
      const accessToken = await getBrowserAccessToken();
      const result = await backendFetch<OddsPullResult>("/admin/odds/pull-world-cup", accessToken, {
        method: "POST",
      });
      setOddsResult(result);
      setMessage(
        `Odds Mundial cargados: ${result.raw_rows_processed ?? 0} raw, ${result.matched ?? 0} ligados, ${
          result.unmatched ?? 0
        } pendientes.`,
      );
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudieron cargar los odds del Mundial");
    } finally {
      setOddsLoading(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-ink/60">Cargando Quiniela + admin...</p>;
  }

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <h1 className="text-xl font-semibold text-ink">Quiniela +</h1>
        <p className="max-w-3xl text-sm text-steel">
          Configura el catalogo de ligas, los bundles por periodo y el switch global del checkout para activarlo cuando
          cierres el frente fiscal.
        </p>
      </section>

      <section className="rounded-[18px] border border-white/[0.06] bg-white/[0.03] p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-steel">Odds Mundial</p>
            <p className="mt-2 max-w-3xl text-sm text-steel">
              Carga los odds de hoy desde The Odds API y los sincroniza contra los partidos del Mundial para el sneak
              peek de Quiniela +.
            </p>
          </div>
          <button type="button" onClick={handleWorldCupOddsPull} disabled={oddsLoading} className="secondary-button disabled:opacity-60">
            {oddsLoading ? "Cargando odds..." : "Cargar odds de hoy"}
          </button>
        </div>

        {oddsResult ? (
          <div className="mt-4 grid gap-3 md:grid-cols-4">
            <div className="rounded-[14px] border border-white/[0.06] bg-white/[0.02] p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-steel">Snapshot</p>
              <p className="mt-2 text-sm font-semibold text-ink">{oddsResult.snapshot_date ?? "-"}</p>
            </div>
            <div className="rounded-[14px] border border-white/[0.06] bg-white/[0.02] p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-steel">Raw</p>
              <p className="mt-2 text-sm font-semibold text-ink">{oddsResult.raw_rows_processed ?? 0}</p>
            </div>
            <div className="rounded-[14px] border border-white/[0.06] bg-white/[0.02] p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-steel">Ligados</p>
              <p className="mt-2 text-sm font-semibold text-moss">{oddsResult.matched ?? 0}</p>
            </div>
            <div className="rounded-[14px] border border-white/[0.06] bg-white/[0.02] p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-steel">Pendientes</p>
              <p className="mt-2 text-sm font-semibold text-gold">{oddsResult.unmatched ?? 0}</p>
            </div>
          </div>
        ) : null}
      </section>

      <section className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <form onSubmit={handleSettingsSubmit} className="space-y-4 rounded-[18px] border border-white/[0.06] bg-white/[0.03] p-5">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-steel">Checkout</p>
            <p className="mt-2 text-sm text-steel">
              Puedes dejar todo el producto listo y mantener la compra apagada hasta que se resuelva el tema fiscal.
            </p>
          </div>

          <label className="flex items-center justify-between gap-3">
            <span className="text-sm text-steel">Cobro habilitado</span>
            <select
              value={settingsForm.checkout_enabled ? "si" : "no"}
              onChange={(event) =>
                setSettingsForm((current) => ({ ...current, checkout_enabled: event.target.value === "si" }))
              }
              className="field-control max-w-[180px]"
            >
              <option value="no">Deshabilitado</option>
              <option value="si">Habilitado</option>
            </select>
          </label>

          <label className="space-y-2">
            <span className="text-sm text-steel">Mensaje visible al usuario</span>
            <textarea
              value={settingsForm.checkout_message}
              onChange={(event) =>
                setSettingsForm((current) => ({ ...current, checkout_message: event.target.value }))
              }
              className="field-control min-h-[120px]"
              placeholder="Quiniela + ya esta montada, pero el checkout sigue deshabilitado mientras se cierra el tema fiscal."
            />
          </label>

          <button type="submit" disabled={settingsSaving} className="secondary-button disabled:opacity-60">
            {settingsSaving ? "Guardando..." : "Guardar switch"}
          </button>
        </form>

        <div className="rounded-[18px] border border-white/[0.06] bg-white/[0.03] p-5">
          <p className="text-sm font-semibold uppercase tracking-[0.22em] text-steel">Estado actual</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-[14px] border border-white/[0.06] bg-white/[0.02] p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-steel">Checkout</p>
              <p className={`mt-2 text-sm font-semibold ${consoleState?.settings.checkout_enabled ? "text-moss" : "text-gold"}`}>
                {consoleState?.settings.checkout_enabled ? "Habilitado" : "Deshabilitado"}
              </p>
            </div>
            <div className="rounded-[14px] border border-white/[0.06] bg-white/[0.02] p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-steel">Ligas</p>
              <p className="mt-2 text-sm font-semibold text-ink">{consoleState?.leagues.length ?? 0}</p>
            </div>
            <div className="rounded-[14px] border border-white/[0.06] bg-white/[0.02] p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-steel">Planes</p>
              <p className="mt-2 text-sm font-semibold text-ink">{consoleState?.plans.length ?? 0}</p>
            </div>
          </div>

          {consoleState?.settings.checkout_message ? (
            <div className="mt-4 rounded-[14px] border border-gold/25 bg-gold/10 p-4 text-sm text-steel">
              {consoleState.settings.checkout_message}
            </div>
          ) : null}
        </div>
      </section>

      {message ? <p className="text-sm text-moss">{message}</p> : null}
      {error ? <p className="text-sm text-coral">{error}</p> : null}

      <section className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <form onSubmit={handleLeagueSubmit} className="space-y-4 rounded-[18px] border border-white/[0.06] bg-white/[0.03] p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.22em] text-steel">Ligas disponibles</p>
              <p className="mt-2 text-sm text-steel">Aqui das de alta las ligas que el usuario puede combinar.</p>
            </div>
            {leagueForm.editing_id ? (
              <button type="button" onClick={resetLeagueForm} className="app-pill px-4 text-sm">
                Nueva liga
              </button>
            ) : null}
          </div>

          <label className="space-y-2">
            <span className="text-sm text-steel">Deporte</span>
            <input
              value={leagueForm.sport_name}
              onChange={(event) => setLeagueForm((current) => ({ ...current, sport_name: event.target.value }))}
              className="field-control"
              placeholder="Futbol / Basquetbol / Futbol Americano"
              required
            />
          </label>

          <label className="space-y-2">
            <span className="text-sm text-steel">Liga</span>
            <input
              value={leagueForm.league_name}
              onChange={(event) => setLeagueForm((current) => ({ ...current, league_name: event.target.value }))}
              className="field-control"
              placeholder="Liga MX / NFL / NBA"
              required
            />
          </label>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2">
              <span className="text-sm text-steel">Slug</span>
              <input
                value={leagueForm.slug}
                onChange={(event) => setLeagueForm((current) => ({ ...current, slug: event.target.value }))}
                className="field-control"
                placeholder="liga-mx"
                required
              />
            </label>

            <label className="space-y-2">
              <span className="text-sm text-steel">Orden</span>
              <input
                type="number"
                min={0}
                value={leagueForm.sort_order}
                onChange={(event) => setLeagueForm((current) => ({ ...current, sort_order: event.target.value }))}
                className="field-control"
                required
              />
            </label>
          </div>

          <label className="flex items-center justify-between gap-3">
            <span className="text-sm text-steel">Activa</span>
            <select
              value={leagueForm.is_active ? "si" : "no"}
              onChange={(event) =>
                setLeagueForm((current) => ({ ...current, is_active: event.target.value === "si" }))
              }
              className="field-control max-w-[180px]"
            >
              <option value="si">Activa</option>
              <option value="no">Inactiva</option>
            </select>
          </label>

          <button
            type="submit"
            disabled={leagueSaving || !leagueForm.sport_name.trim() || !leagueForm.league_name.trim() || !leagueForm.slug.trim()}
            className="secondary-button disabled:opacity-60"
          >
            {leagueSaving ? "Guardando..." : leagueForm.editing_id ? "Guardar liga" : "Crear liga"}
          </button>
        </form>

        <div className="space-y-3">
          {(consoleState?.leagues ?? []).map((league) => (
            <button
              key={league.id}
              type="button"
              onClick={() => beginEditLeague(league)}
              className="w-full rounded-[16px] border border-white/[0.06] bg-white/[0.03] px-4 py-4 text-left transition hover:border-white/[0.12]"
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-ink">{league.league_name}</p>
                  <p className="mt-1 text-xs uppercase tracking-[0.18em] text-steel">{league.sport_name}</p>
                </div>
                <span className={`text-[11px] font-semibold uppercase tracking-[0.16em] ${league.is_active ? "text-moss" : "text-steel"}`}>
                  {league.is_active ? "Activa" : "Inactiva"}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-3 text-xs text-steel">
                <span>Slug: {league.slug}</span>
                <span>Orden: {league.sort_order}</span>
              </div>
            </button>
          ))}

          {(consoleState?.leagues.length ?? 0) === 0 ? (
            <p className="text-sm text-steel">Todavia no hay ligas cargadas en Quiniela +.</p>
          ) : null}
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <form onSubmit={handlePlanSubmit} className="space-y-4 rounded-[18px] border border-white/[0.06] bg-white/[0.03] p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.22em] text-steel">Planes y bundles</p>
              <p className="mt-2 text-sm text-steel">
                Define el periodo, cuantas ligas puede elegir el usuario y el precio final del bundle.
              </p>
            </div>
            {planForm.editing_id ? (
              <button type="button" onClick={resetPlanForm} className="app-pill px-4 text-sm">
                Nuevo plan
              </button>
            ) : null}
          </div>

          <label className="space-y-2">
            <span className="text-sm text-steel">Nombre comercial</span>
            <input
              value={planForm.name}
              onChange={(event) => setPlanForm((current) => ({ ...current, name: event.target.value }))}
              className="field-control"
              placeholder="Quiniela + Mensual 3 ligas"
              required
            />
          </label>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2">
              <span className="text-sm text-steel">Periodo</span>
              <select
                value={planForm.billing_period}
                onChange={(event) =>
                  setPlanForm((current) => ({
                    ...current,
                    billing_period: event.target.value as QuinielaPlusBillingPeriod,
                  }))
                }
                className="field-control"
              >
                {Object.entries(periodLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-2">
              <span className="text-sm text-steel">Bundle</span>
              <select
                value={planForm.includes_all_leagues ? "all" : planForm.included_leagues_count}
                onChange={(event) =>
                  setPlanForm((current) => ({
                    ...current,
                    includes_all_leagues: event.target.value === "all",
                    included_leagues_count: event.target.value === "all" ? "1" : event.target.value,
                  }))
                }
                className="field-control"
              >
                <option value="1">1 liga</option>
                <option value="2">2 ligas</option>
                <option value="3">3 ligas</option>
                <option value="4">4 ligas</option>
                <option value="all">Todas las ligas</option>
              </select>
            </label>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <label className="space-y-2">
              <span className="text-sm text-steel">Precio</span>
              <input
                type="number"
                min={1}
                step="0.01"
                value={planForm.price_amount}
                onChange={(event) => setPlanForm((current) => ({ ...current, price_amount: event.target.value }))}
                className="field-control"
                required
              />
            </label>

            <label className="space-y-2">
              <span className="text-sm text-steel">Moneda</span>
              <input
                value={planForm.currency}
                onChange={(event) => setPlanForm((current) => ({ ...current, currency: event.target.value }))}
                className="field-control"
                required
              />
            </label>

            <label className="space-y-2">
              <span className="text-sm text-steel">Orden</span>
              <input
                type="number"
                min={0}
                value={planForm.sort_order}
                onChange={(event) => setPlanForm((current) => ({ ...current, sort_order: event.target.value }))}
                className="field-control"
                required
              />
            </label>
          </div>

          <label className="flex items-center justify-between gap-3">
            <span className="text-sm text-steel">Activo</span>
            <select
              value={planForm.is_active ? "si" : "no"}
              onChange={(event) =>
                setPlanForm((current) => ({ ...current, is_active: event.target.value === "si" }))
              }
              className="field-control max-w-[180px]"
            >
              <option value="si">Activo</option>
              <option value="no">Inactivo</option>
            </select>
          </label>

          <button
            type="submit"
            disabled={planSaving || !planForm.name.trim() || !planForm.price_amount}
            className="secondary-button disabled:opacity-60"
          >
            {planSaving ? "Guardando..." : planForm.editing_id ? "Guardar plan" : "Crear plan"}
          </button>
        </form>

        <div className="space-y-3">
          {(consoleState?.plans ?? []).map((plan) => (
            <button
              key={plan.id}
              type="button"
              onClick={() => beginEditPlan(plan)}
              className="w-full rounded-[16px] border border-white/[0.06] bg-white/[0.03] px-4 py-4 text-left transition hover:border-white/[0.12]"
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-ink">{plan.name}</p>
                  <p className="mt-1 text-xs uppercase tracking-[0.18em] text-steel">
                    {periodLabels[plan.billing_period]} · {planBundleLabel(plan)}
                  </p>
                </div>
                <span className={`text-[11px] font-semibold uppercase tracking-[0.16em] ${plan.is_active ? "text-moss" : "text-steel"}`}>
                  {plan.is_active ? "Activo" : "Inactivo"}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-3 text-xs text-steel">
                <span>
                  {new Intl.NumberFormat("es-MX", {
                    style: "currency",
                    currency: plan.currency.toUpperCase(),
                    maximumFractionDigits: 2,
                  }).format(plan.price_amount)}
                </span>
                <span>Orden: {plan.sort_order}</span>
              </div>
            </button>
          ))}

          {(consoleState?.plans.length ?? 0) === 0 ? (
            <p className="text-sm text-steel">Todavia no hay planes creados para Quiniela +.</p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
