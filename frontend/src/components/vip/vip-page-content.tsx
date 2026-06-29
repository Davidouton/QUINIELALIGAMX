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
    return { label: "Aprobado", tone: "text-mint", dot: "bg-mint" };
  }
  if (status === "rejected") {
    return { label: "Fuera", tone: "text-coral", dot: "bg-coral" };
  }
  if (status === "pending") {
    return { label: "Pendiente", tone: "text-gold", dot: "bg-gold" };
  }
  return { label: "Sin acceso", tone: "text-steel", dot: "bg-steel" };
}

function registrationStatusCopy(vip: VipCompetition) {
  if (vip.join_locked) {
    return {
      label: "Jugandose",
      sublabel: "Registro cerrado",
      tone: "text-mint",
      dot: "bg-mint",
    };
  }
  return {
    label: "Registro abierto",
    sublabel: "Disponible",
    tone: "text-mint",
    dot: "bg-mint",
  };
}

function getVipModeLabel(vip: VipCompetition) {
  if (vip.competition_kind === "team_winner") {
    return `${vip.team_winner_teams.length} equipos`;
  }
  return `Jornadas ${vip.matchdays.map((matchday) => matchday.number).join(", ")}`;
}

function getVipParticipantsCount(vip: VipCompetition) {
  if (vip.competition_kind !== "team_winner") {
    return vip.approved_members_count;
  }
  const approvedCount = vip.approved_members.length || vip.approved_members_count;
  const assignedParticipantCount = new Set(
    vip.team_winner_entries
      .map((entry) => entry.profile_id)
      .filter((profileId): profileId is string => Boolean(profileId)),
  ).size;
  const houseCount = vip.team_winner_entries.filter((entry) => entry.is_house).length;
  return Math.max(approvedCount, assignedParticipantCount) + houseCount;
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
  const selectedTeamWinnerEntries = useMemo(() => {
    if (!selectedVip || selectedVip.competition_kind !== "team_winner") {
      return [];
    }
    const assignedProfileIds = new Set(
      selectedVip.team_winner_entries
        .map((entry) => entry.profile_id)
        .filter((profileId): profileId is string => Boolean(profileId)),
    );
    const pendingApprovedMembers = selectedVip.approved_members
      .filter((member) => !assignedProfileIds.has(member.profile_id))
      .map((member) => ({
        key: `approved-${member.id}`,
        displayName: member.display_name,
        revealOrder: null as number | null,
        teamLabel: "Equipo por asignar",
        assignedTeamChampion: false,
        assignedTeamEliminated: false,
      }));

    return [
      ...selectedVip.team_winner_entries.map((entry) => {
        const teamName = getTeamWinnerEntryTeamName(selectedVip, entry);
        return {
          key: entry.id,
          displayName: `${entry.display_name}${entry.is_house ? " · Casa" : ""}`,
          revealOrder: entry.reveal_order,
          teamLabel: teamName ?? (entry.reveal_order ? "Oculto" : "Equipo por asignar"),
          assignedTeamChampion: entry.assigned_team_champion,
          assignedTeamEliminated: entry.assigned_team_eliminated,
        };
      }),
      ...pendingApprovedMembers,
    ];
  }, [selectedVip]);

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

      <section className="space-y-4">
        <div className="overflow-hidden border-y border-white/[0.08]">
          <div>
            <div className="hidden grid-cols-[minmax(0,1.55fr)_minmax(0,0.72fr)_minmax(0,0.58fr)_minmax(0,0.62fr)_minmax(0,0.72fr)_minmax(0,0.82fr)] gap-3 border-b border-white/[0.08] px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-steel md:grid">
              <span>VIP</span>
              <span>Mi acceso</span>
              <span>Entrada</span>
              <span>Bolsa</span>
              <span>Participantes</span>
              <span>Estado</span>
            </div>
          {vips.map((vip) => {
            const membershipStatus = statusCopy(vip.my_membership?.status ?? null);
            const registrationStatus = registrationStatusCopy(vip);
            const participantsCount = getVipParticipantsCount(vip);
            return (
              <button
                key={vip.id}
                type="button"
                onClick={() => setSelectedVipId(vip.id)}
                className={`grid w-full gap-2 border-b border-white/[0.05] px-4 py-3 text-left transition last:border-b-0 md:min-h-[76px] md:grid-cols-[minmax(0,1.55fr)_minmax(0,0.72fr)_minmax(0,0.58fr)_minmax(0,0.62fr)_minmax(0,0.72fr)_minmax(0,0.82fr)] md:items-center md:gap-3 ${
                  selectedVip?.id === vip.id
                    ? "bg-white/[0.04]"
                    : "hover:bg-white/[0.025]"
                }`}
              >
                <div className="min-w-0">
                  <div className="flex items-start justify-between gap-3 md:block">
                    <p className="truncate text-[13px] font-semibold leading-5 text-ink">{vip.name}</p>
                    <div className="flex shrink-0 flex-wrap justify-end gap-2 md:hidden">
                      <span className={`flex items-center gap-1.5 text-[11px] font-semibold ${membershipStatus.tone}`}>
                        <span className={`h-2 w-2 rounded-full ${membershipStatus.dot}`} />
                        {membershipStatus.label}
                      </span>
                      <span className={`flex items-center gap-1.5 text-[11px] font-semibold ${registrationStatus.tone}`}>
                        <span className={`h-2 w-2 rounded-full ${registrationStatus.dot}`} />
                        {registrationStatus.label}
                      </span>
                    </div>
                  </div>
                  <p className="mt-0.5 truncate text-xs leading-5 text-steel">{vip.season_name}</p>
                  <p className="mt-1 text-[11px] leading-5 text-steel md:hidden">
                    {getVipModeLabel(vip)} · {participantsCount} participantes · {formatCurrency(vip.entry_fee_amount)}
                  </p>
                </div>
                <div className="hidden min-w-0 md:block">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-steel md:hidden">Mi acceso</p>
                  <p className={`flex min-w-0 items-center gap-2 text-[13px] font-semibold leading-5 ${membershipStatus.tone}`}>
                    <span className={`h-2 w-2 shrink-0 rounded-full ${membershipStatus.dot}`} />
                    <span className="truncate">{membershipStatus.label}</span>
                  </p>
                </div>
                <div className="hidden min-w-0 md:block">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-steel md:hidden">Entrada</p>
                  <p className="text-[13px] font-semibold leading-5 text-ink">{formatCurrency(vip.entry_fee_amount)}</p>
                </div>
                <div className="hidden min-w-0 md:block">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-steel md:hidden">Bolsa</p>
                  <p className="text-[13px] font-semibold leading-5 text-ink">{formatCurrency(vip.gross_pool_amount)}</p>
                </div>
                <div className="hidden min-w-0 md:block">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-steel md:hidden">Participantes</p>
                  <p className="text-[13px] font-semibold leading-5 text-ink">{participantsCount}</p>
                </div>
                <div className="hidden min-w-0 md:block">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-steel md:hidden">Estado</p>
                  <p className={`flex min-w-0 items-center gap-2 text-[13px] font-semibold leading-5 ${registrationStatus.tone}`}>
                    <span className={`h-2 w-2 shrink-0 rounded-full ${registrationStatus.dot}`} />
                    <span className="truncate">{registrationStatus.label}</span>
                  </p>
                  <p className="mt-0.5 truncate text-xs leading-5 text-steel">{registrationStatus.sublabel}</p>
                </div>
              </button>
            );
          })}

          {vips.length === 0 ? (
            <div className="rounded-[12px] border border-white/[0.06] bg-white/[0.02] px-4 py-5 text-sm text-steel">
              Aun no hay VIPs activas disponibles.
            </div>
          ) : null}
          </div>
        </div>

        <div className="space-y-5 border-y border-white/[0.08] py-5">
          {selectedVip ? (
            <>
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm uppercase tracking-[0.22em] text-steel">{selectedVip.season_name}</p>
                    <span className={`flex items-center gap-1.5 text-xs font-semibold ${registrationStatusCopy(selectedVip).tone}`}>
                      <span className={`h-2 w-2 rounded-full ${registrationStatusCopy(selectedVip).dot}`} />
                      {registrationStatusCopy(selectedVip).label}
                    </span>
                    <span className={`flex items-center gap-1.5 text-xs font-semibold ${statusCopy(selectedVip.my_membership?.status ?? null).tone}`}>
                      <span className={`h-2 w-2 rounded-full ${statusCopy(selectedVip.my_membership?.status ?? null).dot}`} />
                      {statusCopy(selectedVip.my_membership?.status ?? null).label}
                    </span>
                  </div>
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
                      {getVipParticipantsCount(selectedVip)}
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

              {selectedVip.my_membership?.status !== "approved" ? (
                <div className="flex flex-wrap items-center gap-3 border-y border-white/[0.06] py-3">
                  {selectedVip.join_locked && !selectedVip.my_membership ? (
                    <span className="text-sm font-semibold text-coral">Solicitud cerrada</span>
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
                    <p className="text-xs text-steel">{selectedTeamWinnerEntries.length} participantes</p>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {selectedTeamWinnerEntries.map((entry) => (
                      <div
                        key={entry.key}
                        className={`rounded-[8px] border border-white/[0.06] px-4 py-3 ${
                          entry.assignedTeamChampion
                            ? "bg-mint/10"
                            : entry.assignedTeamEliminated
                              ? "opacity-55"
                              : ""
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <p className="truncate text-sm font-semibold text-ink">{entry.displayName}</p>
                          <span className="text-xs text-steel">#{entry.revealOrder ?? "-"}</span>
                        </div>
                        <p className="mt-2 text-sm text-steel">{entry.teamLabel}</p>
                        {entry.teamLabel !== "Oculto" && entry.teamLabel !== "Equipo por asignar" ? (
                          <p className={`mt-1 text-xs ${entry.assignedTeamEliminated ? "text-coral" : "text-mint"}`}>
                            {entry.assignedTeamChampion
                              ? "Campeon"
                              : entry.assignedTeamEliminated
                                ? "Eliminado"
                                : "Vivo"}
                          </p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {selectedVip.competition_kind === "matchday" ? (
                <div className="border-y border-white/[0.06] py-3">
                  <p className="text-xs uppercase tracking-[0.18em] text-steel">Jornadas que cuentan</p>
                  <p className="mt-2 text-sm font-semibold text-ink">
                    {selectedVip.matchdays
                      .map((matchday) => `J${matchday.number} ${matchday.name}`)
                      .join(" · ")}
                  </p>
                </div>
              ) : null}

              <div className="overflow-hidden border-y border-white/[0.08]">
                <div className="grid gap-2 border-b border-white/[0.05] py-2.5 text-sm sm:grid-cols-3">
                  <p className="text-steel">Bolsa total</p>
                  <p className="font-semibold text-ink">{formatCurrency(selectedVip.gross_pool_amount)}</p>
                  <p className="text-steel">
                    {selectedVip.competition_kind === "team_winner"
                      ? getVipParticipantsCount(selectedVip)
                      : selectedVip.approved_members_count} x {formatCurrency(selectedVip.entry_fee_amount)}
                  </p>
                </div>
                <div className="grid gap-2 border-b border-white/[0.05] py-2.5 text-sm sm:grid-cols-3">
                  <p className="text-steel">Comision</p>
                  <p className="font-semibold text-ink">{formatCurrency(selectedVip.admin_commission_amount)}</p>
                  <p className="text-steel">{selectedVip.admin_commission_pct.toFixed(2)}%</p>
                </div>
                <div className="grid gap-2 border-b border-white/[0.05] py-2.5 text-sm sm:grid-cols-3">
                  <p className="text-steel">Bolsa premios</p>
                  <p className="font-semibold text-ink">{formatCurrency(selectedVip.distributable_prize_pool_amount)}</p>
                  <p className="text-steel">Disponible para repartir</p>
                </div>
                <div className="grid gap-2 border-b border-white/[0.05] py-2.5 text-sm sm:grid-cols-3">
                  <p className="text-steel">1er lugar</p>
                  <p className="font-semibold text-ink">{formatCurrency(selectedVip.first_place_amount)}</p>
                  <p className="text-steel">{selectedVip.first_place_pct.toFixed(2)}%</p>
                </div>
                <div className="grid gap-2 border-b border-white/[0.05] py-2.5 text-sm sm:grid-cols-3">
                  <p className="text-steel">2do lugar</p>
                  <p className="font-semibold text-ink">{formatCurrency(selectedVip.second_place_amount)}</p>
                  <p className="text-steel">{selectedVip.second_place_pct.toFixed(2)}%</p>
                </div>
                <div className="grid gap-2 border-b border-white/[0.05] py-2.5 text-sm sm:grid-cols-3">
                  <p className="text-steel">3er lugar</p>
                  <p className="font-semibold text-ink">{formatCurrency(selectedVip.third_place_amount)}</p>
                  <p className="text-steel">{selectedVip.third_place_pct.toFixed(2)}%</p>
                </div>
                <div className="grid gap-2 py-2.5 text-sm sm:grid-cols-3">
                  <p className="text-steel">Restante</p>
                  <p className="font-semibold text-ink">{formatCurrency(selectedVip.remaining_pool_amount)}</p>
                  <p className="text-steel">Sin asignar</p>
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
