"use client";

import { useEffect, useMemo, useState } from "react";

import { backendFetch } from "@/lib/api/backend";
import { resolveSeasonForContext, useDashboardSeasonParam } from "@/lib/dashboard-season";
import { getBrowserAccessToken } from "@/lib/supabase/session";
import type { CheckoutSessionResponse, EffectivePricing, Me, PrizeSummary, Season } from "@/types/api";

const initialState: PrizeSummary = {
  season_id: null,
  season_name: null,
  confirmed_participants: 0,
  entry_fee_amount: 0,
  gross_pool_amount: 0,
  admin_commission_pct: 0,
  admin_commission_amount: 0,
  reserve_pct: 0,
  reserve_amount: 0,
  income_after_commission_amount: 0,
  net_income_amount: 0,
  weekly_first_place_amount: 0,
  weekly_second_place_amount: 0,
  weekly_third_place_amount: 0,
  weekly_total_prize_amount: 0,
  tournament_matchdays_count: 0,
  total_weekly_prizes_amount: 0,
  distributable_prize_pool_amount: 0,
  first_place_pct: 0,
  first_place_amount: 0,
  second_place_pct: 0,
  second_place_amount: 0,
  third_place_pct: 0,
  third_place_amount: 0,
};

export function PrizesPageContent() {
  const { seasonId: seasonIdParam, competitionId, setSeasonId } = useDashboardSeasonParam();
  const [me, setMe] = useState<Me | null>(null);
  const [summary, setSummary] = useState<PrizeSummary>(initialState);
  const [pricing, setPricing] = useState<EffectivePricing | null>(null);
  const [selectedSeason, setSelectedSeason] = useState<Season | null>(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paymentError, setPaymentError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const accessToken = await getBrowserAccessToken();
        const seasons = await backendFetch<Season[]>("/seasons", accessToken);
        const resolvedSeason = resolveSeasonForContext(seasons, seasonIdParam, competitionId);
        const seasonQuery = resolvedSeason?.id ? `?season_id=${resolvedSeason.id}` : "";
        const [meResponse, summaryResponse] = await Promise.all([
          backendFetch<Me>(`/me${seasonQuery}`, accessToken),
          backendFetch<PrizeSummary>(`/me/prize-summary${seasonQuery}`, accessToken),
        ]);
        setSelectedSeason(resolvedSeason);
        setMe(meResponse);
        setSummary(summaryResponse);
        if (resolvedSeason) {
          const nextCompetitionId = resolvedSeason.competition_id ?? competitionId;
          if (resolvedSeason.id !== seasonIdParam || nextCompetitionId !== competitionId) {
            setSeasonId(resolvedSeason.id, nextCompetitionId);
          }
        }
        if (summaryResponse.season_id) {
          try {
            const pricingResponse = await backendFetch<EffectivePricing>(
              `/payments/pricing?scope_type=season&scope_id=${summaryResponse.season_id}`,
              accessToken,
            );
            setPricing(pricingResponse);
          } catch {
            setPricing(null);
          }
        } else {
          setPricing(null);
        }
        setError(null);
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "No se pudo cargar premios");
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, [competitionId, seasonIdParam, setSeasonId]);

  async function handleSeasonCheckout() {
    if (!summary.season_id) {
      return;
    }
    setPaying(true);
    setPaymentError(null);
    try {
      const accessToken = await getBrowserAccessToken();
      const response = await backendFetch<CheckoutSessionResponse>("/payments/checkout-session", accessToken, {
        method: "POST",
        body: JSON.stringify({
          scope_type: "season",
          scope_id: summary.season_id,
        }),
      });
      window.location.href = response.checkout_url;
    } catch (caughtError) {
      setPaymentError(
        caughtError instanceof Error ? caughtError.message : "No se pudo iniciar el checkout de temporada",
      );
      setPaying(false);
    }
  }

  const formatMoney = (value: number) =>
    new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 2 }).format(value);

  const rows = useMemo(
    () => [
      ["Participantes confirmados", String(summary.confirmed_participants), "Activos en el torneo"],
      ["Costo por ingreso", formatMoney(summary.entry_fee_amount), "Por participante"],
      ["Ingreso total", formatMoney(summary.gross_pool_amount), "Antes de descuentos"],
      [
        "Comision administracion",
        formatMoney(summary.admin_commission_amount),
        `${Number(summary.admin_commission_pct).toFixed(2)}%`,
      ],
      ["Reserva", formatMoney(summary.reserve_amount), `${Number(summary.reserve_pct).toFixed(2)}%`],
      ["Ingreso neto", formatMoney(summary.net_income_amount), "Ingreso - comision - reserva"],
      ["Premio jornada 1er lugar", formatMoney(summary.weekly_first_place_amount), "Semanal"],
      ["Premio jornada 2do lugar", formatMoney(summary.weekly_second_place_amount), "Semanal"],
      ["Premio jornada 3er lugar", formatMoney(summary.weekly_third_place_amount), "Semanal"],
      [
        "Premios por jornada",
        formatMoney(summary.weekly_total_prize_amount),
        `${summary.tournament_matchdays_count} jornadas`,
      ],
      ["Premios por jornada total", formatMoney(summary.total_weekly_prizes_amount), "Suma del torneo"],
      ["Bolsa a repartir", formatMoney(summary.distributable_prize_pool_amount), "Final del torneo"],
      ["1er lugar", formatMoney(summary.first_place_amount), `${Number(summary.first_place_pct).toFixed(2)}%`],
      ["2do lugar", formatMoney(summary.second_place_amount), `${Number(summary.second_place_pct).toFixed(2)}%`],
      ["3er lugar", formatMoney(summary.third_place_amount), `${Number(summary.third_place_pct).toFixed(2)}%`],
    ],
    [summary],
  );
  const activeSeasonMembership =
    summary.season_id && me
      ? me.season_memberships.find((membership) => membership.season_id === summary.season_id) ?? null
      : null;

  if (loading) {
    return <p className="text-sm text-ink/60">Cargando premios...</p>;
  }

  if (error) {
    return <p className="text-sm text-coral">{error}</p>;
  }

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-xl font-semibold text-ink">Premios</h1>
        <p className="mt-1 text-sm text-steel">{summary.season_name ?? selectedSeason?.name ?? "Sin torneo activo"}</p>
        {summary.season_id ? (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {activeSeasonMembership?.is_paid ? (
              <span className="app-pill-active px-4 text-sm text-ink">Temporada pagada</span>
            ) : pricing ? (
              <button
                type="button"
                onClick={() => void handleSeasonCheckout()}
                disabled={paying}
                className="secondary-button disabled:opacity-60"
              >
                {paying ? "Abriendo checkout..." : `Pagar Liga + Liguilla · ${formatMoney(pricing.amount)}`}
              </button>
            ) : (
              <span className="app-pill px-4 text-sm">Precio no disponible</span>
            )}
            <p className="text-sm text-steel">
              {activeSeasonMembership?.is_paid
                ? "Tu pago de temporada ya esta confirmado."
                : "El pago se abre en Stripe con el monto vigente que definiste en admin."}
            </p>
          </div>
        ) : null}
        {paymentError ? <p className="mt-3 text-sm text-coral">{paymentError}</p> : null}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm font-semibold uppercase tracking-[0.22em] text-steel">Bolsa y reparto</p>
          <p className="text-xs text-steel">{summary.confirmed_participants} participantes</p>
        </div>

        <div className="overflow-x-auto">
          <div className="app-table-head grid min-w-[720px] grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.9fr)] gap-3 px-3 py-3">
            <span>Concepto</span>
            <span>Valor</span>
            <span>Detalle</span>
          </div>
          <div className="min-w-[720px]">
            {rows.map(([label, value, detail]) => (
              <div
                key={label}
                className="app-table-row grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.9fr)] gap-3 px-3 py-3 text-sm text-ink"
              >
                <span>{label}</span>
                <span className="font-medium">{value}</span>
                <span className="text-steel">{detail}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
