"use client";

import { useEffect, useMemo, useState } from "react";

import { backendFetch } from "@/lib/api/backend";
import { getBrowserAccessToken } from "@/lib/supabase/session";
import type {
  CheckoutSessionResponse,
  EffectivePricing,
  VipCompetition,
  VipJoinResponse,
  VipMembershipStatus,
} from "@/types/api";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatMexicoDate(value: string | null) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: "America/Mexico_City",
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function statusCopy(status: VipMembershipStatus | null) {
  if (status === "approved") {
    return { label: "Aprobado", tone: "text-mint" };
  }
  if (status === "rejected") {
    return { label: "Rechazado", tone: "text-coral" };
  }
  if (status === "pending") {
    return { label: "Pendiente", tone: "text-gold" };
  }
  return { label: "Disponible", tone: "text-steel" };
}

function getTeamWinnerEntryTeamName(
  vip: VipCompetition,
  entry: VipCompetition["team_winner_entries"][number],
) {
  if (entry.assigned_team_name) {
    return entry.assigned_team_name;
  }
  if (!entry.revealed_at) {
    return null;
  }
  if (entry.assigned_team_id) {
    return vip.team_winner_teams.find((team) => team.team_id === entry.assigned_team_id)?.team_name ?? null;
  }

  const revealedTeamIds = new Set(
    vip.team_winner_entries
      .filter((row) => row.id !== entry.id && row.revealed_at && row.assigned_team_id)
      .map((row) => row.assigned_team_id as string),
  );
  const revealedTeamNames = new Set(
    vip.team_winner_entries
      .filter((row) => row.id !== entry.id && row.revealed_at && row.assigned_team_name)
      .map((row) => row.assigned_team_name as string),
  );
  const remainingTeams = vip.team_winner_teams.filter(
    (team) => !revealedTeamIds.has(team.team_id) && !revealedTeamNames.has(team.team_name),
  );
  const missingRevealedEntries = vip.team_winner_entries
    .filter((row) => row.revealed_at && !row.assigned_team_id && !row.assigned_team_name)
    .sort((left, right) => (left.reveal_order ?? 0) - (right.reveal_order ?? 0));
  const missingIndex = missingRevealedEntries.findIndex((row) => row.id === entry.id);
  return remainingTeams[missingIndex]?.team_name ?? null;
}

function getVipJoinLockCopy(vip: VipCompetition) {
  if (!vip.join_lock_at || !vip.join_lock_match_label) {
    return null;
  }
  const formattedDate = formatMexicoDate(vip.join_lock_at);
  if (!formattedDate) {
    return null;
  }
  return `${vip.join_locked ? "Cerrada" : "Cierra"} con ${vip.join_lock_match_label} · ${formattedDate}`;
}

export function VipPageContent() {
  const [vips, setVips] = useState<VipCompetition[]>([]);
  const [pricingByVipId, setPricingByVipId] = useState<Record<string, EffectivePricing>>({});
  const [selectedVipId, setSelectedVipId] = useState("");
  const [loading, setLoading] = useState(true);
  const [requestingVipId, setRequestingVipId] = useState<string | null>(null);
  const [payingVipId, setPayingVipId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const selectedVip = useMemo(
    () => vips.find((vip) => vip.id === selectedVipId) ?? vips[0] ?? null,
    [selectedVipId, vips],
  );
  const selectedVipPricing = selectedVip ? pricingByVipId[selectedVip.id] ?? null : null;

  async function loadVips() {
    const accessToken = await getBrowserAccessToken();
    const rows = await backendFetch<VipCompetition[]>("/vip", accessToken);
    const pricingEntries = await Promise.all(
      rows.map(async (vip) => {
        try {
          const pricing = await backendFetch<EffectivePricing>(
            `/payments/pricing?scope_type=vip&scope_id=${vip.id}`,
            accessToken,
          );
          return [vip.id, pricing] as const;
        } catch {
          return null;
        }
      }),
    );
    setVips(rows);
    setPricingByVipId(
      Object.fromEntries(pricingEntries.filter((entry): entry is readonly [string, EffectivePricing] => entry !== null)),
    );
    setSelectedVipId((current) => (rows.some((vip) => vip.id === current) ? current : (rows[0]?.id ?? "")));
  }

  useEffect(() => {
    async function runLoad() {
      try {
        await loadVips();
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "No se pudo cargar VIP");
      } finally {
        setLoading(false);
      }
    }

    void runLoad();
  }, []);

  async function handleRequest(vipId: string) {
    setRequestingVipId(vipId);
    setError(null);
    setMessage(null);
    try {
      const accessToken = await getBrowserAccessToken();
      await backendFetch<VipJoinResponse>(`/vip/${vipId}/request`, accessToken, {
        method: "POST",
      });
      await loadVips();
      setMessage("Tu solicitud VIP ya quedo enviada para revision del admin.");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo enviar la solicitud VIP");
    } finally {
      setRequestingVipId(null);
    }
  }

  async function handleVipCheckout(vipId: string) {
    setPayingVipId(vipId);
    setError(null);
    setMessage(null);
    try {
      const accessToken = await getBrowserAccessToken();
      const response = await backendFetch<CheckoutSessionResponse>("/payments/checkout-session", accessToken, {
        method: "POST",
        body: JSON.stringify({
          scope_type: "vip",
          scope_id: vipId,
        }),
      });
      window.location.href = response.checkout_url;
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo iniciar el checkout VIP");
      setPayingVipId(null);
    }
  }

  if (loading) {
    return <p className="text-sm text-ink/60">Cargando espacios VIP...</p>;
  }

  if (error && vips.length === 0) {
    return <p className="text-sm text-coral">{error}</p>;
  }

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <p className="text-[11px] uppercase tracking-[0.28em] text-steel">VIP</p>
        <h1 className="text-2xl font-semibold text-ink">VIP</h1>
        <p className="max-w-3xl text-sm text-steel">
          Consulta tus VIPs por jornadas y sorteos especiales como Equipo ganador.
        </p>
      </section>

      {message ? <p className="text-sm text-mint">{message}</p> : null}
      {error ? <p className="text-sm text-coral">{error}</p> : null}

      <section className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className="space-y-3">
          {vips.map((vip) => {
            const status = statusCopy(vip.my_membership?.status ?? null);
            const pricing = pricingByVipId[vip.id] ?? null;
            const lockCopy = getVipJoinLockCopy(vip);
            const hasMembership = Boolean(vip.my_membership);
            const isTeamWinner = vip.competition_kind === "team_winner";
            const disabled = vip.my_membership?.status === "approved" || (!hasMembership && vip.join_locked);
            return (
              <div
                key={vip.id}
                className={`w-full rounded-[12px] border px-4 py-4 text-left transition ${
                  selectedVip?.id === vip.id
                    ? "border-white/[0.14] bg-white/[0.05]"
                    : "border-white/[0.06] bg-white/[0.02] hover:border-white/[0.1]"
                }`}
              >
                <button type="button" onClick={() => setSelectedVipId(vip.id)} className="block w-full text-left">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-base font-semibold text-ink">{vip.name}</p>
                      <p className="mt-1 text-sm text-steel">{vip.season_name}</p>
                    </div>
                    <span className={`text-xs font-semibold uppercase tracking-[0.18em] ${status.tone}`}>
                      {status.label}
                    </span>
                  </div>

                <div className="mt-4 grid grid-cols-2 gap-3 text-xs text-steel">
                  <div>
                    <p className="uppercase tracking-[0.18em]">Entrada</p>
                    <p className="mt-1 text-sm font-semibold text-ink">{formatCurrency(vip.entry_fee_amount)}</p>
                  </div>
                    <div>
                      <p className="uppercase tracking-[0.18em]">{isTeamWinner ? "Equipos" : "Jornadas"}</p>
                      <p className="mt-1 text-sm font-semibold text-ink">
                        {isTeamWinner ? vip.team_winner_teams.length : vip.matchdays.length}
                      </p>
                    </div>
                    <div>
                      <p className="uppercase tracking-[0.18em]">Aprobados</p>
                      <p className="mt-1 text-sm font-semibold text-ink">
                        {vip.approved_members_count}
                      </p>
                    </div>
                  <div>
                    <p className="uppercase tracking-[0.18em]">Pendientes</p>
                    <p className="mt-1 text-sm font-semibold text-ink">{vip.pending_requests_count}</p>
                  </div>
                  <div>
                    <p className="uppercase tracking-[0.18em]">Bolsa</p>
                    <p className="mt-1 text-sm font-semibold text-ink">{formatCurrency(vip.gross_pool_amount)}</p>
                  </div>
                  <div>
                    <p className="uppercase tracking-[0.18em]">1er lugar</p>
                    <p className="mt-1 text-sm font-semibold text-ink">{formatCurrency(vip.first_place_amount)}</p>
                  </div>
                </div>
                </button>

                <div className="mt-4 flex items-center justify-between gap-3">
                  <p className="text-xs text-steel">
                    {isTeamWinner
                      ? "Sorteo Equipo ganador"
                      : `Jornadas ${vip.matchdays.map((matchday) => matchday.number).join(", ")}`}
                  </p>
                  {lockCopy ? (
                    <p className={`text-xs ${vip.join_locked ? "text-coral" : "text-steel"}`}>
                      {lockCopy}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    disabled={disabled || requestingVipId === vip.id || payingVipId === vip.id}
                    className={`app-pill px-3 text-xs ${disabled ? "opacity-70" : ""}`}
                    onClick={() =>
                      pricing ? void handleVipCheckout(vip.id) : void handleRequest(vip.id)
                    }
                  >
                    {payingVipId === vip.id
                      ? "Abriendo checkout"
                      : requestingVipId === vip.id
                        ? "Enviando"
                        : vip.my_membership?.status === "approved"
                          ? "Dentro"
                          : !hasMembership && vip.join_locked
                            ? "Cerrada"
                          : pricing
                            ? `Pagar acceso · ${formatCurrency(pricing.amount)}`
                            : vip.my_membership?.status === "pending"
                              ? "En revision"
                              : "Solicitar"}
                  </button>
                </div>
              </div>
            );
          })}

          {vips.length === 0 ? (
            <div className="rounded-[12px] border border-white/[0.06] bg-white/[0.02] px-4 py-5 text-sm text-steel">
              Aun no hay VIPs activas disponibles.
            </div>
          ) : null}
        </div>

        <div className="space-y-4 rounded-[12px] border border-white/[0.06] bg-white/[0.02] p-5">
          {selectedVip ? (
            <>
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="text-sm uppercase tracking-[0.22em] text-steel">{selectedVip.season_name}</p>
                  <h2 className="mt-2 text-xl font-semibold text-ink">{selectedVip.name}</h2>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.22em] text-steel">Entrada</p>
                    <p className="mt-1 text-sm font-semibold text-ink">
                      {formatCurrency(selectedVip.entry_fee_amount)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.22em] text-steel">Participantes</p>
                    <p className="mt-1 text-sm font-semibold text-ink">
                      {selectedVip.competition_kind === "team_winner"
                        ? selectedVip.team_winner_entries.length
                        : selectedVip.approved_members_count}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.22em] text-steel">Mi estado</p>
                    <p className={`mt-1 text-sm font-semibold ${statusCopy(selectedVip.my_membership?.status ?? null).tone}`}>
                      {statusCopy(selectedVip.my_membership?.status ?? null).label}
                    </p>
                  </div>
                </div>
              </div>

              {selectedVip.competition_kind !== "team_winner" && selectedVip.my_membership?.status !== "approved" ? (
                <div className="flex flex-wrap items-center gap-3 rounded-[12px] border border-white/[0.06] bg-white/[0.02] px-4 py-3">
                  {selectedVip.join_locked && !selectedVip.my_membership ? (
                    <span className="app-pill px-4 text-sm text-coral">Solicitud cerrada</span>
                  ) : selectedVipPricing ? (
                    <button
                      type="button"
                      onClick={() => void handleVipCheckout(selectedVip.id)}
                      disabled={payingVipId === selectedVip.id}
                      className="secondary-button disabled:opacity-60"
                    >
                      {payingVipId === selectedVip.id
                        ? "Abriendo checkout..."
                        : `Pagar acceso VIP · ${formatCurrency(selectedVipPricing.amount)}`}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void handleRequest(selectedVip.id)}
                      disabled={requestingVipId === selectedVip.id}
                      className="app-pill px-4 text-sm disabled:opacity-60"
                    >
                      {requestingVipId === selectedVip.id ? "Enviando..." : "Solicitar acceso"}
                    </button>
                  )}
                  <p className="text-sm text-steel">
                    {getVipJoinLockCopy(selectedVip)
                      ? getVipJoinLockCopy(selectedVip)
                      : selectedVipPricing
                      ? "El precio vigente se cobra en Stripe y tu acceso se activa cuando el backend confirme el pago."
                      : "Todavia no hay una regla de precio activa para esta VIP, asi que solo queda la solicitud manual."}
                  </p>
                </div>
              ) : null}

              {selectedVip.competition_kind === "team_winner" ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-4">
                    <p className="text-sm font-semibold uppercase tracking-[0.22em] text-steel">Asignaciones</p>
                    <p className="text-xs text-steel">{selectedVip.team_winner_entries.length} participantes</p>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {selectedVip.team_winner_entries.map((entry) => {
                      const teamName = getTeamWinnerEntryTeamName(selectedVip, entry);
                      return (
                        <div
                          key={entry.id}
                          className={`rounded-[8px] border border-white/[0.06] px-4 py-3 ${
                            entry.assigned_team_champion
                              ? "bg-mint/10"
                              : entry.assigned_team_eliminated
                                ? "opacity-55"
                                : ""
                          }`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <p className="truncate text-sm font-semibold text-ink">
                              {entry.display_name}{entry.is_house ? " · Casa" : ""}
                            </p>
                            <span className="text-xs text-steel">#{entry.reveal_order ?? "-"}</span>
                          </div>
                          <p className="mt-2 text-sm text-steel">
                            {teamName ?? (entry.reveal_order ? "Oculto" : "Sin sortear")}
                          </p>
                          {teamName ? (
                            <p className={`mt-1 text-xs ${entry.assigned_team_eliminated ? "text-coral" : "text-mint"}`}>
                              {entry.assigned_team_champion
                                ? "Campeon"
                                : entry.assigned_team_eliminated
                                  ? "Eliminado"
                                  : "Vivo"}
                            </p>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {selectedVip.competition_kind === "matchday" ? (
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-steel">Jornadas que cuentan</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {selectedVip.matchdays.map((matchday) => (
                    <span key={matchday.id} className="app-pill-ghost px-3 text-xs text-ink">
                      J{matchday.number} {matchday.name}
                    </span>
                  ))}
                </div>
              </div>
              ) : null}

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-[12px] border border-white/[0.06] px-4 py-3">
                  <p className="text-[10px] uppercase tracking-[0.22em] text-steel">Bolsa total</p>
                  <p className="mt-2 text-sm font-semibold text-ink">{formatCurrency(selectedVip.gross_pool_amount)}</p>
                  <p className="mt-1 text-xs text-steel">
                    {selectedVip.competition_kind === "team_winner"
                      ? selectedVip.team_winner_entries.length
                      : selectedVip.approved_members_count} x {formatCurrency(selectedVip.entry_fee_amount)}
                  </p>
                </div>
                <div className="rounded-[12px] border border-white/[0.06] px-4 py-3">
                  <p className="text-[10px] uppercase tracking-[0.22em] text-steel">Comision</p>
                  <p className="mt-2 text-sm font-semibold text-ink">{formatCurrency(selectedVip.admin_commission_amount)}</p>
                  <p className="mt-1 text-xs text-steel">{selectedVip.admin_commission_pct.toFixed(2)}%</p>
                </div>
                <div className="rounded-[12px] border border-white/[0.06] px-4 py-3">
                  <p className="text-[10px] uppercase tracking-[0.22em] text-steel">Bolsa premios</p>
                  <p className="mt-2 text-sm font-semibold text-ink">
                    {formatCurrency(selectedVip.distributable_prize_pool_amount)}
                  </p>
                </div>
                <div className="rounded-[12px] border border-white/[0.06] px-4 py-3">
                  <p className="text-[10px] uppercase tracking-[0.22em] text-steel">Restante</p>
                  <p className="mt-2 text-sm font-semibold text-ink">{formatCurrency(selectedVip.remaining_pool_amount)}</p>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-[12px] border border-white/[0.06] px-4 py-3">
                  <p className="text-[10px] uppercase tracking-[0.22em] text-steel">1er lugar</p>
                  <p className="mt-2 text-sm font-semibold text-ink">{formatCurrency(selectedVip.first_place_amount)}</p>
                  <p className="mt-1 text-xs text-steel">{selectedVip.first_place_pct.toFixed(2)}%</p>
                </div>
                <div className="rounded-[12px] border border-white/[0.06] px-4 py-3">
                  <p className="text-[10px] uppercase tracking-[0.22em] text-steel">2do lugar</p>
                  <p className="mt-2 text-sm font-semibold text-ink">{formatCurrency(selectedVip.second_place_amount)}</p>
                  <p className="mt-1 text-xs text-steel">{selectedVip.second_place_pct.toFixed(2)}%</p>
                </div>
                <div className="rounded-[12px] border border-white/[0.06] px-4 py-3">
                  <p className="text-[10px] uppercase tracking-[0.22em] text-steel">3er lugar</p>
                  <p className="mt-2 text-sm font-semibold text-ink">{formatCurrency(selectedVip.third_place_amount)}</p>
                  <p className="mt-1 text-xs text-steel">{selectedVip.third_place_pct.toFixed(2)}%</p>
                </div>
              </div>

              {selectedVip.my_membership?.admin_note ? (
                <div className="rounded-[12px] border border-white/[0.06] bg-night/40 px-4 py-3 text-sm text-steel">
                  <p className="font-semibold text-ink">Nota del admin</p>
                  <p className="mt-1">{selectedVip.my_membership.admin_note}</p>
                  {formatMexicoDate(selectedVip.my_membership.decided_at) ? (
                    <p className="mt-2 text-xs text-steel">
                      {selectedVip.my_membership.decided_by_display_name ?? "Admin"} •{" "}
                      {formatMexicoDate(selectedVip.my_membership.decided_at)}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {selectedVip.competition_kind === "matchday" ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-4">
                  <p className="text-sm font-semibold uppercase tracking-[0.22em] text-steel">Leaderboard VIP</p>
                  <p className="text-xs text-steel">{selectedVip.leaderboard.length} jugadores</p>
                </div>
                <div className="overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  <table className="min-w-[640px] w-full table-fixed text-left text-[11px] text-ink sm:text-sm">
                    <colgroup>
                      <col className="w-[72px]" />
                      <col className="w-[42%]" />
                      <col className="w-[120px]" />
                      <col className="w-[120px]" />
                      <col className="w-[120px]" />
                    </colgroup>
                    <thead className="app-table-head">
                      <tr>
                        <th className="px-3 py-3">Pos</th>
                        <th className="px-3 py-3">Jugador</th>
                        <th className="px-3 py-3 text-center">Puntos</th>
                        <th className="px-3 py-3 text-center">Aciertos</th>
                        <th className="px-3 py-3 text-center">Exactos</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedVip.leaderboard.map((entry) => (
                        <tr key={entry.profile_id} className="app-table-row border-b last:border-b-0">
                          <td className="px-3 py-3 font-semibold text-ink">{entry.rank_position}</td>
                          <td className="px-3 py-3 font-medium">{entry.display_name}</td>
                          <td className="px-3 py-3 text-center">{entry.total_points}</td>
                          <td className="px-3 py-3 text-center">{entry.correct_results}</td>
                          <td className="px-3 py-3 text-center">{entry.exact_scores}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {selectedVip.leaderboard.length === 0 ? (
                  <p className="text-sm text-steel">Aun no hay participantes aprobados o puntos acumulados.</p>
                ) : null}
              </div>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-steel">Selecciona una VIP para ver detalle y leaderboard.</p>
          )}
        </div>
      </section>
    </div>
  );
}
