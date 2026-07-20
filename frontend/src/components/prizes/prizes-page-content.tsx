"use client";

import { useEffect, useMemo, useState } from "react";

import { backendFetch, CATALOG_CACHE_TTL_MS } from "@/lib/api/backend";
import { getLiveSeasons, resolveLiveSeason, useDashboardSeasonParam } from "@/lib/dashboard-season";
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
  const [seasons, setSeasons] = useState<Season[]>([]);
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
        const seasons = await backendFetch<Season[]>("/seasons", accessToken, { cacheTtlMs: CATALOG_CACHE_TTL_MS });
        const resolvedSeason = resolveLiveSeason(seasons, seasonIdParam);
        const seasonQuery = resolvedSeason?.id ? `?season_id=${resolvedSeason.id}` : "";
        const [meResponse, summaryResponse] = await Promise.all([
          backendFetch<Me>(`/me${seasonQuery}`, accessToken),
          backendFetch<PrizeSummary>(`/me/prize-summary${seasonQuery}`, accessToken),
        ]);
        setSeasons(seasons);
        setSelectedSeason(resolvedSeason);
        setMe(meResponse);
        setSummary(summaryResponse);
        if (resolvedSeason) {
          if (resolvedSeason.id !== seasonIdParam || competitionId) {
            setSeasonId(resolvedSeason.id, "");
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
  const availableSeasons = useMemo(
    () => getLiveSeasons(seasons),
    [seasons],
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
    <div className="space-y-12">
      <header className="page-header">
        <div className="space-y-5">
          <h1 className="page-title">Premios</h1>
          {availableSeasons.length > 0 ? (
            <label className="page-context-label">
              <span>Torneo</span>
              <select
                value={selectedSeason?.id ?? ""}
                onChange={(event) => {
                  const nextSeason = availableSeasons.find((season) => season.id === event.target.value) ?? null;
                  if (!nextSeason) {
                    return;
                  }
                  setLoading(true);
                  setError(null);
                  setPaymentError(null);
                  setSeasonId(nextSeason.id, "");
                }}
                className="page-context-select"
                disabled={loading}
              >
                {availableSeasons.map((season) => (
                  <option key={season.id} value={season.id}>
                    {season.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
        {summary.season_id ? (
          <div className="mt-5 flex min-h-8 flex-wrap items-center gap-5">
            {activeSeasonMembership?.is_paid ? (
              <span className="text-sm font-semibold text-mint">Temporada pagada</span>
            ) : pricing ? (
              <button
                type="button"
                onClick={() => void handleSeasonCheckout()}
                disabled={paying}
                className={`text-sm font-semibold transition disabled:opacity-50 ${paying ? "text-[#4f7df3]" : "text-ink hover:text-[#4f7df3]"}`}
              >
                {paying ? "Abriendo checkout..." : `Pagar Liga + Liguilla · ${formatMoney(pricing.amount)}`}
              </button>
            ) : null}
          </div>
        ) : null}
        {paymentError ? <p className="mt-3 text-sm text-coral">{paymentError}</p> : null}
      </header>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-[0.22em] text-steel">Bolsa y reparto</h2>

        <div className="mt-5 overflow-x-auto border-y border-white/10">
          <div className="grid min-w-[720px] grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.9fr)] gap-6 border-b border-white/10 py-4 text-xs uppercase tracking-[0.18em] text-steel">
            <span>Concepto</span>
            <span className="text-right">Valor</span>
            <span className="text-right">Detalle</span>
          </div>
          <div className="min-w-[720px] divide-y divide-white/10">
            {rows.map(([label, value, detail]) => (
              <div
                key={label}
                className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.9fr)] items-center gap-6 py-4 text-sm text-ink"
              >
                <span>{label}</span>
                <span className="text-right font-semibold">{value}</span>
                <span className="text-right text-steel">{detail}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
