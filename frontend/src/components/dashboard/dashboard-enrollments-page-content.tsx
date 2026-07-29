"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";

import { backendFetch, MATCHDAY_CACHE_TTL_MS } from "@/lib/api/backend";
import { VIP_SUMMARY_PATH } from "@/lib/api/vip";
import { useDevMode } from "@/components/layout/dev-mode-provider";
import { isSeasonLive, resolveSeasonForContext, useDashboardSeasonParam } from "@/lib/dashboard-season";
import { getBrowserAccessToken } from "@/lib/supabase/session";
import { VipStatusIcon } from "@/components/vip/vip-page-content";
import type { AppBootstrap, CheckoutSessionResponse, EffectivePricing, Me, MembershipHistoryEntry, RegisteredUserOption, Season, SurvivorBoard, VipCompetition } from "@/types/api";

type EnrollmentState = {
  me: Me | null;
  seasons: Season[];
  selectedSeason: Season | null;
  survivorBoards: Record<string, SurvivorBoard>;
  vipCompetitions: VipCompetition[];
  membershipHistory: MembershipHistoryEntry[];
  avalDisplayName: string | null;
};

const initialState: EnrollmentState = {
  me: null,
  seasons: [],
  selectedSeason: null,
  survivorBoards: {},
  vipCompetitions: [],
  membershipHistory: [],
  avalDisplayName: null,
};

type MembershipRow = {
  id: string;
  name: string;
  availability: "Abierto" | "Cerrado";
  enrollmentStatus: string;
  detail: string;
  statusNotice?: string | null;
  meta: string | null;
  action: ReactNode;
};

function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function isClosedAt(value: string | null) {
  if (!value) {
    return false;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return false;
  }
  return date.getTime() <= Date.now();
}

function formatMexicoDateTime(value: string | null) {
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
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function vipStatusCopy(vip: VipCompetition) {
  if (vip.my_membership?.status === "approved") {
    return {
      label: "Activo",
      tone: "text-mint",
      description: "Ya estas puntuando dentro de esta VIP.",
    };
  }
  if (vip.my_membership?.status === "pending") {
    return {
      label: "Pendiente",
      tone: "text-gold",
      description: "Tu solicitud ya fue enviada y esta en revision.",
    };
  }
  if (vip.my_membership?.status === "rejected") {
    return {
      label: "Rechazado",
      tone: "text-coral",
      description: "Esta VIP no quedo activa para tu cuenta.",
    };
  }
  if (vip.join_locked) {
    return {
      label: "Cerrado",
      tone: "text-steel",
      description: "La ventana de alta ya se cerro para esta VIP.",
    };
  }
  return {
    label: "Disponible",
    tone: "text-ink",
    description: "Puedes abrir la VIP y completar tu alta desde ahi.",
  };
}

function getSeasonDisplayName(season: Season) {
  if (season.structure_format === "leagues_cup") {
    return season.competition_name ?? "Leagues Cup";
  }
  if (season.tournament_format === "world_cup") {
    return season.competition_name ?? "Mundial";
  }
  return season.competition_name ?? "Liga MX";
}

export function DashboardEnrollmentsPageContent() {
  const [state, setState] = useState<EnrollmentState>(initialState);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [expandedMembershipId, setExpandedMembershipId] = useState<string | null>(null);
  const [survivorPricing, setSurvivorPricing] = useState<Record<string, EffectivePricing>>({});
  const [seasonPricing, setSeasonPricing] = useState<Record<string, EffectivePricing>>({});
  const { enabled: devModeEnabled } = useDevMode();
  const { seasonId, competitionId, buildHrefWithSeason, setSeasonId } = useDashboardSeasonParam();

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        setError(null);
        const accessToken = await getBrowserAccessToken().catch(() => undefined);
        const bootstrap = await backendFetch<AppBootstrap>("/bootstrap", accessToken, {
          cacheTtlMs: MATCHDAY_CACHE_TTL_MS,
        });
        const selectedSeason = resolveSeasonForContext(bootstrap.seasons, seasonId, competitionId);
        const vipRows = accessToken
          ? await backendFetch<VipCompetition[]>(VIP_SUMMARY_PATH, accessToken, {
              cacheTtlMs: MATCHDAY_CACHE_TTL_MS,
            }).catch(() => [])
          : [];
        const membershipHistory = accessToken
          ? await backendFetch<MembershipHistoryEntry[]>("/me/membership-history", accessToken, {
              cacheTtlMs: MATCHDAY_CACHE_TTL_MS,
            }).catch(() => [])
          : [];
        const registeredUsers =
          accessToken && bootstrap.me.aval_profile_id
            ? await backendFetch<RegisteredUserOption[]>("/me/registered-users", accessToken, {
                cacheTtlMs: MATCHDAY_CACHE_TTL_MS,
              }).catch(() => [])
            : [];
        const survivorBoards: Record<string, SurvivorBoard> = {};
        const seasonPricingRows: Record<string, EffectivePricing> = {};
        const survivorPricingRows: Record<string, EffectivePricing> = {};
        if (accessToken) {
          const liveSeasons = bootstrap.seasons.filter(isSeasonLive);
          const boardResults = await Promise.all(
            liveSeasons.map(async (season) => {
              const [seasonPrice, board, survivorPrice] = await Promise.all([
                backendFetch<EffectivePricing>(`/payments/pricing?scope_type=season&scope_id=${season.id}`, accessToken).catch(() => null),
                season.survivor_enabled
                  ? backendFetch<SurvivorBoard>(`/survivor/board?season_id=${season.id}`, accessToken).catch(() => null)
                  : Promise.resolve(null),
                season.survivor_enabled
                  ? backendFetch<EffectivePricing>(`/payments/pricing?scope_type=survivor&scope_id=${season.id}`, accessToken).catch(() => null)
                  : Promise.resolve(null),
              ]);
              return [season.id, seasonPrice, board, survivorPrice] as const;
            }),
          );
          boardResults.forEach(([targetSeasonId, seasonPrice, board, survivorPrice]) => {
            if (seasonPrice) seasonPricingRows[targetSeasonId] = seasonPrice;
            if (board) {
              survivorBoards[targetSeasonId] = board;
            }
            if (survivorPrice) {
              survivorPricingRows[targetSeasonId] = survivorPrice;
            }
          });
        }
        setSeasonPricing(seasonPricingRows);
        setSurvivorPricing(survivorPricingRows);

        if (selectedSeason) {
          const nextCompetitionId = selectedSeason.competition_id ?? "";
          if (selectedSeason.id !== seasonId || competitionId !== nextCompetitionId) {
            setSeasonId(selectedSeason.id, nextCompetitionId);
          }
        }

        setState({
          me: bootstrap.me,
          seasons: bootstrap.seasons,
          selectedSeason,
          survivorBoards,
          vipCompetitions: vipRows,
          membershipHistory,
          avalDisplayName:
            bootstrap.me.aval_profile_id
              ? registeredUsers.find((user) => user.id === bootstrap.me.aval_profile_id)?.display_name ?? null
              : null,
        });
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "No se pudo cargar inscripciones");
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, [competitionId, seasonId, setSeasonId]);

  const isAvalMode = state.me?.modality === "aval" && Boolean(state.me.aval_profile_id);
  const visibleSeasonRows = useMemo(
    () =>
      state.seasons
        .filter((season) => isSeasonLive(season))
        .sort((left, right) => {
          if (left.tournament_format !== right.tournament_format) {
            return left.tournament_format === "standard" ? -1 : 1;
          }
          if (left.is_active !== right.is_active) {
            return left.is_active ? -1 : 1;
          }
          return left.name.localeCompare(right.name, "es-MX");
        }),
    [state.me?.season_memberships, state.seasons],
  );
  const visibleVipCompetitions = useMemo(
    () =>
      [...state.vipCompetitions]
        .filter((vip) => vip.season_visibility_status !== "archived")
        .filter((vip) => Boolean(vip.my_membership) || !vip.join_locked)
        .sort((left, right) => {
          const leftRank = left.my_membership ? 0 : left.join_locked ? 2 : 1;
          const rightRank = right.my_membership ? 0 : right.join_locked ? 2 : 1;
          if (leftRank !== rightRank) {
            return leftRank - rightRank;
          }
          return left.name.localeCompare(right.name, "es-MX");
        }),
    [state.vipCompetitions],
  );
  const membershipRows = useMemo(() => {
    const rows: MembershipRow[] = [];

    visibleSeasonRows.forEach((season) => {
      const membership = state.me?.season_memberships.find((item) => item.season_id === season.id) ?? null;
      const hasActiveMembership = Boolean(membership?.is_active);
      const isRejected = Boolean(membership?.is_rejected);
      const isPendingApproval = Boolean(membership && !membership.is_active && !isAvalMode && !isRejected);
      const windowClosed = isClosedAt(season.participants_lock_at);
      const registrationClosedByAdmin = season.registration_closed;
      const seasonClosed = registrationClosedByAdmin || windowClosed;
      const seasonTitle = getSeasonDisplayName(season);
      const registrationCloseLabel = formatMexicoDateTime(season.participants_lock_at);
      const seasonPrice = seasonPricing[season.id];
      const seasonCost = seasonPrice
        ? new Intl.NumberFormat("es-MX", { style: "currency", currency: seasonPrice.currency.toUpperCase() }).format(seasonPrice.amount)
        : "Sin costo configurado";
      const modalityLabel = isAvalMode ? "Aval" : "Pre-pago con aprobación admin";
      rows.push({
        id: `season-${season.id}`,
        name: seasonTitle,
        availability: seasonClosed ? "Cerrado" : "Abierto",
        enrollmentStatus: hasActiveMembership
          ? "Activo"
          : isRejected
            ? "No aprobado"
          : isPendingApproval
            ? "Pendiente"
            : "No inscrito",
        detail: season.description || "Participa en esta Quiniela y consulta aquí las condiciones de inscripción.",
        statusNotice: hasActiveMembership
          ? "Tu membresía ya está activa."
          : isRejected
            ? "La solicitud anterior no fue aprobada. Puedes enviarla nuevamente mientras el registro siga abierto."
            : registrationClosedByAdmin
              ? "El registro de esta competencia se encuentra cerrado."
              : isPendingApproval
                ? "Tu solicitud fue recibida y espera aprobación del administrador."
                : isAvalMode
                  ? "Con modalidad aval tu alta entra en automático en cuanto la activas."
                  : "Con pre-pago tu alta queda pendiente de autorización administrativa.",
        meta: `${season.name} · Modalidad: ${modalityLabel} · Costo: ${seasonCost}${registrationCloseLabel ? ` · Límite: ${registrationCloseLabel}` : ""}${
          registrationClosedByAdmin && devModeEnabled ? " · Cierre manual" : ""
        }`,
        action: hasActiveMembership ? (
          <Link href={buildHrefWithSeason("/dashboard", season.id, season.competition_id ?? "")} className="text-sm font-semibold text-ink transition hover:text-[#4f7df3]">
            Ir al dashboard
          </Link>
        ) : isPendingApproval ? (
          <span className="text-sm font-semibold text-gold">En revisión</span>
        ) : seasonClosed ? null : (
          <button
            type="button"
            onClick={() => void handleJoinSeason(season)}
            disabled={actionLoading === `season:${season.id}` || seasonClosed}
            className="text-sm font-semibold text-ink transition hover:text-[#4f7df3] disabled:opacity-50"
          >
            {actionLoading === `season:${season.id}`
              ? "Procesando..."
              : isAvalMode
                ? `Inscribirme a ${seasonTitle}`
                : isRejected
                  ? "Solicitar nuevamente"
                  : `Solicitar alta ${seasonTitle}`}
          </button>
        ),
      });
      if (!season.survivor_enabled) {
        return;
      }

      const survivorBoard = state.survivorBoards[season.id] ?? null;
      const survivorMembership = survivorBoard?.my_membership ?? null;
      const survivorClosedByAdmin = season.survivor_registration_closed;
      const survivorLockAt = survivorBoard?.season.registration_lock_at ?? season.survivor_registration_lock_at;
      const survivorWindowClosed = survivorBoard
        ? !survivorBoard.season.registration_open
        : survivorClosedByAdmin || isClosedAt(survivorLockAt);
      const survivorCloseLabel = formatMexicoDateTime(survivorLockAt);
      const survivorPrice = survivorPricing[season.id] ?? null;
      const survivorPriceLabel = survivorPrice
        ? new Intl.NumberFormat("es-MX", {
            style: "currency",
            currency: survivorPrice.currency.toUpperCase(),
            maximumFractionDigits: 2,
          }).format(survivorPrice.amount)
        : null;
      rows.push({
        id: `survivor-${season.id}`,
        name: season.survivor_name?.trim() || `Survivor ${getSeasonDisplayName(season)}`,
        availability: survivorWindowClosed ? "Cerrado" : "Abierto",
        enrollmentStatus: survivorMembership?.is_active
          ? "Activo"
          : survivorMembership?.is_rejected
            ? "No aprobado"
            : survivorMembership
              ? "Pendiente"
              : "No inscrito",
        detail: season.survivor_description || "Puedes inscribirte a Survivor de forma independiente y jugar con el mismo calendario y resultados oficiales.",
        statusNotice: survivorMembership?.is_active
          ? `${survivorMembership.remaining_lives}/${survivorMembership.max_lives} vidas disponibles en esta temporada.`
          : survivorMembership?.is_rejected
            ? "La solicitud anterior no fue aprobada. Puedes solicitar nuevamente."
            : survivorMembership
              ? "Tu pago o solicitud fue recibido y espera aprobación del administrador."
              : survivorClosedByAdmin
                ? "El registro de Survivor se encuentra cerrado."
                : isAvalMode
                  ? "Con modalidad aval tu alta entra en automático en cuanto la activas."
                  : "Con pre-pago tu alta queda pendiente de autorización administrativa.",
        meta: `${season.name} · Modalidad: ${modalityLabel} · Costo: ${survivorPriceLabel ?? "Sin costo configurado"}${survivorCloseLabel ? ` · Límite: ${survivorCloseLabel}` : ""}${survivorClosedByAdmin && devModeEnabled ? " · Cierre manual" : ""}`,
        action: survivorMembership?.is_active ? (
          <Link href={buildHrefWithSeason("/dashboard/survivor", season.id, season.competition_id ?? "")} className="text-sm font-semibold text-ink transition hover:text-[#4f7df3]">
            Abrir Survivor
          </Link>
        ) : survivorMembership?.is_rejected && !survivorWindowClosed ? (
          <button type="button" onClick={() => void handleJoinSurvivor(season)} disabled={actionLoading === `survivor:${season.id}`} className="text-sm font-semibold text-[#4f7df3] disabled:opacity-50">
            {actionLoading === `survivor:${season.id}` ? "Enviando..." : "Solicitar nuevamente"}
          </button>
        ) : survivorMembership && isAvalMode && !survivorWindowClosed ? (
          <button
            type="button"
            onClick={() => void handleJoinSurvivor(season)}
            disabled={actionLoading === `survivor:${season.id}`}
            className="text-sm font-semibold text-[#4f7df3] transition disabled:opacity-50"
          >
            {actionLoading === `survivor:${season.id}` ? "Activando..." : "Activar inscripción"}
          </button>
        ) : survivorMembership || survivorWindowClosed ? null : (
          <button
            type="button"
            onClick={() => void handleJoinSurvivor(season)}
            disabled={actionLoading === `survivor:${season.id}` || survivorWindowClosed}
            className="text-sm font-semibold text-ink transition hover:text-[#4f7df3] disabled:opacity-50"
          >
            {actionLoading === `survivor:${season.id}`
              ? "Procesando..."
              : survivorPriceLabel
                ? `Pagar e inscribirme · ${survivorPriceLabel}`
                : "Inscribirme a Survivor"}
          </button>
        ),
      });
    });

    visibleVipCompetitions.forEach((vip) => {
      const status = vipStatusCopy(vip);
      rows.push({
        id: `vip-${vip.id}`,
        name: vip.name,
        availability: vip.join_locked ? "Cerrado" : "Abierto",
        enrollmentStatus: vip.my_membership
          ? status.label
          : vip.join_locked
            ? "No inscrito"
            : "Disponible",
        detail: status.description,
        meta: `${vip.season_name} · Modalidad: ${isAvalMode ? "Aval" : "Pre-pago"} · Costo: ${new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(vip.entry_fee_amount)}${vip.matchdays.length ? ` · ${vip.matchdays.length} jornadas` : ""}${vip.join_lock_at ? ` · Cierre ${formatMexicoDateTime(vip.join_lock_at) ?? "Por definir"}` : ""}`,
        action: (
          <Link
            href={buildHrefWithSeason("/dashboard/vip", vip.season_id)}
            className="text-sm font-semibold text-ink transition hover:text-[#4f7df3]"
          >
            {vip.my_membership ? "Ir a VIP" : "Ver VIP"}
          </Link>
        ),
      });
    });

    return rows;
  }, [
    actionLoading,
    buildHrefWithSeason,
    devModeEnabled,
    isAvalMode,
    survivorPricing,
    seasonPricing,
    state.survivorBoards,
    state.me,
    visibleVipCompetitions,
    visibleSeasonRows,
  ]);

  const activeMembershipRows = useMemo(
    () => membershipRows.filter((row) => row.enrollmentStatus === "Activo"),
    [membershipRows],
  );
  const availableMembershipRows = useMemo(
    () => membershipRows.filter((row) => row.enrollmentStatus !== "Activo" && row.enrollmentStatus !== "Rechazado"),
    [membershipRows],
  );
  const inactiveMembershipRows = useMemo(() => {
    const vipRows = state.vipCompetitions.flatMap((vip) =>
      vip.season_visibility_status !== "archived" && vip.my_membership?.status === "rejected"
        ? [{
            id: `inactive-vip-${vip.id}`,
            name: vip.name,
            meta: vip.season_name,
            status: "Rechazada",
          }]
        : [],
    );
    return vipRows;
  }, [state.vipCompetitions]);

  useEffect(() => {
    if (!availableMembershipRows.length) {
      setExpandedMembershipId(null);
      return;
    }
    setExpandedMembershipId((current) =>
      current && availableMembershipRows.some((row) => row.id === current) ? current : availableMembershipRows[0]?.id ?? null,
    );
  }, [availableMembershipRows]);

  const expandedMembership =
    availableMembershipRows.find((row) => row.id === expandedMembershipId) ?? availableMembershipRows[0] ?? null;

  async function handleJoinSeason(season: Season) {
    if (!season) {
      return;
    }
    setActionLoading(`season:${season.id}`);
    setError(null);
    setMessage(null);
    try {
      const accessToken = await getBrowserAccessToken();
      const me = await backendFetch<Me>(`/me/seasons/${season.id}/join`, accessToken, {
        method: "POST",
      });
      setState((current) => ({
        ...current,
        me,
      }));
      setMessage(
        me.modality === "aval"
          ? `Tu alta a ${getSeasonDisplayName(season)} quedo activa en automatico.`
          : `Tu alta a ${getSeasonDisplayName(season)} quedo solicitada y espera autorizacion admin.`,
      );
    } catch (joinError) {
      setError(joinError instanceof Error ? joinError.message : `No se pudo completar la inscripcion a ${getSeasonDisplayName(season)}`);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleJoinSurvivor(season: Season) {
    setActionLoading(`survivor:${season.id}`);
    setError(null);
    setMessage(null);
    try {
      const accessToken = await getBrowserAccessToken();
      const existingMembership = state.survivorBoards[season.id]?.my_membership ?? null;
      if (survivorPricing[season.id] && !existingMembership) {
        const checkout = await backendFetch<CheckoutSessionResponse>("/payments/checkout-session", accessToken, {
          method: "POST",
          body: JSON.stringify({ scope_type: "survivor", scope_id: season.id }),
        });
        window.location.href = checkout.checkout_url;
        return;
      }
      const survivorBoard = await backendFetch<SurvivorBoard>(
        `/survivor/seasons/${season.id}/join`,
        accessToken,
        { method: "POST" },
      );
      setState((current) => ({
        ...current,
        survivorBoards: {
          ...current.survivorBoards,
          [season.id]: survivorBoard,
        },
      }));
      setMessage(
        survivorBoard.my_membership?.is_active
          ? `Tu alta a ${season.survivor_name?.trim() || `Survivor ${getSeasonDisplayName(season)}`} ya quedó activa.`
          : "Tu solicitud de Survivor fue recibida y espera aprobación del administrador.",
      );
    } catch (joinError) {
      setError(joinError instanceof Error ? joinError.message : "No se pudo completar la inscripcion a Survivor");
    } finally {
      setActionLoading(null);
    }
  }

  if (loading) {
    return <p className="text-sm text-ink/70">Cargando inscripciones...</p>;
  }

  if (error) {
    return <p className="text-sm text-coral">{error}</p>;
  }

  return (
    <div className="space-y-12">
      <header className="page-header">
        <h1 className="page-title">Inscripciones</h1>
      </header>

      <section className="grid gap-x-12 gap-y-5 border-y border-white/10 py-5 sm:grid-cols-2">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-steel">Modalidad</p>
          <p className="mt-2 text-base font-semibold text-ink">{isAvalMode ? "Aval" : "Pre-pago"}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-steel">Aval</p>
          <p className="mt-2 text-base font-semibold text-ink">
            {state.avalDisplayName ?? (state.me?.aval_profile_id ? "Aval asignado" : "No aplica")}
          </p>
        </div>
      </section>

      {message ? <p className="text-sm text-mint">{message}</p> : null}

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-[0.22em] text-steel">Inscripciones activas</h2>

        {activeMembershipRows.length > 0 ? (
          <div className="mt-5 border-y border-white/10">
            <div className="hidden grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_140px_140px] gap-6 border-b border-white/10 py-4 text-xs uppercase tracking-[0.18em] text-steel md:grid">
              <span>Membresia</span>
              <span>Temporada</span>
              <span>Estado</span>
              <span className="text-right">Accion</span>
            </div>
            <div className="divide-y divide-white/10">
              {activeMembershipRows.map((row) => (
                <div
                  key={row.id}
                  className="grid gap-3 py-5 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_140px_140px] md:items-center md:gap-6"
                >
                  <p className="text-sm font-semibold text-ink">{row.name}</p>
                  <p className="text-sm text-steel">{row.meta ?? "—"}</p>
                  <p className="text-sm font-semibold text-mint">{row.enrollmentStatus}</p>
                  <div className="flex md:justify-end">{row.action}</div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="mt-5 border-y border-white/10 py-5 text-sm text-steel">No tienes inscripciones activas.</p>
        )}
      </section>

      {inactiveMembershipRows.length > 0 ? (
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-[0.22em] text-steel">Inactivas</h2>
          <div className="mt-5 border-y border-white/10">
            <div className="hidden grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_140px] gap-6 border-b border-white/10 py-4 text-xs uppercase tracking-[0.18em] text-steel md:grid">
              <span>Membresia</span>
              <span>Temporada</span>
              <span>Estado</span>
            </div>
            <div className="divide-y divide-white/10">
              {inactiveMembershipRows.map((row) => (
                <div
                  key={row.id}
                  className="grid gap-3 py-5 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_140px] md:items-center md:gap-6"
                >
                  <p className="text-sm font-semibold text-ink">{row.name}</p>
                  <p className="text-sm text-steel">{row.meta || "—"}</p>
                  <span className="flex items-center gap-3 text-sm font-semibold text-coral" title="Inscripcion cerrada">
                    <VipStatusIcon type="closed" />
                    {row.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-[0.22em] text-steel">Disponibles</h2>

        {availableMembershipRows.length > 0 ? (
          <>
            {expandedMembership ? (
              <div className="mt-5 border-y border-white/10 py-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-lg font-semibold text-ink">{expandedMembership.name}</p>
                    <p className="mt-2 text-sm text-steel">{expandedMembership.detail}</p>
                    {expandedMembership.statusNotice ? (
                      <p className="mt-2 text-sm font-medium text-ink">{expandedMembership.statusNotice}</p>
                    ) : null}
                    {expandedMembership.meta ? (
                      <p className="mt-2 text-xs text-steel">{expandedMembership.meta}</p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-5 text-sm font-semibold">
                    <span
                      title={`Registro ${expandedMembership.availability.toLowerCase()}`}
                      aria-label={`Registro ${expandedMembership.availability.toLowerCase()}`}
                    >
                      <VipStatusIcon type={expandedMembership.availability === "Abierto" ? "open" : "closed"} />
                    </span>
                    <span className="text-ink">{expandedMembership.enrollmentStatus}</span>
                  </div>
                </div>
                {expandedMembership.action ? <div className="mt-4 flex flex-wrap gap-3">{expandedMembership.action}</div> : null}
              </div>
            ) : null}

            <div className="mt-5 border-y border-white/10">
              <div className="hidden grid-cols-[minmax(0,1.5fr)_120px_140px_180px] gap-6 border-b border-white/10 py-4 text-xs uppercase tracking-[0.18em] text-steel md:grid">
                <span>Membresia</span>
                <span>Registro</span>
                <span>Estado</span>
                <span className="text-right">Accion</span>
              </div>
              <div className="divide-y divide-white/10">
                {availableMembershipRows.map((row) => (
                  <div
                    key={row.id}
                    onClick={() => setExpandedMembershipId(row.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setExpandedMembershipId(row.id);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    className={cn(
                      "grid w-full cursor-pointer gap-3 border-l-2 border-transparent bg-transparent py-5 pl-4 text-left transition hover:text-[#4f7df3] md:grid-cols-[minmax(0,1.5fr)_120px_140px_180px] md:items-center md:gap-6",
                      expandedMembershipId === row.id && "border-[#4f7df3] text-[#4f7df3]",
                    )}
                  >
                    <div>
                      <span className="text-sm font-semibold text-ink">{row.name}</span>
                      {row.meta ? <p className="mt-1 text-xs text-steel">{row.meta}</p> : null}
                    </div>
                    <span
                      className="flex items-center"
                      title={`Registro ${row.availability.toLowerCase()}`}
                      aria-label={`Registro ${row.availability.toLowerCase()}`}
                    >
                      <VipStatusIcon type={row.availability === "Abierto" ? "open" : "closed"} />
                    </span>
                    <span className="text-sm font-semibold text-ink">
                      {row.enrollmentStatus}
                    </span>
                    <div
                      className="flex justify-start md:justify-end"
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => event.stopPropagation()}
                    >
                      {row.action ? <div className="flex flex-wrap justify-end gap-2">{row.action}</div> : <span className="text-sm text-steel">—</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>

          </>
        ) : (
          <p className="mt-5 border-y border-white/10 py-5 text-sm text-steel">No hay nuevas inscripciones disponibles.</p>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-[0.22em] text-steel">Tu historial</h2>
        {state.membershipHistory.length ? (
          <div className="mt-5 border-y border-white/10 divide-y divide-white/10">
            {state.membershipHistory.map((entry) => (
              <div key={`${entry.membership_type}-${entry.id}`} className="grid gap-2 py-4 sm:grid-cols-[130px_minmax(0,1fr)_130px_180px] sm:items-center">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-steel">
                  {entry.membership_type === "quiniela" ? "Quiniela" : entry.membership_type === "survivor" ? "Survivor" : "VIP"}
                </p>
                <div>
                  <p className="font-semibold text-ink">{entry.name}</p>
                  {entry.season_name !== entry.name ? <p className="mt-1 text-xs text-steel">{entry.season_name}</p> : null}
                </div>
                <p className="text-sm font-semibold text-ink">{entry.status}</p>
                <p className="text-sm text-steel">{formatMexicoDateTime(entry.joined_at) ?? "Fecha no disponible"}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-5 border-y border-white/10 py-5 text-sm text-steel">Todavía no tienes inscripciones.</p>
        )}
      </section>

    </div>
  );
}
