"use client";

import { useEffect, useMemo, useState } from "react";

import { backendFetch } from "@/lib/api/backend";
import { formatMexicoCityDateTime } from "@/lib/datetime/mexico-city";
import { getBrowserAccessToken } from "@/lib/supabase/session";
import type {
  CheckoutSessionResponse,
  QuinielaPlusBillingPeriod,
  QuinielaPlusCatalog,
  QuinielaPlusLeague,
  QuinielaPlusPlan,
} from "@/types/api";

const periodOrder: QuinielaPlusBillingPeriod[] = ["weekly", "monthly", "quarterly", "semiannual", "annual"];

const periodLabels: Record<QuinielaPlusBillingPeriod, string> = {
  weekly: "Semanal",
  monthly: "Mensual",
  quarterly: "Trimestral",
  semiannual: "Semestral",
  annual: "Anual",
};

function formatCurrency(value: number, currency: string) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: currency.toUpperCase(),
    maximumFractionDigits: 2,
  }).format(value);
}

function planBundleLabel(plan: QuinielaPlusPlan) {
  if (plan.includes_all_leagues) {
    return "Todas las ligas";
  }
  const count = plan.included_leagues_count ?? 0;
  return `${count} ${count === 1 ? "liga" : "ligas"}`;
}

export function QuinielaPlusPageContent() {
  const [catalog, setCatalog] = useState<QuinielaPlusCatalog | null>(null);
  const [activePeriod, setActivePeriod] = useState<QuinielaPlusBillingPeriod>("monthly");
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [selectedLeagueIds, setSelectedLeagueIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paymentError, setPaymentError] = useState<string | null>(null);

  useEffect(() => {
    async function loadCatalog() {
      try {
        const accessToken = await getBrowserAccessToken();
        const response = await backendFetch<QuinielaPlusCatalog>("/quiniela-plus/catalog", accessToken);
        setCatalog(response);
        const firstPeriod = periodOrder.find((period) => response.plans.some((plan) => plan.billing_period === period));
        if (firstPeriod) {
          setActivePeriod(firstPeriod);
        }
        setError(null);
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "No se pudo cargar Quiniela +");
      } finally {
        setLoading(false);
      }
    }

    void loadCatalog();
  }, []);

  const plansForPeriod = useMemo(
    () =>
      (catalog?.plans ?? [])
        .filter((plan) => plan.billing_period === activePeriod)
        .sort((left, right) => left.sort_order - right.sort_order || left.price_amount - right.price_amount),
    [activePeriod, catalog?.plans],
  );

  const selectedPlan = useMemo(
    () => plansForPeriod.find((plan) => plan.id === selectedPlanId) ?? plansForPeriod[0] ?? null,
    [plansForPeriod, selectedPlanId],
  );

  useEffect(() => {
    if (!selectedPlan) {
      setSelectedPlanId("");
      return;
    }
    setSelectedPlanId(selectedPlan.id);
    if (selectedPlan.includes_all_leagues) {
      setSelectedLeagueIds([]);
      return;
    }
    setSelectedLeagueIds((current) => {
      const allowed = new Set((catalog?.leagues ?? []).map((league) => league.id));
      return current.filter((leagueId) => allowed.has(leagueId)).slice(0, selectedPlan.included_leagues_count ?? 0);
    });
  }, [catalog?.leagues, selectedPlan]);

  function toggleLeague(league: QuinielaPlusLeague) {
    if (!selectedPlan || selectedPlan.includes_all_leagues) {
      return;
    }
    const maxSelections = selectedPlan.included_leagues_count ?? 0;
    setSelectedLeagueIds((current) => {
      if (current.includes(league.id)) {
        return current.filter((leagueId) => leagueId !== league.id);
      }
      if (current.length >= maxSelections) {
        return [...current.slice(1), league.id];
      }
      return [...current, league.id];
    });
  }

  async function handleCheckout() {
    if (!selectedPlan) {
      return;
    }
    setPaying(true);
    setPaymentError(null);
    try {
      const accessToken = await getBrowserAccessToken();
      const response = await backendFetch<CheckoutSessionResponse>("/payments/checkout-session", accessToken, {
        method: "POST",
        body: JSON.stringify({
          scope_type: "quiniela_plus",
          scope_id: selectedPlan.id,
          selected_league_ids: selectedPlan.includes_all_leagues ? [] : selectedLeagueIds,
        }),
      });
      window.location.href = response.checkout_url;
    } catch (caughtError) {
      setPaymentError(caughtError instanceof Error ? caughtError.message : "No se pudo iniciar el checkout");
      setPaying(false);
    }
  }

  const hasActiveMembership = (catalog?.active_memberships.length ?? 0) > 0;
  const selectedCount = selectedLeagueIds.length;
  const requiredCount = selectedPlan?.included_leagues_count ?? 0;
  const needsLeagueSelection = Boolean(selectedPlan && !selectedPlan.includes_all_leagues);
  const canCheckout =
    Boolean(selectedPlan) &&
    !hasActiveMembership &&
    Boolean(catalog?.checkout_enabled) &&
    (!needsLeagueSelection || selectedCount === requiredCount);

  if (loading) {
    return <p className="text-sm text-ink/60">Cargando Quiniela +...</p>;
  }

  if (error || !catalog) {
    return <p className="text-sm text-coral">{error ?? "No se pudo cargar Quiniela +"}</p>;
  }

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <p className="text-[11px] uppercase tracking-[0.28em] text-steel">Quiniela +</p>
        <h1 className="text-2xl font-semibold text-ink">Quiniela +</h1>
        <p className="max-w-3xl text-sm text-steel">
          Elige un periodo, arma tu bundle de ligas y deja todo listo para activar cobro cuando cierres el tema fiscal.
        </p>
      </section>

      {catalog.active_memberships.length > 0 ? (
        <section className="space-y-4 rounded-[18px] border border-moss/30 bg-moss/10 p-5">
          <div>
            <p className="text-[11px] uppercase tracking-[0.24em] text-moss">Tu acceso actual</p>
            <h2 className="mt-2 text-lg font-semibold text-ink">Ya tienes una membresia activa</h2>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            {catalog.active_memberships.map((membership) => (
              <div key={membership.id} className="rounded-[14px] border border-white/[0.06] bg-white/[0.04] p-4">
                <p className="text-sm font-semibold text-ink">{membership.plan.name}</p>
                <p className="mt-1 text-xs uppercase tracking-[0.18em] text-steel">
                  {periodLabels[membership.plan.billing_period]} · {planBundleLabel(membership.plan)}
                </p>
                <p className="mt-3 text-sm text-steel">
                  Vigencia: {formatMexicoCityDateTime(membership.starts_at)} a {formatMexicoCityDateTime(membership.ends_at)}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {membership.leagues.map((league) => (
                    <span key={league.id} className="app-pill px-3 text-xs">
                      {league.league_name}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {periodOrder.map((period) => {
            const disabled = !catalog.plans.some((plan) => plan.billing_period === period);
            return (
              <button
                key={period}
                type="button"
                disabled={disabled}
                onClick={() => setActivePeriod(period)}
                className={`app-pill px-4 text-sm ${activePeriod === period ? "app-pill-active text-ink" : ""} ${disabled ? "opacity-40" : ""}`}
              >
                {periodLabels[period]}
              </button>
            );
          })}
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              {plansForPeriod.map((plan) => {
                const selected = selectedPlan?.id === plan.id;
                return (
                  <button
                    key={plan.id}
                    type="button"
                    onClick={() => setSelectedPlanId(plan.id)}
                    className={`rounded-[18px] border px-5 py-5 text-left transition ${selected ? "border-gold/50 bg-gold/10" : "border-white/[0.06] bg-white/[0.03] hover:border-white/[0.12]"}`}
                  >
                    <p className="text-sm font-semibold text-ink">{plan.name}</p>
                    <p className="mt-2 text-xs uppercase tracking-[0.2em] text-steel">
                      {periodLabels[plan.billing_period]} · {planBundleLabel(plan)}
                    </p>
                    <p className="mt-4 text-2xl font-semibold text-ink">
                      {formatCurrency(plan.price_amount, plan.currency)}
                    </p>
                    <p className="mt-2 text-sm text-steel">
                      {plan.includes_all_leagues
                        ? "Incluye acceso a todo el catalogo de ligas disponible."
                        : `Te deja elegir ${plan.included_leagues_count} ${plan.included_leagues_count === 1 ? "liga" : "ligas"}.`}
                    </p>
                  </button>
                );
              })}
            </div>

            {plansForPeriod.length === 0 ? (
              <p className="text-sm text-steel">Todavia no hay planes cargados para este periodo.</p>
            ) : null}
          </div>

          <div className="rounded-[18px] border border-white/[0.06] bg-white/[0.03] p-5">
            <p className="text-[11px] uppercase tracking-[0.24em] text-steel">Bundle</p>
            <h2 className="mt-2 text-lg font-semibold text-ink">
              {selectedPlan ? selectedPlan.name : "Selecciona un plan"}
            </h2>

            {selectedPlan ? (
              <>
                <p className="mt-3 text-sm text-steel">
                  {selectedPlan.includes_all_leagues
                    ? "Este plan habilita todas las ligas activas; no necesitas hacer seleccion manual."
                    : `Elige exactamente ${requiredCount} ${requiredCount === 1 ? "liga" : "ligas"} para este bundle.`}
                </p>

                {selectedPlan.includes_all_leagues ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {catalog.leagues.map((league) => (
                      <span key={league.id} className="app-pill-active px-3 text-xs text-ink">
                        {league.league_name}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="mt-4 grid gap-2">
                    {catalog.leagues.map((league) => {
                      const selected = selectedLeagueIds.includes(league.id);
                      return (
                        <button
                          key={league.id}
                          type="button"
                          onClick={() => toggleLeague(league)}
                          className={`flex items-center justify-between rounded-[12px] border px-4 py-3 text-left ${selected ? "border-mint/40 bg-mint/10" : "border-white/[0.06] bg-white/[0.02]"}`}
                        >
                          <div>
                            <p className="text-sm font-medium text-ink">{league.league_name}</p>
                            <p className="text-xs uppercase tracking-[0.16em] text-steel">{league.sport_name}</p>
                          </div>
                          <span className={`text-xs font-semibold uppercase tracking-[0.18em] ${selected ? "text-mint" : "text-steel"}`}>
                            {selected ? "Dentro" : "Elegir"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {!catalog.checkout_enabled ? (
                  <div className="mt-5 rounded-[14px] border border-gold/25 bg-gold/10 p-4 text-sm text-steel">
                    {catalog.checkout_message ?? "El checkout de Quiniela + sigue deshabilitado por ahora."}
                  </div>
                ) : null}

                <div className="mt-5 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => void handleCheckout()}
                    disabled={!canCheckout || paying}
                    className="secondary-button disabled:opacity-60"
                  >
                    {paying
                      ? "Abriendo checkout..."
                      : catalog.checkout_enabled
                        ? `Pagar ${formatCurrency(selectedPlan.price_amount, selectedPlan.currency)}`
                        : "Checkout deshabilitado"}
                  </button>
                  <p className="text-sm text-steel">
                    {hasActiveMembership
                      ? "Ya tienes una membresia activa, asi que no se abre un segundo checkout."
                      : needsLeagueSelection
                        ? `${selectedCount}/${requiredCount} ligas seleccionadas`
                        : "Plan listo para checkout"}
                  </p>
                </div>

                {paymentError ? <p className="mt-3 text-sm text-coral">{paymentError}</p> : null}
              </>
            ) : (
              <p className="mt-3 text-sm text-steel">Selecciona un plan para elegir ligas y preparar el pago.</p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
