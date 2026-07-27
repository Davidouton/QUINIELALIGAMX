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

function shortenQuestionLabel(value: string, maxLength = 44) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
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
  if (vip.season_visibility_status === "archived") {
    return {
      label: "Archivada",
      sublabel: "Consulta histórica",
      tone: "text-steel",
      dot: "bg-steel",
    };
  }
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

export function VipStatusIcon({ type }: { type: "approved" | "pending" | "rejected" | "none" | "open" | "closed" }) {
  const className = type === "approved" || type === "open"
    ? "text-[#3ff28a]"
    : type === "pending"
      ? "text-[#ffe45c]"
      : type === "rejected" || type === "closed"
        ? "text-[#ff647c]"
        : "text-[#8793a6]";
  if (type === "open" || type === "closed") {
    if (type === "closed") {
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" className={`h-5 w-5 shrink-0 ${className}`} fill="currentColor">
          <path d="M8 9V7a4 4 0 0 1 8 0v2h1.5A2.5 2.5 0 0 1 20 11.5v7a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 18.5v-7A2.5 2.5 0 0 1 6.5 9H8Zm2 0h4V7a2 2 0 1 0-4 0v2Z" />
        </svg>
      );
    }
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className={`h-5 w-5 shrink-0 ${className}`} fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="5" y="10" width="14" height="10" rx="2" />
        <path d="M9 10V7a4 4 0 0 1 7-2.6" />
      </svg>
    );
  }
  if (type === "approved") {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className={`h-5 w-5 shrink-0 ${className}`} fill="none" stroke="currentColor" strokeWidth="2"><path d="m5 12 4 4L19 6" /></svg>;
  }
  if (type === "rejected") {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className={`h-5 w-5 shrink-0 ${className}`} fill="none" stroke="currentColor" strokeWidth="2"><path d="m7 7 10 10M17 7 7 17" /></svg>;
  }
  if (type === "pending") {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className={`h-5 w-5 shrink-0 ${className}`} fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="8" /><path d="M12 7v5l3 2" /></svg>;
  }
  return <span aria-hidden="true" className={`inline-flex h-5 w-5 shrink-0 items-center justify-center ${className}`}>—</span>;
}

function membershipIconType(status: VipMembershipStatus | null) {
  if (status === "approved" || status === "pending" || status === "rejected") return status;
  return "none" as const;
}

function getVipModeLabel(vip: VipCompetition) {
  if (vip.competition_kind === "team_winner") {
    return `${vip.team_winner_teams.length} equipos`;
  }
  if (vip.competition_kind === "question_pool") {
    return `${vip.question_pool_questions.length} preguntas`;
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
  const [savingQuestionResponses, setSavingQuestionResponses] = useState(false);
  const [selectedQuestionId, setSelectedQuestionId] = useState("");
  const [questionResponseDrafts, setQuestionResponseDrafts] = useState<Record<string, string | null>>({});
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const activeVips = useMemo(
    () => vips.filter((vip) => vip.season_visibility_status !== "archived"),
    [vips],
  );
  const archivedVips = useMemo(
    () => vips.filter((vip) => vip.season_visibility_status === "archived"),
    [vips],
  );
  const selectedVip = useMemo(
    () => vips.find((vip) => vip.id === selectedVipId) ?? activeVips[0] ?? archivedVips[0] ?? null,
    [activeVips, archivedVips, selectedVipId, vips],
  );
  const selectedVipIsArchived = selectedVip?.season_visibility_status === "archived";
  const selectedVipPricing = selectedVip ? pricingByVipId[selectedVip.id] ?? null : null;
  const questionPoolQuestions = useMemo(
    () =>
      [...(selectedVip?.question_pool_questions ?? [])].sort((left, right) => {
        if (left.sort_order !== right.sort_order) {
          return left.sort_order - right.sort_order;
        }
        return left.prompt.localeCompare(right.prompt);
      }),
    [selectedVip],
  );
  const selectedQuestion =
    questionPoolQuestions.find((question) => question.id === selectedQuestionId) ?? questionPoolQuestions[0] ?? null;
  const savedQuestionResponses = useMemo(
    () =>
      Object.fromEntries(
        questionPoolQuestions.map((question) => [question.id, question.selected_option_id ?? null]),
      ) as Record<string, string | null>,
    [questionPoolQuestions],
  );
  const draftQuestionResponses = useMemo(
    () => ({
      ...savedQuestionResponses,
      ...questionResponseDrafts,
    }),
    [questionResponseDrafts, savedQuestionResponses],
  );
  const answeredQuestionCount = questionPoolQuestions.filter((question) => Boolean(draftQuestionResponses[question.id])).length;
  const pendingQuestionResponseCount = questionPoolQuestions.filter(
    (question) => draftQuestionResponses[question.id] !== savedQuestionResponses[question.id],
  ).length;
  const activeQuestionCount = questionPoolQuestions.filter((question) => question.is_active).length;
  const resolvedQuestionCount = questionPoolQuestions.filter(
    (question) => question.is_active && question.options.some((option) => option.is_correct),
  ).length;
  const myVipLeaderboardEntry = selectedVip?.leaderboard.find(
    (entry) => entry.profile_id === selectedVip.my_membership?.profile_id,
  ) ?? null;
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

  useEffect(() => {
    if (!questionPoolQuestions.some((question) => question.id === selectedQuestionId)) {
      setSelectedQuestionId(questionPoolQuestions[0]?.id ?? "");
    }
  }, [questionPoolQuestions, selectedQuestionId]);

  useEffect(() => {
    setQuestionResponseDrafts((current) =>
      Object.fromEntries(
        questionPoolQuestions.map((question) => [
          question.id,
          Object.prototype.hasOwnProperty.call(current, question.id)
            ? current[question.id]
            : (question.selected_option_id ?? null),
        ]),
      ),
    );
  }, [questionPoolQuestions]);

  async function loadVips() {
    const accessToken = await getBrowserAccessToken();
    const rows = await backendFetch<VipCompetition[]>("/vip", accessToken);
    const pricingEntries = await Promise.all(
      rows.filter((vip) => vip.season_visibility_status !== "archived").map(async (vip) => {
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
    setSelectedVipId((current) =>
      rows.some((vip) => vip.id === current)
        ? current
        : (rows.find((vip) => vip.season_visibility_status !== "archived")?.id ?? rows[0]?.id ?? ""),
    );
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

  useEffect(() => {
    const refreshVips = () => {
      void loadVips().catch((caughtError) => {
        setError(caughtError instanceof Error ? caughtError.message : "No se pudo actualizar VIP");
      });
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") {
        refreshVips();
      }
    };

    window.addEventListener("focus", refreshVips);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    const intervalId = window.setInterval(refreshVips, 5 * 60_000);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refreshVips);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
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

  function handleSelectQuestionResponse(questionId: string, optionId: string) {
    setQuestionResponseDrafts((current) => ({
      ...current,
      [questionId]: current[questionId] === optionId ? null : optionId,
    }));
  }

  async function handleSaveQuestionPoolResponses(vipId: string) {
    const changedQuestions = questionPoolQuestions
      .map((question) => ({
        question_id: question.id,
        option_id: draftQuestionResponses[question.id] ?? null,
      }))
      .filter((row) => row.option_id !== savedQuestionResponses[row.question_id]);
    if (changedQuestions.length === 0) {
      setMessage("No hay cambios por guardar.");
      return;
    }
    setSavingQuestionResponses(true);
    setError(null);
    setMessage(null);
    try {
      const accessToken = await getBrowserAccessToken();
      const updatedVip = await backendFetch<VipCompetition>(`/vip/${vipId}/questions/responses`, accessToken, {
        method: "PUT",
        body: JSON.stringify({ questions: changedQuestions }),
      });
      setVips((current) => current.map((vip) => (vip.id === updatedVip.id ? updatedVip : vip)));
      setMessage(changedQuestions.length === 1 ? "Respuesta guardada." : "Respuestas guardadas.");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudieron guardar tus respuestas");
    } finally {
      setSavingQuestionResponses(false);
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
      <header className="page-header">
        <h1 className="page-title">VIP</h1>
      </header>

      {message ? <p className="text-sm text-mint">{message}</p> : null}
      {error ? <p className="text-sm text-coral">{error}</p> : null}

      <section className="space-y-4">
        <div className="overflow-hidden border-y border-white/[0.08]">
          <div>
            <div className="hidden grid-cols-[minmax(0,1.55fr)_minmax(0,0.72fr)_minmax(0,0.58fr)_minmax(0,0.62fr)_minmax(0,0.72fr)_minmax(0,0.82fr)] gap-3 border-b border-white/[0.08] px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-steel md:grid">
              <span>VIP</span>
              <span className="text-center">Mi acceso</span>
              <span className="text-center">Entrada</span>
              <span className="text-center">Bolsa</span>
              <span className="text-center">Participantes</span>
              <span className="text-center">Estado</span>
            </div>
          {activeVips.map((vip) => {
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
                    ? "text-[#4f7df3]"
                    : "text-ink hover:text-[#4f7df3]"
                }`}
              >
                <div className="min-w-0">
                  <div className="flex items-start justify-between gap-3 md:block">
                    <p className="truncate text-[13px] font-semibold leading-5">{vip.name}</p>
                    <div className="flex shrink-0 flex-wrap justify-end gap-2 md:hidden">
                      <span className={`flex items-center gap-1.5 text-[11px] font-semibold ${membershipStatus.tone}`}>
                        <VipStatusIcon type={membershipIconType(vip.my_membership?.status ?? null)} />
                        {membershipStatus.label}
                      </span>
                      <span
                        className={`flex items-center ${registrationStatus.tone}`}
                        title={`${registrationStatus.label} · ${registrationStatus.sublabel}`}
                        aria-label={`${registrationStatus.label}. ${registrationStatus.sublabel}`}
                      >
                        <VipStatusIcon type={vip.join_locked ? "closed" : "open"} />
                      </span>
                    </div>
                  </div>
                  <p className="mt-0.5 truncate text-xs leading-5 text-steel">{vip.season_name}</p>
                  <p className="mt-1 text-[11px] leading-5 text-steel md:hidden">
                    {getVipModeLabel(vip)} · {participantsCount} participantes · {formatCurrency(vip.entry_fee_amount)}
                  </p>
                </div>
                <div className="hidden min-w-0 text-center md:block">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-steel md:hidden">Mi acceso</p>
                  <p className={`flex min-w-0 items-center justify-center gap-2 text-[13px] font-semibold leading-5 ${membershipStatus.tone}`}>
                    <VipStatusIcon type={membershipIconType(vip.my_membership?.status ?? null)} />
                    <span className="truncate">{membershipStatus.label}</span>
                  </p>
                </div>
                <div className="hidden min-w-0 text-center md:block">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-steel md:hidden">Entrada</p>
                  <p className="text-[13px] font-semibold leading-5 text-ink">{formatCurrency(vip.entry_fee_amount)}</p>
                </div>
                <div className="hidden min-w-0 text-center md:block">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-steel md:hidden">Bolsa</p>
                  <p className="text-[13px] font-semibold leading-5 text-ink">{formatCurrency(vip.gross_pool_amount)}</p>
                </div>
                <div className="hidden min-w-0 text-center md:block">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-steel md:hidden">Participantes</p>
                  <p className="text-[13px] font-semibold leading-5 text-ink">{participantsCount}</p>
                </div>
                <div className="hidden min-w-0 text-center md:block">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-steel md:hidden">Estado</p>
                  <span
                    className="inline-flex items-center justify-center"
                    title={`${registrationStatus.label} · ${registrationStatus.sublabel}`}
                    aria-label={`${registrationStatus.label}. ${registrationStatus.sublabel}`}
                  >
                    <VipStatusIcon type={vip.join_locked ? "closed" : "open"} />
                  </span>
                </div>
              </button>
            );
          })}

          {activeVips.length === 0 ? (
            <div className="border-y border-white/[0.06] px-4 py-5 text-sm text-steel">
              Aun no hay VIPs activas disponibles.
            </div>
          ) : null}
          </div>
        </div>

        {archivedVips.length > 0 ? (
          <details className="border-y border-white/[0.08] py-4">
            <summary className="cursor-pointer text-sm font-semibold uppercase tracking-[0.22em] text-steel">
              Archivados ({archivedVips.length})
            </summary>
            <div className="mt-4 divide-y divide-white/[0.06] border-t border-white/[0.06]">
              {archivedVips.map((vip) => (
                <button
                  key={vip.id}
                  type="button"
                  onClick={() => setSelectedVipId(vip.id)}
                  className={`grid w-full gap-1 px-4 py-4 text-left transition sm:grid-cols-[minmax(0,1fr)_minmax(0,0.7fr)_auto] sm:items-center sm:gap-4 ${
                    selectedVip?.id === vip.id ? "text-[#4f7df3]" : "text-ink hover:text-[#4f7df3]"
                  }`}
                >
                  <span className="font-semibold">{vip.name}</span>
                  <span className="text-sm text-steel">{vip.season_name}</span>
                  <span className="text-xs font-semibold uppercase tracking-[0.16em] text-steel">Archivada</span>
                </button>
              ))}
            </div>
          </details>
        ) : null}

        <div className="space-y-5 border-y border-white/[0.08] py-5">
          {selectedVip ? (
            <>
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm uppercase tracking-[0.22em] text-steel">{selectedVip.season_name}</p>
                    <span
                      className={`flex items-center ${registrationStatusCopy(selectedVip).tone}`}
                      title={`${registrationStatusCopy(selectedVip).label} · ${registrationStatusCopy(selectedVip).sublabel}`}
                      aria-label={`${registrationStatusCopy(selectedVip).label}. ${registrationStatusCopy(selectedVip).sublabel}`}
                    >
                      <VipStatusIcon type={selectedVipIsArchived || selectedVip.join_locked ? "closed" : "open"} />
                    </span>
                    <span className={`flex items-center gap-1.5 text-xs font-semibold ${statusCopy(selectedVip.my_membership?.status ?? null).tone}`}>
                      <VipStatusIcon type={membershipIconType(selectedVip.my_membership?.status ?? null)} />
                      {statusCopy(selectedVip.my_membership?.status ?? null).label}
                    </span>
                  </div>
                  <h2 className="mt-2 text-xl font-semibold text-ink">{selectedVip.name}</h2>
                  {selectedVipIsArchived ? (
                    <p className="mt-2 text-xs font-semibold uppercase tracking-[0.16em] text-steel">
                      Competencia archivada · consulta histórica
                    </p>
                  ) : null}
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

              {!selectedVipIsArchived && selectedVip.my_membership?.status !== "approved" ? (
                <div className="flex flex-wrap items-center gap-3 border-y border-white/[0.06] py-3">
                  {selectedVip.join_locked && !selectedVip.my_membership ? (
                    <span className="text-sm font-semibold text-coral">Solicitud cerrada</span>
                  ) : selectedVipPricing ? (
                    <button
                      type="button"
                      onClick={() => void handleVipCheckout(selectedVip.id)}
                      disabled={payingVipId === selectedVip.id}
                      className="text-sm font-semibold text-ink transition hover:text-[#4f7df3] active:text-[#4f7df3] disabled:opacity-50"
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
                      className="text-sm font-semibold text-ink transition hover:text-[#4f7df3] active:text-[#4f7df3] disabled:opacity-50"
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
                  <div className="grid border-y border-white/[0.08] sm:grid-cols-2 sm:gap-x-8">
                    {selectedTeamWinnerEntries.map((entry) => (
                      <div
                        key={entry.key}
                        className={`border-b border-white/[0.07] px-2 py-3 ${
                          entry.assignedTeamChampion
                            ? "text-mint"
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

              {selectedVip.competition_kind === "question_pool" ? (
                <div className="space-y-4 border-y border-white/[0.06] py-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-xs uppercase tracking-[0.18em] text-steel">Preguntas VIP</p>
                      <p className="mt-1 text-sm text-steel">
                        {selectedVip.questions_lock_at
                          ? `Cierre de respuestas: ${formatMexicoDate(selectedVip.questions_lock_at) ?? selectedVip.questions_lock_at}`
                          : "Sin bloqueo configurado"}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-ink">
                        {answeredQuestionCount}/{questionPoolQuestions.length} respondidas
                      </p>
                      <p className="text-xs text-steel">
                        {pendingQuestionResponseCount > 0
                          ? `${pendingQuestionResponseCount} cambios por guardar`
                          : "Todo guardado"}
                      </p>
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => void handleSaveQuestionPoolResponses(selectedVip.id)}
                      disabled={savingQuestionResponses || pendingQuestionResponseCount === 0}
                      className={`text-sm font-semibold transition hover:text-[#4f7df3] active:text-[#4f7df3] disabled:text-steel/45 ${savingQuestionResponses ? "text-[#4f7df3]" : "text-ink"}`}
                    >
                      {savingQuestionResponses ? "Guardando..." : "Guardar respuestas"}
                    </button>
                  </div>
                  {resolvedQuestionCount > 0 ? (
                    <div className="grid border-y border-white/[0.08] sm:grid-cols-3">
                      <div className="px-4 py-4">
                        <p className="text-xs uppercase tracking-[0.18em] text-steel">
                          {resolvedQuestionCount === activeQuestionCount ? "Score final" : "Score parcial"}
                        </p>
                        <p className="mt-1 text-2xl font-semibold text-mint">
                          {myVipLeaderboardEntry?.total_points ?? 0} pts
                        </p>
                      </div>
                      <div className="border-white/[0.08] px-4 py-4 sm:border-l">
                        <p className="text-xs uppercase tracking-[0.18em] text-steel">Aciertos</p>
                        <p className="mt-1 text-xl font-semibold text-ink">
                          {myVipLeaderboardEntry?.correct_results ?? 0}/{resolvedQuestionCount}
                        </p>
                      </div>
                      <div className="border-white/[0.08] px-4 py-4 sm:border-l">
                        <p className="text-xs uppercase tracking-[0.18em] text-steel">Posición</p>
                        <p className="mt-1 text-xl font-semibold text-ink">
                          {myVipLeaderboardEntry ? `#${myVipLeaderboardEntry.rank_position}` : "—"}
                        </p>
                      </div>
                    </div>
                  ) : null}
                  <div className="grid gap-4 xl:grid-cols-[260px_minmax(0,1fr)]">
                    <div className="xl:border-r xl:border-white/[0.08] xl:pr-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-xs uppercase tracking-[0.18em] text-steel">Preguntas</p>
                        <p className="text-xs text-steel">
                          {answeredQuestionCount}/{questionPoolQuestions.length}
                        </p>
                      </div>
                      <div className="mt-3 max-h-[520px] overflow-y-auto pr-1">
                        {questionPoolQuestions.map((question) => {
                          const draftOptionId = draftQuestionResponses[question.id] ?? null;
                          const savedOptionId = savedQuestionResponses[question.id] ?? null;
                          const isAnswered = Boolean(draftOptionId);
                          const hasPendingChange = draftOptionId !== savedOptionId;
                          const isActive = selectedQuestion?.id === question.id;
                          return (
                            <button
                              key={question.id}
                              type="button"
                              onClick={() => setSelectedQuestionId(question.id)}
                              className={`w-full border-b border-white/[0.07] px-2 py-3 text-left transition ${
                                isActive
                                  ? "text-[#4f7df3]"
                                  : hasPendingChange
                                    ? "text-[#4f7df3]"
                                    : isAnswered
                                      ? "text-mint"
                                      : "text-steel hover:text-ink"
                              }`}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="text-xs font-semibold uppercase tracking-[0.14em]">
                                    P{question.sort_order} · {question.points} pts
                                  </p>
                                  <p className="mt-1 truncate text-sm">{shortenQuestionLabel(question.prompt)}</p>
                                </div>
                                <span className="text-[10px] uppercase tracking-[0.14em]">
                                  {hasPendingChange ? "Cambio" : isAnswered ? "Lista" : "Pendiente"}
                                </span>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {selectedQuestion ? (
                      <div className="px-4 py-2">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-xs uppercase tracking-[0.18em] text-steel">
                              Pregunta {selectedQuestion.sort_order} · {selectedQuestion.points} pts
                            </p>
                            <h3 className="mt-2 text-base font-semibold text-ink">{selectedQuestion.prompt}</h3>
                          </div>
                          {!selectedQuestion.is_active ? <span className="text-xs text-coral">Inactiva</span> : null}
                        </div>
                        <div className="mt-5 border-t border-white/[0.08]">
                          {selectedQuestion.options.map((option) => {
                            const draftSelected = draftQuestionResponses[selectedQuestion.id] === option.id;
                            const savedSelected = savedQuestionResponses[selectedQuestion.id] === option.id;
                            const solved = option.is_correct;
                            const canAnswer =
                              selectedVip.my_membership?.status === "approved" &&
                              !selectedVip.join_locked &&
                              selectedQuestion.is_active;
                            return (
                              <button
                                key={option.id}
                                type="button"
                                onClick={() => handleSelectQuestionResponse(selectedQuestion.id, option.id)}
                                disabled={!canAnswer || savingQuestionResponses}
                                className={`w-full border-b border-white/[0.08] px-3 py-4 text-left text-sm transition ${
                                  solved
                                    ? "text-mint"
                                    : draftSelected
                                      ? "border-l-2 border-l-[#4f7df3] text-[#4f7df3]"
                                      : "text-ink hover:text-[#4f7df3]"
                                } disabled:opacity-80`}
                              >
                                <div className="flex items-center justify-between gap-3">
                                  <span>{option.option_text}</span>
                                  <span className="text-xs">
                                    {solved
                                      ? "Correcta"
                                      : draftSelected
                                        ? draftSelected !== savedSelected
                                          ? "Pendiente"
                                          : "Tu respuesta"
                                        : savedSelected
                                          ? "Guardada"
                                          : ""}
                                  </span>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}
                  </div>
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
                <div className="border-l-2 border-white/[0.12] px-4 py-2 text-sm text-steel">
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

              {selectedVip.competition_kind === "matchday" || selectedVip.competition_kind === "question_pool" ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-4">
                  <p className="text-sm font-semibold uppercase tracking-[0.22em] text-steel">
                    {selectedVip.competition_kind === "question_pool" ? "Ranking de preguntas" : "Leaderboard VIP"}
                  </p>
                  <p className="text-xs text-steel">{selectedVip.leaderboard.length} jugadores</p>
                </div>
                <div className="overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  <table className="min-w-[640px] w-full table-fixed text-left text-[11px] text-ink sm:text-sm">
                    <colgroup>
                      <col className="w-[72px]" />
                      <col className="w-[42%]" />
                      {selectedVip.competition_kind === "matchday" ? <col className="w-[120px]" /> : null}
                      <col className="w-[120px]" />
                      <col className="w-[120px]" />
                    </colgroup>
                    <thead className="app-table-head">
                      <tr>
                        <th className="px-3 py-3">Pos</th>
                        <th className="px-3 py-3">Jugador</th>
                        <th className="px-3 py-3 text-center">Puntos</th>
                        <th className="px-3 py-3 text-center">Aciertos</th>
                        {selectedVip.competition_kind === "matchday" ? (
                          <th className="px-3 py-3 text-center">Exactos</th>
                        ) : null}
                      </tr>
                    </thead>
                    <tbody>
                      {selectedVip.leaderboard.map((entry) => (
                        <tr key={entry.profile_id} className="app-table-row border-b last:border-b-0">
                          <td className="px-3 py-3 font-semibold text-ink">{entry.rank_position}</td>
                          <td className="px-3 py-3 font-medium">{entry.display_name}</td>
                          <td className="px-3 py-3 text-center">{entry.total_points}</td>
                          <td className="px-3 py-3 text-center">{entry.correct_results}</td>
                          {selectedVip.competition_kind === "matchday" ? (
                            <td className="px-3 py-3 text-center">{entry.exact_scores}</td>
                          ) : null}
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
