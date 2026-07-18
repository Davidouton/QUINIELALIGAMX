"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";

import { backendFetch, MATCHDAY_CACHE_TTL_MS } from "@/lib/api/backend";
import { VIP_SUMMARY_PATH } from "@/lib/api/vip";
import { isSeasonLive, resolveSeasonForContext, useDashboardSeasonParam } from "@/lib/dashboard-season";
import { getBrowserAccessToken } from "@/lib/supabase/session";
import type { AppBootstrap, Me, RegisteredUserOption, Season, SurvivorBoard, VipCompetition } from "@/types/api";

type EnrollmentState = {
  me: Me | null;
  seasons: Season[];
  selectedSeason: Season | null;
  survivorBoard: SurvivorBoard | null;
  vipCompetitions: VipCompetition[];
  avalDisplayName: string | null;
};

const initialState: EnrollmentState = {
  me: null,
  seasons: [],
  selectedSeason: null,
  survivorBoard: null,
  vipCompetitions: [],
  avalDisplayName: null,
};

type MembershipRow = {
  id: string;
  name: string;
  availability: "Abierto" | "Cerrado";
  availabilityPillClassName: string;
  enrollmentStatus: string;
  enrollmentPillClassName: string;
  detail: string;
  meta: string | null;
  action: ReactNode;
};

function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function resolveRegularEnrollmentSeason(seasons: Season[], selectedSeason: Season | null) {
  if (selectedSeason?.tournament_format === "standard" && isSeasonLive(selectedSeason)) {
    return selectedSeason;
  }
  return (
    seasons.find((season) => season.tournament_format === "standard" && isSeasonLive(season) && season.is_active) ??
    seasons.find((season) => season.tournament_format === "standard" && isSeasonLive(season)) ??
    seasons.find((season) => season.tournament_format === "standard") ??
    null
  );
}

function isSurvivorAvailableForSeason(season: Season | null) {
  return season?.tournament_format === "standard" || Boolean(season?.survivor_enabled);
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

function seasonStatusCopy({
  hasActiveLigaMxMembership,
  isPrePagoPendingApproval,
}: {
  hasActiveLigaMxMembership: boolean;
  isPrePagoPendingApproval: boolean;
}) {
  if (hasActiveLigaMxMembership) {
    return {
      label: "Activo",
      tone: "text-mint",
      pillClassName: "app-pill-active px-3 text-[10px] text-ink",
    };
  }
  if (isPrePagoPendingApproval) {
    return {
      label: "Pendiente",
      tone: "text-gold",
      pillClassName: "app-pill px-3 text-[10px] text-gold",
    };
  }
  return {
    label: "Disponible",
    tone: "text-ink",
    pillClassName: "app-pill px-3 text-[10px]",
  };
}

function getSeasonDisplayName(season: Season) {
  if (season.tournament_format === "world_cup") {
    return season.competition_name ?? "Mundial";
  }
  return season.competition_name ?? "Liga MX";
}

function getAvailabilityPillClassName({
  isOpen,
  closedByAdmin,
}: {
  isOpen: boolean;
  closedByAdmin: boolean;
}) {
  if (isOpen) {
    return "app-pill px-3 text-[10px] text-mint";
  }
  if (closedByAdmin) {
    return "app-pill px-3 text-[10px] text-coral";
  }
  return "app-pill px-3 text-[10px] text-steel";
}

export function DashboardEnrollmentsPageContent() {
  const [state, setState] = useState<EnrollmentState>(initialState);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [expandedMembershipId, setExpandedMembershipId] = useState<string | null>(null);
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
        const regularEnrollmentSeason = resolveRegularEnrollmentSeason(bootstrap.seasons, selectedSeason);
        const vipRows = accessToken
          ? await backendFetch<VipCompetition[]>(VIP_SUMMARY_PATH, accessToken, {
              cacheTtlMs: MATCHDAY_CACHE_TTL_MS,
            }).catch(() => [])
          : [];
        const registeredUsers =
          accessToken && bootstrap.me.aval_profile_id
            ? await backendFetch<RegisteredUserOption[]>("/me/registered-users", accessToken, {
                cacheTtlMs: MATCHDAY_CACHE_TTL_MS,
              }).catch(() => [])
            : [];
        let survivorBoard: SurvivorBoard | null = null;
        if (accessToken && regularEnrollmentSeason && isSurvivorAvailableForSeason(regularEnrollmentSeason)) {
          try {
            survivorBoard = await backendFetch<SurvivorBoard>(
              `/survivor/board?season_id=${regularEnrollmentSeason.id}`,
              accessToken,
            );
          } catch {
            survivorBoard = null;
          }
        }

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
          survivorBoard,
          vipCompetitions: vipRows,
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

  const regularEnrollmentSeason = useMemo(
    () => resolveRegularEnrollmentSeason(state.seasons, state.selectedSeason),
    [state.seasons, state.selectedSeason],
  );
  const selectedSeasonMembership = useMemo(
    () =>
      state.me && regularEnrollmentSeason
        ? state.me.season_memberships.find((membership) => membership.season_id === regularEnrollmentSeason.id) ?? null
        : null,
    [regularEnrollmentSeason, state.me],
  );
  const isLigaMxSeason = regularEnrollmentSeason?.tournament_format === "standard";
  const isAvalMode = state.me?.modality === "aval";
  const hasActiveLigaMxMembership = Boolean(selectedSeasonMembership?.is_active);
  const isPrePagoPendingApproval = Boolean(
    selectedSeasonMembership && !selectedSeasonMembership.is_active && state.me?.modality === "pre_pago",
  );
  const canShowSurvivorCard = Boolean(isLigaMxSeason && isSurvivorAvailableForSeason(regularEnrollmentSeason));
  const survivorMembership = state.survivorBoard?.my_membership ?? null;
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
  const survivorWindowClosed = state.survivorBoard?.season
    ? !state.survivorBoard.season.registration_open
    : isClosedAt(regularEnrollmentSeason?.survivor_registration_lock_at ?? null);

  const membershipRows = useMemo(() => {
    const rows: MembershipRow[] = [];

    visibleSeasonRows.forEach((season) => {
      const membership = state.me?.season_memberships.find((item) => item.season_id === season.id) ?? null;
      const hasActiveMembership = Boolean(membership?.is_active);
      const isPendingApproval = Boolean(membership && !membership.is_active && state.me?.modality === "pre_pago");
      const windowClosed = isClosedAt(season.participants_lock_at);
      const registrationClosedByAdmin = season.registration_closed;
      const seasonClosed = registrationClosedByAdmin || windowClosed;
      const isLigaMxRegular = season.tournament_format === "standard";
      const seasonTitle = isLigaMxRegular ? "Liga MX" : getSeasonDisplayName(season);
      const membershipStatus = seasonStatusCopy({
        hasActiveLigaMxMembership: hasActiveMembership,
        isPrePagoPendingApproval: isPendingApproval,
      });

      rows.push({
        id: `season-${season.id}`,
        name: seasonTitle,
        availability: seasonClosed ? "Cerrado" : "Abierto",
        availabilityPillClassName: getAvailabilityPillClassName({
          isOpen: !seasonClosed,
          closedByAdmin: registrationClosedByAdmin,
        }),
        enrollmentStatus: hasActiveMembership
          ? "Activo"
          : isPendingApproval
            ? "Pendiente"
            : "No inscrito",
        enrollmentPillClassName: membershipStatus.pillClassName,
        detail: hasActiveMembership
          ? "Tu membresia ya esta activa y puedes entrar al dashboard, picks, scores y ranking."
          : registrationClosedByAdmin
            ? "El registro de esta liga fue cerrado por administracion."
          : isAvalMode
            ? "Con modalidad aval tu alta entra en automatico en cuanto la activas."
            : "Con pre-pago tu alta se registra y queda pendiente de autorizacion admin.",
        meta: registrationClosedByAdmin
          ? `${season.name} · Registro cerrado manualmente`
          : season.name,
        action: hasActiveMembership ? (
          <Link href={buildHrefWithSeason("/dashboard", season.id, season.competition_id ?? "")} className="secondary-button">
            Ir al dashboard
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => void handleJoinSeason(season)}
            disabled={actionLoading === `season:${season.id}` || seasonClosed}
            className="secondary-button disabled:opacity-60"
          >
            {actionLoading === `season:${season.id}`
              ? "Procesando..."
              : registrationClosedByAdmin
                ? `${seasonTitle} cerrada`
              : isAvalMode
                ? `Inscribirme a ${seasonTitle}`
                : `Solicitar alta ${seasonTitle}`}
          </button>
        ),
      });
    });

  if (canShowSurvivorCard) {
      const survivorClosedByAdmin = Boolean(regularEnrollmentSeason?.survivor_registration_closed);
      const survivorEnrollmentStatus = survivorMembership ? "Activo" : "No inscrito";
      rows.push({
        id: "survivor-liga-mx",
        name: "Survivor Liga MX",
        availability: survivorWindowClosed ? "Cerrado" : "Abierto",
        availabilityPillClassName: getAvailabilityPillClassName({
          isOpen: !survivorWindowClosed,
          closedByAdmin: survivorClosedByAdmin,
        }),
        enrollmentStatus: survivorEnrollmentStatus,
        enrollmentPillClassName: survivorMembership
          ? "app-pill-active px-3 text-[10px] text-ink"
          : "app-pill px-3 text-[10px]",
        detail: survivorMembership
          ? `${survivorMembership.remaining_lives}/${survivorMembership.max_lives} vidas disponibles en esta temporada.`
          : survivorClosedByAdmin
            ? "El registro de survivor fue cerrado por administracion."
            : "Puedes inscribirte a Survivor de forma independiente y jugar con el mismo calendario y resultados oficiales.",
        meta: survivorClosedByAdmin
          ? "Registro cerrado manualmente"
          : state.survivorBoard?.season.registration_lock_at
              ? `Cierre ${formatMexicoDateTime(state.survivorBoard.season.registration_lock_at) ?? "Por definir"}`
              : regularEnrollmentSeason?.survivor_registration_lock_at
                ? `Cierre ${formatMexicoDateTime(regularEnrollmentSeason.survivor_registration_lock_at) ?? "Por definir"}`
                : null,
        action: survivorMembership ? (
          <Link href={buildHrefWithSeason("/dashboard/survivor")} className="secondary-button">
            Abrir Survivor
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => void handleJoinSurvivor()}
            disabled={actionLoading === "survivor" || survivorWindowClosed}
            className="secondary-button disabled:opacity-60"
          >
            {actionLoading === "survivor"
              ? "Procesando..."
              : survivorClosedByAdmin
                ? "Survivor cerrada"
                : "Inscribirme a Survivor"}
          </button>
        ),
      });
    }

    visibleVipCompetitions.forEach((vip) => {
      const status = vipStatusCopy(vip);
      rows.push({
        id: `vip-${vip.id}`,
        name: vip.name,
        availability: vip.join_locked ? "Cerrado" : "Abierto",
        availabilityPillClassName: getAvailabilityPillClassName({
          isOpen: !vip.join_locked,
          closedByAdmin: false,
        }),
        enrollmentStatus: vip.my_membership
          ? status.label
          : vip.join_locked
            ? "No inscrito"
            : "Disponible",
        enrollmentPillClassName:
          status.label === "Activo"
            ? "app-pill-active px-3 text-[10px] text-ink"
            : status.label === "Pendiente"
              ? "app-pill px-3 text-[10px] text-gold"
              : status.label === "Rechazado"
                ? "app-pill px-3 text-[10px] text-coral"
                : "app-pill px-3 text-[10px]",
        detail: status.description,
        meta:
          vip.season_name || vip.join_lock_at || vip.matchdays.length
            ? `${vip.season_name}${vip.matchdays.length ? ` · ${vip.matchdays.length} jornadas` : ""}${vip.join_lock_at ? ` · Cierre ${formatMexicoDateTime(vip.join_lock_at) ?? "Por definir"}` : ""}`
            : null,
        action: (
          <Link
            href={buildHrefWithSeason("/dashboard/vip", vip.season_id)}
            className="secondary-button"
          >
            {vip.my_membership ? "Administrar VIP" : "Abrir VIP"}
          </Link>
        ),
      });
    });

    return rows;
  }, [
    actionLoading,
    buildHrefWithSeason,
    canShowSurvivorCard,
    hasActiveLigaMxMembership,
    isAvalMode,
    state.survivorBoard,
    state.me,
    survivorMembership,
    survivorWindowClosed,
    visibleVipCompetitions,
    visibleSeasonRows,
  ]);

  const activeMembershipRows = useMemo(
    () => membershipRows.filter((row) => row.enrollmentStatus === "Activo"),
    [membershipRows],
  );
  const availableMembershipRows = useMemo(
    () => membershipRows.filter((row) => row.enrollmentStatus !== "Activo"),
    [membershipRows],
  );

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

  async function handleJoinSurvivor() {
    if (!regularEnrollmentSeason) {
      return;
    }
    setActionLoading("survivor");
    setError(null);
    setMessage(null);
    try {
      const accessToken = await getBrowserAccessToken();
      const survivorBoard = await backendFetch<SurvivorBoard>(
        `/survivor/seasons/${regularEnrollmentSeason.id}/join`,
        accessToken,
        { method: "POST" },
      );
      setState((current) => ({
        ...current,
        survivorBoard,
      }));
      setMessage("Tu alta a Survivor ya quedo activa.");
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
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[30px] border border-white/[0.06] bg-white/[0.03]">
        <div className="px-5 py-5 sm:px-6 sm:py-6">
          <p className="text-xs uppercase tracking-[0.28em] text-steel">Inscripciones</p>
          <h1 className="mt-2 text-2xl font-semibold text-ink sm:text-3xl">Altas abiertas para tu cuenta</h1>

          <div className="mt-5 grid gap-3 lg:grid-cols-[minmax(0,220px)_minmax(0,1fr)]">
            <div className="rounded-[18px] border border-white/[0.06] bg-night/20 px-4 py-4">
              <p className="text-[10px] uppercase tracking-[0.16em] text-steel">Modalidad</p>
              <p className="mt-2 text-lg font-semibold text-ink">{isAvalMode ? "Aval" : "Pre-pago"}</p>
              <p className="mt-1 text-xs text-steel">
                {isAvalMode ? "Alta automatica en Liga MX." : "Requiere autorizacion admin."}
              </p>
            </div>
            <div className="rounded-[18px] border border-white/[0.06] bg-night/20 px-4 py-4">
              <p className="text-[10px] uppercase tracking-[0.16em] text-steel">Aval</p>
              <p className="mt-2 text-lg font-semibold text-ink">
                {state.avalDisplayName ?? (state.me?.aval_profile_id ? "Aval asignado" : "No aplica")}
              </p>
              <p className="mt-1 text-xs text-steel">
                {state.me?.aval_profile_id ? "Configurado por admin para tu cuenta." : "Sin aval ligado a esta cuenta."}
              </p>
            </div>
          </div>
        </div>
        {message ? (
          <div className="border-t border-white/[0.06] bg-mint/10 px-5 py-3 text-sm text-mint sm:px-6">
            {message}
          </div>
        ) : null}
      </section>

      <section className="rounded-[28px] border border-white/[0.06] bg-white/[0.03] px-5 py-5 sm:px-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-steel">Jugando</p>
            <h2 className="mt-2 text-xl font-semibold text-ink">Lo que ya tienes inscrito</h2>
          </div>
        </div>

        {activeMembershipRows.length > 0 ? (
          <div className="mt-5 overflow-hidden rounded-[20px] border border-white/[0.06]">
            <div className="hidden grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_180px_140px] gap-3 border-b border-white/[0.06] bg-white/[0.03] px-4 py-3 text-[10px] uppercase tracking-[0.16em] text-steel md:grid">
              <span>Membresia</span>
              <span>Detalle</span>
              <span>Dashboard</span>
              <span>Estatus</span>
            </div>
            <div className="divide-y divide-white/[0.06]">
              {activeMembershipRows.map((row) => (
                <div
                  key={row.id}
                  className="grid gap-3 px-4 py-4 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_180px_140px] md:items-center"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink">{row.name}</p>
                    {row.meta ? <p className="mt-1 text-xs text-steel">{row.meta}</p> : null}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm text-steel">{row.detail}</p>
                  </div>
                  <div className="min-w-0">
                    {row.action ? <div className="flex flex-wrap gap-3">{row.action}</div> : null}
                  </div>
                  <div className="flex justify-start md:justify-end">
                    <span className={row.enrollmentPillClassName}>{row.enrollmentStatus}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="mt-5 rounded-[22px] border border-white/[0.06] bg-night/20 px-4 py-4">
            <p className="text-sm text-steel">Aun no tienes membresias activas para jugar.</p>
          </div>
        )}
      </section>

      <section className="rounded-[28px] border border-white/[0.06] bg-white/[0.03] px-5 py-5 sm:px-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-steel">Membresias</p>
            <h2 className="mt-2 text-xl font-semibold text-ink">Disponibles para inscripcion</h2>
          </div>
          <div className="text-xs text-steel">Puedes inscribirte directo desde la lista o abrir el detalle abajo.</div>
        </div>

        {availableMembershipRows.length > 0 ? (
          <>
            <div className="mt-5 overflow-hidden rounded-[20px] border border-white/[0.06]">
              <div className="hidden grid-cols-[minmax(0,1.5fr)_120px_140px_180px] gap-3 border-b border-white/[0.06] bg-white/[0.03] px-4 py-3 text-[10px] uppercase tracking-[0.16em] text-steel md:grid">
                <span>Membresia</span>
                <span>Estado</span>
                <span>Inscripcion</span>
                <span className="text-right">Accion</span>
              </div>
              <div className="divide-y divide-white/[0.06]">
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
                      "grid w-full cursor-pointer gap-3 bg-transparent px-4 py-4 text-left transition hover:bg-white/[0.03] md:grid-cols-[minmax(0,1.5fr)_120px_140px_180px] md:items-center",
                      expandedMembershipId === row.id && "bg-white/[0.03]",
                    )}
                  >
                    <div>
                      <span className="text-sm font-semibold text-ink">{row.name}</span>
                      {row.meta ? <p className="mt-1 text-xs text-steel">{row.meta}</p> : null}
                    </div>
                    <span
                      className={row.availabilityPillClassName}
                    >
                      {row.availability}
                    </span>
                    <span className="text-xs font-semibold uppercase tracking-[0.14em] text-sand/90">
                      {row.enrollmentStatus}
                    </span>
                    <div
                      className="flex justify-start md:justify-end"
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => event.stopPropagation()}
                    >
                      {row.action ? <div className="flex flex-wrap justify-end gap-2">{row.action}</div> : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {expandedMembership ? (
              <div className="mt-4 rounded-[22px] border border-white/[0.06] bg-night/20 px-4 py-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-lg font-semibold text-ink">{expandedMembership.name}</p>
                    <p className="mt-2 text-sm text-steel">{expandedMembership.detail}</p>
                    {expandedMembership.meta ? (
                      <p className="mt-2 text-xs text-steel">{expandedMembership.meta}</p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <span className={expandedMembership.availabilityPillClassName}>{expandedMembership.availability}</span>
                    <span className={expandedMembership.enrollmentPillClassName}>{expandedMembership.enrollmentStatus}</span>
                  </div>
                </div>
                {expandedMembership.action ? <div className="mt-4 flex flex-wrap gap-3">{expandedMembership.action}</div> : null}
              </div>
            ) : null}
          </>
        ) : (
          <div className="mt-5 rounded-[22px] border border-white/[0.06] bg-night/20 px-4 py-4">
            <p className="text-sm text-steel">
              No encontramos nuevas membresias abiertas para inscripcion en este momento.
            </p>
          </div>
        )}
      </section>

    </div>
  );
}
