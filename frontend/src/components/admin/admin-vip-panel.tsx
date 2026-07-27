"use client";

import { useEffect, useMemo, useState } from "react";

import { backendFetch } from "@/lib/api/backend";
import { formatMexicoCityDateTime } from "@/lib/datetime/mexico-city";
import { getBrowserAccessToken } from "@/lib/supabase/session";
import type { AdminUser, AdminVipCompetition, Matchday, Season, Team, VipCompetitionKind, VipLifecycleStatus } from "@/types/api";

type FormState = {
  competitionKind: VipCompetitionKind;
  name: string;
  seasonId: string;
  entryFeeAmount: string;
  adminCommissionPct: string;
  firstPlacePct: string;
  secondPlacePct: string;
  thirdPlacePct: string;
  questionsLockAt: string;
  isActive: boolean;
  matchdayIds: string[];
};

type QuestionFormState = {
  prompt: string;
  points: string;
  sortOrder: string;
  isActive: boolean;
  options: string[];
};

const initialForm: FormState = {
  competitionKind: "matchday",
  name: "",
  seasonId: "",
  entryFeeAmount: "",
  adminCommissionPct: "0",
  firstPlacePct: "0",
  secondPlacePct: "0",
  thirdPlacePct: "0",
  questionsLockAt: "",
  isActive: true,
  matchdayIds: [],
};

function lifecycleLabel(status: VipLifecycleStatus) {
  if (status === "closed_pending_payments") return "Cerrada · pagos pendientes";
  if (status === "settled") return "Liquidada";
  if (status === "archived") return "Archivada";
  return "Activa";
}

const initialQuestionForm: QuestionFormState = {
  prompt: "",
  points: "1",
  sortOrder: "1",
  isActive: true,
  options: ["", ""],
};

const flatFieldClass =
  "field-control h-9 rounded-[6px] border-white/[0.08] bg-transparent px-3 text-sm";
const flatLabelClass = "text-[10px] font-semibold uppercase tracking-[0.18em] text-steel";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format(value);
}

function getPaymentLabel(isPaid: boolean) {
  return isPaid ? "Pagado" : "Pendiente";
}

function getCaughtMessage(caughtError: unknown, fallback: string) {
  return caughtError instanceof Error ? caughtError.message : fallback;
}

function toDateTimeLocalValue(value: string | null) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const formatter = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return formatter.format(date).replace(" ", "T");
}

function toApiDateTime(value: string) {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  const isoLikeMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (isoLikeMatch) {
    const [, year, month, day, hour, minute] = isoLikeMatch;
    const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), 0);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  const localizedMatch = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4}),?\s*(\d{2}):(\d{2})$/);
  if (localizedMatch) {
    const [, day, month, year, hour, minute] = localizedMatch;
    const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), 0);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
}

function formatLocalDateTimeLabel(value: string) {
  if (!value) {
    return "";
  }
  const isoValue = toApiDateTime(value);
  if (isoValue) {
    return formatMexicoCityDateTime(isoValue);
  }
  return value.replace("T", " ");
}

function shortenQuestionLabel(value: string, maxLength = 52) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function normalizeVipCompetition(vip: AdminVipCompetition): AdminVipCompetition {
  const questionPoolQuestions = Array.isArray(vip.question_pool_questions)
    ? vip.question_pool_questions.map((question) => ({
        ...question,
        options: Array.isArray(question.options) ? question.options : [],
      }))
    : [];

  return {
    ...vip,
    matchdays: Array.isArray(vip.matchdays) ? vip.matchdays : [],
    memberships: Array.isArray(vip.memberships) ? vip.memberships : [],
    leaderboard: Array.isArray(vip.leaderboard) ? vip.leaderboard : [],
    team_winner_teams: Array.isArray(vip.team_winner_teams) ? vip.team_winner_teams : [],
    team_winner_entries: Array.isArray(vip.team_winner_entries) ? vip.team_winner_entries : [],
    question_pool_questions: questionPoolQuestions,
  };
}

function toFormState(vip: AdminVipCompetition | null, seasons: Season[]): FormState {
  if (!vip) {
    return {
      ...initialForm,
      seasonId: seasons.find((season) => season.is_active)?.id ?? seasons[0]?.id ?? "",
    };
  }
  return {
    competitionKind: vip.competition_kind,
    name: vip.name,
    seasonId: vip.season_id,
    entryFeeAmount: String(vip.entry_fee_amount),
    adminCommissionPct: String(vip.admin_commission_pct),
    firstPlacePct: String(vip.first_place_pct),
    secondPlacePct: String(vip.second_place_pct),
    thirdPlacePct: String(vip.third_place_pct),
    questionsLockAt: toDateTimeLocalValue(vip.questions_lock_at),
    isActive: vip.is_active,
    matchdayIds: vip.matchdays.map((matchday) => matchday.id),
  };
}

export function AdminVipPanel() {
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [matchdays, setMatchdays] = useState<Matchday[]>([]);
  const [vips, setVips] = useState<AdminVipCompetition[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedVipId, setSelectedVipId] = useState("");
  const [form, setForm] = useState<FormState>(initialForm);
  const [addMemberProfileId, setAddMemberProfileId] = useState("");
  const [teamWinnerTeamIds, setTeamWinnerTeamIds] = useState<string[]>([]);
  const [teamWinnerProfileIds, setTeamWinnerProfileIds] = useState<string[]>([]);
  const [includeHouse, setIncludeHouse] = useState(false);
  const [houseLabel, setHouseLabel] = useState("Casa");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [updatingLifecycle, setUpdatingLifecycle] = useState(false);
  const [savingTeamWinner, setSavingTeamWinner] = useState(false);
  const [savingQuestion, setSavingQuestion] = useState(false);
  const [importingQuestions, setImportingQuestions] = useState(false);
  const [deletingVip, setDeletingVip] = useState(false);
  const [addingMember, setAddingMember] = useState(false);
  const [recalculatingVip, setRecalculatingVip] = useState(false);
  const [processingMembershipId, setProcessingMembershipId] = useState<string | null>(null);
  const [savingQuestionAnswers, setSavingQuestionAnswers] = useState(false);
  const [deletingQuestionId, setDeletingQuestionId] = useState<string | null>(null);
  const [selectedQuestionId, setSelectedQuestionId] = useState("");
  const [questionCorrectOptionDrafts, setQuestionCorrectOptionDrafts] = useState<Record<string, string | null>>({});
  const [questionForm, setQuestionForm] = useState<QuestionFormState>(initialQuestionForm);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const selectedVip = useMemo(
    () => vips.find((vip) => vip.id === selectedVipId) ?? null,
    [selectedVipId, vips],
  );

  const seasonMatchdays = useMemo(
    () =>
      matchdays
        .filter((matchday) => !form.seasonId || matchday.season_id === form.seasonId)
        .sort((left, right) => left.number - right.number),
    [form.seasonId, matchdays],
  );
  const selectedSeason = useMemo(
    () => seasons.find((season) => season.id === form.seasonId) ?? null,
    [form.seasonId, seasons],
  );
  const eligibleTeams = useMemo(
    () =>
      teams
        .filter((team) => !selectedSeason?.competition_id || team.competition_ids.includes(selectedSeason.competition_id))
        .sort((left, right) => left.name.localeCompare(right.name)),
    [selectedSeason, teams],
  );

  const pendingMemberships = useMemo(
    () => selectedVip?.memberships.filter((membership) => membership.status === "pending") ?? [],
    [selectedVip],
  );
  const approvedMemberships = useMemo(
    () => selectedVip?.memberships.filter((membership) => membership.status === "approved") ?? [],
    [selectedVip],
  );
  const addableUsers = useMemo(() => {
    if (!selectedVip) {
      return users;
    }
    const approvedProfileIds = new Set(approvedMemberships.map((membership) => membership.profile_id));
    return users
      .filter((user) => !approvedProfileIds.has(user.id))
      .sort((left, right) => left.display_name.localeCompare(right.display_name));
  }, [approvedMemberships, selectedVip, users]);
  const payoutPct =
    Number(form.firstPlacePct || 0) + Number(form.secondPlacePct || 0) + Number(form.thirdPlacePct || 0);
  const teamWinnerEntries = selectedVip?.team_winner_entries ?? [];
  const teamWinnerTeams = selectedVip?.team_winner_teams ?? [];
  const isTeamWinnerMode = form.competitionKind === "team_winner";
  const isQuestionPoolMode = form.competitionKind === "question_pool";
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
  const questionPoolTotalPoints = questionPoolQuestions.reduce((sum, question) => sum + question.points, 0);
  const savedQuestionCorrectOptions = useMemo(
    () =>
      Object.fromEntries(
        questionPoolQuestions.map((question) => [
          question.id,
          question.options.find((option) => option.is_correct)?.id ?? null,
        ]),
      ) as Record<string, string | null>,
    [questionPoolQuestions],
  );
  const draftQuestionCorrectOptions = useMemo(
    () => ({
      ...savedQuestionCorrectOptions,
      ...questionCorrectOptionDrafts,
    }),
    [questionCorrectOptionDrafts, savedQuestionCorrectOptions],
  );
  const questionPoolResolvedCount = questionPoolQuestions.filter((question) =>
    Boolean(draftQuestionCorrectOptions[question.id]),
  ).length;
  const questionPoolPendingSaveCount = questionPoolQuestions.filter(
    (question) => draftQuestionCorrectOptions[question.id] !== savedQuestionCorrectOptions[question.id],
  ).length;
  const teamWinnerParticipantCount = teamWinnerProfileIds.length + (includeHouse ? 1 : 0);
  const hasTeamWinnerDraw = teamWinnerEntries.some((entry) => entry.reveal_order);
  const revealedTeamWinnerCount = teamWinnerEntries.filter((entry) => entry.revealed_at).length;
  const nextTeamWinnerEntry =
    teamWinnerEntries.find((entry) => entry.reveal_order && !entry.revealed_at) ?? null;
  const canRunTeamWinnerDraw =
    Boolean(selectedVip) &&
    selectedVip?.competition_kind === "team_winner" &&
    !hasTeamWinnerDraw &&
    teamWinnerParticipantCount > 0 &&
    teamWinnerTeamIds.length >= teamWinnerParticipantCount;

  function syncTeamWinnerDraft(vip: AdminVipCompetition | null) {
    const normalizedVip = vip ? normalizeVipCompetition(vip) : null;
    setTeamWinnerTeamIds(normalizedVip?.team_winner_teams.map((team) => team.team_id) ?? []);
    setTeamWinnerProfileIds(
      normalizedVip?.team_winner_entries
        .filter((entry) => !entry.is_house && entry.profile_id)
        .map((entry) => entry.profile_id as string) ?? [],
    );
    const houseEntry = normalizedVip?.team_winner_entries.find((entry) => entry.is_house) ?? null;
    setIncludeHouse(Boolean(houseEntry));
    setHouseLabel(houseEntry?.display_name ?? "Casa");
  }

  function syncQuestionDraft(vip: AdminVipCompetition | null) {
    const normalizedVip = vip ? normalizeVipCompetition(vip) : null;
    setQuestionForm({
      ...initialQuestionForm,
      sortOrder: String((normalizedVip?.question_pool_questions.length ?? 0) + 1),
    });
    setQuestionCorrectOptionDrafts(
      Object.fromEntries(
        (normalizedVip?.question_pool_questions ?? []).map((question) => [
          question.id,
          question.options.find((option) => option.is_correct)?.id ?? null,
        ]),
      ),
    );
  }

  async function loadPanel(preferredVipId = selectedVipId) {
    const accessToken = await getBrowserAccessToken();
    const [seasonsResult, matchdaysResult, vipResult, usersResult, teamsResult] = await Promise.allSettled([
      backendFetch<Season[]>("/seasons", accessToken),
      backendFetch<Matchday[]>("/matchdays", accessToken),
      backendFetch<AdminVipCompetition[]>("/admin/vip", accessToken),
      backendFetch<AdminUser[]>("/admin/users", accessToken),
      backendFetch<Team[]>("/teams", accessToken),
    ]);

    const seasonRows = seasonsResult.status === "fulfilled" ? seasonsResult.value : [];
    const matchdayRows = matchdaysResult.status === "fulfilled" ? matchdaysResult.value : [];
    const rawVipRows = vipResult.status === "fulfilled" ? vipResult.value : [];
    const userRows = usersResult.status === "fulfilled" ? usersResult.value : [];
    const teamRows = teamsResult.status === "fulfilled" ? teamsResult.value : [];
    const vipRows = rawVipRows.map(normalizeVipCompetition);
    const loadErrors = [
      seasonsResult.status === "rejected" ? `Temporadas: ${getCaughtMessage(seasonsResult.reason, "Load failed")}` : null,
      matchdaysResult.status === "rejected" ? `Jornadas: ${getCaughtMessage(matchdaysResult.reason, "Load failed")}` : null,
      vipResult.status === "rejected" ? `VIPs: ${getCaughtMessage(vipResult.reason, "Load failed")}` : null,
      usersResult.status === "rejected" ? `Usuarios: ${getCaughtMessage(usersResult.reason, "Load failed")}` : null,
      teamsResult.status === "rejected" ? `Equipos: ${getCaughtMessage(teamsResult.reason, "Load failed")}` : null,
    ].filter((value): value is string => Boolean(value));

    setSeasons(seasonRows);
    setMatchdays(matchdayRows);
    setVips(vipRows);
    setUsers(userRows);
    setTeams(teamRows);

    const nextSelectedVip = vipRows.find((vip) => vip.id === preferredVipId) ?? vipRows[0] ?? null;
    setSelectedVipId(nextSelectedVip?.id ?? "");
    setForm(toFormState(nextSelectedVip, seasonRows));
    setAddMemberProfileId("");
    syncTeamWinnerDraft(nextSelectedVip);
    syncQuestionDraft(nextSelectedVip);
    setError(loadErrors.length > 0 ? loadErrors.join(" | ") : null);
    if (nextSelectedVip) {
      void loadVipDetail(nextSelectedVip.id, accessToken).catch((caughtError) => {
        setError(caughtError instanceof Error ? caughtError.message : "No se pudo cargar el detalle VIP");
      });
    }
  }

  async function loadVipDetail(vipId: string, accessToken?: string) {
    const token = accessToken ?? (await getBrowserAccessToken());
    const detailedVip = normalizeVipCompetition(await backendFetch<AdminVipCompetition>(`/admin/vip/${vipId}`, token));
    setVips((current) => current.map((vip) => (vip.id === detailedVip.id ? detailedVip : vip)));
  }

  function replaceVipAndRefreshDetail(updatedVip: AdminVipCompetition, accessToken?: string) {
    const normalizedVip = normalizeVipCompetition(updatedVip);
    setVips((current) => current.map((vip) => (vip.id === normalizedVip.id ? normalizedVip : vip)));
    window.setTimeout(() => {
      void loadVipDetail(normalizedVip.id, accessToken).catch((caughtError) => {
        setError(caughtError instanceof Error ? caughtError.message : "No se pudo refrescar el detalle VIP");
      });
    }, 1200);
  }

  useEffect(() => {
    async function runLoad() {
      try {
        await loadPanel();
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "No se pudo cargar VIP admin");
      } finally {
        setLoading(false);
      }
    }

    void runLoad();
  }, []);

  useEffect(() => {
    if (form.seasonId || seasons.length === 0) {
      return;
    }
    const fallbackSeasonId = seasons.find((season) => season.is_active)?.id ?? seasons[0]?.id ?? "";
    if (!fallbackSeasonId) {
      return;
    }
    setForm((current) => ({ ...current, seasonId: fallbackSeasonId }));
  }, [form.seasonId, seasons]);

  useEffect(() => {
    if (!questionPoolQuestions.some((question) => question.id === selectedQuestionId)) {
      setSelectedQuestionId(questionPoolQuestions[0]?.id ?? "");
    }
  }, [questionPoolQuestions, selectedQuestionId]);

  function resetForNewVip() {
    setSelectedVipId("");
    setSelectedQuestionId("");
    setForm(toFormState(null, seasons));
    setAddMemberProfileId("");
    syncTeamWinnerDraft(null);
    syncQuestionDraft(null);
    setMessage(null);
    setError(null);
  }

  function selectVip(vip: AdminVipCompetition) {
    setSelectedVipId(vip.id);
    setSelectedQuestionId(vip.question_pool_questions[0]?.id ?? "");
    setForm(toFormState(vip, seasons));
    setAddMemberProfileId("");
    syncTeamWinnerDraft(vip);
    syncQuestionDraft(vip);
    setMessage(null);
    setError(null);
    void loadVipDetail(vip.id).catch((caughtError) => {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo cargar el detalle VIP");
    });
  }

  function toggleMatchday(matchdayId: string) {
    setForm((current) => ({
      ...current,
      matchdayIds: current.matchdayIds.includes(matchdayId)
        ? current.matchdayIds.filter((id) => id !== matchdayId)
        : [...current.matchdayIds, matchdayId],
    }));
  }

  function toggleTeamWinnerTeam(teamId: string) {
    setTeamWinnerTeamIds((current) =>
      current.includes(teamId) ? current.filter((id) => id !== teamId) : [...current, teamId],
    );
  }

  function toggleTeamWinnerProfile(profileId: string) {
    setTeamWinnerProfileIds((current) =>
      current.includes(profileId) ? current.filter((id) => id !== profileId) : [...current, profileId],
    );
  }

  function selectAllTeamWinnerTeams() {
    const assignedTeamIds = selectedVip?.team_winner_entries
      .map((entry) => entry.assigned_team_id)
      .filter((teamId): teamId is string => Boolean(teamId)) ?? [];
    setTeamWinnerTeamIds(Array.from(new Set([...assignedTeamIds, ...eligibleTeams.map((team) => team.id)])));
  }

  function clearUnassignedTeamWinnerTeams() {
    const assignedTeamIds = selectedVip?.team_winner_entries
      .map((entry) => entry.assigned_team_id)
      .filter((teamId): teamId is string => Boolean(teamId)) ?? [];
    setTeamWinnerTeamIds(Array.from(new Set(assignedTeamIds)));
  }

  function selectAllTeamWinnerUsers() {
    const assignedProfileIds = selectedVip?.team_winner_entries
      .filter((entry) => entry.assigned_team_id && entry.profile_id)
      .map((entry) => entry.profile_id as string) ?? [];
    setTeamWinnerProfileIds(
      Array.from(new Set([...assignedProfileIds, ...approvedMemberships.map((membership) => membership.profile_id)])),
    );
  }

  function clearUnassignedTeamWinnerUsers() {
    const assignedProfileIds = selectedVip?.team_winner_entries
      .filter((entry) => entry.assigned_team_id && entry.profile_id)
      .map((entry) => entry.profile_id as string) ?? [];
    setTeamWinnerProfileIds(Array.from(new Set(assignedProfileIds)));
  }

  function getTeamWinnerEntryTeamName(entry: AdminVipCompetition["team_winner_entries"][number]) {
    if (entry.assigned_team_name) {
      return entry.assigned_team_name;
    }
    if (!entry.revealed_at) {
      return null;
    }
    if (entry.assigned_team_id) {
      return teamWinnerTeams.find((team) => team.team_id === entry.assigned_team_id)?.team_name ?? null;
    }

    const revealedTeamIds = new Set(
      teamWinnerEntries
        .filter((row) => row.id !== entry.id && row.revealed_at && row.assigned_team_id)
        .map((row) => row.assigned_team_id as string),
    );
    const revealedTeamNames = new Set(
      teamWinnerEntries
        .filter((row) => row.id !== entry.id && row.revealed_at && row.assigned_team_name)
        .map((row) => row.assigned_team_name as string),
    );
    const remainingTeams = teamWinnerTeams.filter(
      (team) => !revealedTeamIds.has(team.team_id) && !revealedTeamNames.has(team.team_name),
    );
    const missingRevealedEntries = teamWinnerEntries
      .filter((row) => row.revealed_at && !row.assigned_team_id && !row.assigned_team_name)
      .sort((left, right) => (left.reveal_order ?? 0) - (right.reveal_order ?? 0));
    const missingIndex = missingRevealedEntries.findIndex((row) => row.id === entry.id);
    return remainingTeams[missingIndex]?.team_name ?? null;
  }

  async function handleSave() {
    const isUpdate = Boolean(selectedVipId);
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const accessToken = await getBrowserAccessToken();
      const path = selectedVipId ? `/admin/vip/${selectedVipId}` : "/admin/vip";
      const method = selectedVipId ? "PUT" : "POST";
      const seasonId = form.seasonId || seasons.find((season) => season.is_active)?.id || seasons[0]?.id || "";
      const savedVip = await backendFetch<AdminVipCompetition>(path, accessToken, {
        method,
        body: JSON.stringify({
          competition_kind: form.competitionKind,
          season_id: seasonId,
          name: form.name,
          entry_fee_amount: Number(form.entryFeeAmount || 0),
          admin_commission_pct: Number(form.adminCommissionPct || 0),
          first_place_pct: Number(form.firstPlacePct || 0),
          second_place_pct: Number(form.secondPlacePct || 0),
          third_place_pct: Number(form.thirdPlacePct || 0),
          matchday_ids: form.competitionKind === "matchday" ? form.matchdayIds : [],
          questions_lock_at: form.competitionKind === "question_pool" ? toApiDateTime(form.questionsLockAt) : null,
          is_active: form.isActive,
        }),
      });
      await loadPanel(savedVip.id);
      setMessage(isUpdate ? "VIP actualizada." : "VIP creada.");
    } catch (caughtError) {
      const errorMessage = getCaughtMessage(caughtError, "No se pudo guardar la VIP");
      setError(`${isUpdate ? "Guardar VIP" : "Crear VIP"}: ${errorMessage}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleCloseVip() {
    if (!selectedVip) return;
    if (!window.confirm(`Vas a cerrar "${selectedVip.name}". Se congelara el ranking y ya no aceptara cambios. Continuar?`)) return;
    setUpdatingLifecycle(true);
    setError(null);
    setMessage(null);
    try {
      const accessToken = await getBrowserAccessToken();
      await backendFetch(`/admin/vip/${selectedVip.id}/close`, accessToken, { method: "POST" });
      await loadPanel(selectedVip.id);
      setMessage("VIP cerrada. Ya puedes preparar y enviar los pagos.");
    } catch (caughtError) {
      setError(`Cerrar VIP: ${getCaughtMessage(caughtError, "No se pudo cerrar la VIP")}`);
    } finally {
      setUpdatingLifecycle(false);
    }
  }

  async function handleArchiveVip() {
    if (!selectedVip) return;
    if (!window.confirm(`Vas a archivar "${selectedVip.name}". Continuar?`)) return;
    setUpdatingLifecycle(true);
    setError(null);
    setMessage(null);
    try {
      const accessToken = await getBrowserAccessToken();
      await backendFetch(`/admin/vip/${selectedVip.id}/archive`, accessToken, { method: "POST" });
      await loadPanel(selectedVip.id);
      setMessage("VIP archivada.");
    } catch (caughtError) {
      setError(`Archivar VIP: ${getCaughtMessage(caughtError, "No se pudo archivar la VIP")}`);
    } finally {
      setUpdatingLifecycle(false);
    }
  }

  function openVipPayments() {
    if (!selectedVip) return;
    window.location.href = `/dashboard/admin/payments?scope_type=vip&scope_id=${selectedVip.id}`;
  }

  async function handleDeleteVip() {
    if (!selectedVip) {
      return;
    }
    const confirmed = window.confirm(`Vas a borrar "${selectedVip.name}" con todo su historial VIP. Esta accion no se puede deshacer. Continuar?`);
    if (!confirmed) {
      return;
    }
    setDeletingVip(true);
    setError(null);
    setMessage(null);
    try {
      const accessToken = await getBrowserAccessToken();
      await backendFetch(`/admin/vip/${selectedVip.id}`, accessToken, { method: "DELETE" });
      const nextVips = vips.filter((vip) => vip.id !== selectedVip.id);
      setVips(nextVips);
      const nextSelectedVip = nextVips[0] ?? null;
      setSelectedVipId(nextSelectedVip?.id ?? "");
      setForm(toFormState(nextSelectedVip, seasons));
      syncTeamWinnerDraft(nextSelectedVip);
      syncQuestionDraft(nextSelectedVip);
      setMessage("VIP borrada.");
    } catch (caughtError) {
      const errorMessage = getCaughtMessage(caughtError, "No se pudo borrar la VIP");
      setError(`Borrar VIP: ${errorMessage}`);
    } finally {
      setDeletingVip(false);
    }
  }

  async function handleDecision(membershipId: string, action: "approve" | "reject" | "remove") {
    if (!selectedVip) {
      return;
    }
    if (action === "remove") {
      const confirmed = window.confirm("Vas a sacar a este jugador de la VIP. Ya no contara en bolsa ni leaderboard. Continuar?");
      if (!confirmed) {
        return;
      }
    }
    setProcessingMembershipId(membershipId);
    setError(null);
    setMessage(null);
    try {
      const accessToken = await getBrowserAccessToken();
      const updatedVip = await backendFetch<AdminVipCompetition>(
        `/admin/vip/${selectedVip.id}/memberships/${membershipId}/${action}`,
        accessToken,
        {
          method: "POST",
          body: JSON.stringify({}),
        },
      );
      replaceVipAndRefreshDetail(updatedVip, accessToken);
      setMessage(
        action === "approve"
          ? "Solicitud aprobada."
          : action === "remove"
            ? "Jugador removido de la VIP."
            : "Solicitud rechazada.",
      );
    } catch (caughtError) {
      const errorMessage = getCaughtMessage(caughtError, "No se pudo actualizar la membresia VIP");
      setError(`Membresia VIP: ${errorMessage}`);
    } finally {
      setProcessingMembershipId(null);
    }
  }

  async function handleAddMember() {
    if (!selectedVip || !addMemberProfileId) {
      return;
    }
    setAddingMember(true);
    setError(null);
    setMessage(null);
    try {
      const accessToken = await getBrowserAccessToken();
      const updatedVip = await backendFetch<AdminVipCompetition>(
        `/admin/vip/${selectedVip.id}/memberships`,
        accessToken,
        {
          method: "POST",
          body: JSON.stringify({
            profile_id: addMemberProfileId,
            is_paid: false,
          }),
        },
      );
      replaceVipAndRefreshDetail(updatedVip, accessToken);
      setAddMemberProfileId("");
      setMessage("Participante agregado a la VIP con sus puntos acumulados.");
    } catch (caughtError) {
      const errorMessage = getCaughtMessage(caughtError, "No se pudo agregar participante VIP");
      setError(`Agregar participante: ${errorMessage}`);
    } finally {
      setAddingMember(false);
    }
  }

  async function saveTeamWinnerConfig(accessToken: string | undefined) {
    if (!selectedVip) {
      throw new Error("Selecciona una VIP");
    }
    return backendFetch<AdminVipCompetition>(
      `/admin/vip/${selectedVip.id}/team-winner/config`,
      accessToken,
      {
        method: "PUT",
        body: JSON.stringify({
          team_ids: teamWinnerTeamIds,
          profile_ids: teamWinnerProfileIds,
          include_house: includeHouse,
          house_label: houseLabel.trim() || "Casa",
        }),
      },
    );
  }

  async function handleSaveTeamWinnerConfig() {
    setSavingTeamWinner(true);
    setError(null);
    setMessage(null);
    try {
      const accessToken = await getBrowserAccessToken();
      const updatedVip = await saveTeamWinnerConfig(accessToken);
      replaceVipAndRefreshDetail(updatedVip, accessToken);
      syncTeamWinnerDraft(updatedVip);
      setMessage("Sorteo Equipo ganador actualizado.");
    } catch (caughtError) {
      const errorMessage = getCaughtMessage(caughtError, "No se pudo guardar Equipo ganador");
      setError(`Equipo ganador: ${errorMessage}`);
    } finally {
      setSavingTeamWinner(false);
    }
  }

  async function handleSaveAndRunTeamWinnerDraw() {
    if (!selectedVip || !canRunTeamWinnerDraw) {
      return;
    }
    setSavingTeamWinner(true);
    setError(null);
    setMessage(null);
    try {
      const accessToken = await getBrowserAccessToken();
      await saveTeamWinnerConfig(accessToken);
      const drawnVip = await backendFetch<AdminVipCompetition>(
        `/admin/vip/${selectedVip.id}/team-winner/draw`,
        accessToken,
        { method: "POST" },
      );
      replaceVipAndRefreshDetail(drawnVip, accessToken);
      syncTeamWinnerDraft(drawnVip);
      setMessage("Sorteo corrido. Ya puedes destapar participante por participante.");
    } catch (caughtError) {
      const errorMessage = getCaughtMessage(caughtError, "No se pudo correr el sorteo");
      setError(`Equipo ganador: ${errorMessage}`);
    } finally {
      setSavingTeamWinner(false);
    }
  }

  async function handleResetTeamWinnerDraw() {
    if (!selectedVip || !hasTeamWinnerDraw) {
      return;
    }
    const confirmed = window.confirm(
      "Esto borrara el orden y las asignaciones del sorteo para volverlo a correr. Continuar?",
    );
    if (!confirmed) {
      return;
    }
    setSavingTeamWinner(true);
    setError(null);
    setMessage(null);
    try {
      const accessToken = await getBrowserAccessToken();
      const updatedVip = await backendFetch<AdminVipCompetition>(
        `/admin/vip/${selectedVip.id}/team-winner/reset-draw`,
        accessToken,
        { method: "POST" },
      );
      replaceVipAndRefreshDetail(updatedVip, accessToken);
      syncTeamWinnerDraft(updatedVip);
      setMessage("Sorteo reseteado. Ya puedes volver a correrlo.");
    } catch (caughtError) {
      const errorMessage = getCaughtMessage(caughtError, "No se pudo resetear el sorteo");
      setError(`Equipo ganador: ${errorMessage}`);
    } finally {
      setSavingTeamWinner(false);
    }
  }

  async function handleTeamWinnerAction(pathSuffix: string, method = "POST", body: object | undefined = undefined) {
    if (!selectedVip) {
      return;
    }
    setSavingTeamWinner(true);
    setError(null);
    setMessage(null);
    try {
      const accessToken = await getBrowserAccessToken();
      const updatedVip = await backendFetch<AdminVipCompetition>(
        `/admin/vip/${selectedVip.id}/team-winner/${pathSuffix}`,
        accessToken,
        {
          method,
          body: body ? JSON.stringify(body) : undefined,
        },
      );
      replaceVipAndRefreshDetail(updatedVip, accessToken);
      syncTeamWinnerDraft(updatedVip);
      setMessage("Equipo ganador actualizado.");
    } catch (caughtError) {
      const errorMessage = getCaughtMessage(caughtError, "No se pudo actualizar Equipo ganador");
      setError(`Equipo ganador: ${errorMessage}`);
    } finally {
      setSavingTeamWinner(false);
    }
  }

  async function handleTeamWinnerPayment(entryId: string, isPaid: boolean) {
    await handleTeamWinnerAction(`entries/${entryId}/payment`, "PUT", { is_paid: !isPaid });
  }

  async function handleTeamWinnerTeamStatus(teamRowId: string, isEliminated: boolean, isChampion: boolean) {
    await handleTeamWinnerAction(`teams/${teamRowId}/status`, "PUT", {
      is_eliminated: isEliminated,
      is_champion: isChampion,
    });
  }

  function updateQuestionOption(index: number, value: string) {
    setQuestionForm((current) => ({
      ...current,
      options: current.options.map((option, optionIndex) => (optionIndex === index ? value : option)),
    }));
  }

  function addQuestionOption() {
    setQuestionForm((current) =>
      current.options.length >= 5 ? current : { ...current, options: [...current.options, ""] },
    );
  }

  function removeQuestionOption(index: number) {
    setQuestionForm((current) =>
      current.options.length <= 2
        ? current
        : { ...current, options: current.options.filter((_option, optionIndex) => optionIndex !== index) },
    );
  }

  async function handleCreateQuestionPoolQuestion() {
    if (!selectedVip) {
      return;
    }
    setSavingQuestion(true);
    setError(null);
    setMessage(null);
    try {
      const accessToken = await getBrowserAccessToken();
      const updatedVip = normalizeVipCompetition(await backendFetch<AdminVipCompetition>(
        `/admin/vip/${selectedVip.id}/questions`,
        accessToken,
        {
          method: "POST",
          body: JSON.stringify({
            prompt: questionForm.prompt,
            points: Number(questionForm.points || 1),
            sort_order: Number(questionForm.sortOrder || 1),
            is_active: questionForm.isActive,
            options: questionForm.options,
          }),
        },
      ));
      const nextSelectedQuestion =
        [...updatedVip.question_pool_questions].sort((left, right) => left.sort_order - right.sort_order).at(-1) ??
        null;
      replaceVipAndRefreshDetail(updatedVip, accessToken);
      syncQuestionDraft(updatedVip);
      setSelectedQuestionId(nextSelectedQuestion?.id ?? "");
      setMessage("Pregunta VIP guardada.");
    } catch (caughtError) {
      const errorMessage = getCaughtMessage(caughtError, "No se pudo guardar la pregunta VIP");
      setError(`Preguntas VIP: ${errorMessage}`);
    } finally {
      setSavingQuestion(false);
    }
  }

  function handleDownloadQuestionCsvTemplate() {
    const csv = [
      "pregunta,puntos,orden,activa,opcion_1,opcion_2,opcion_3,opcion_4,opcion_5",
      '"¿Quién ganará el partido?",10,1,si,"Equipo A","Empate","Equipo B",,',
    ].join("\n");
    const url = URL.createObjectURL(new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "plantilla-preguntas-vip.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  async function handleImportQuestionCsv(file: File | null) {
    if (!selectedVip || !file) {
      return;
    }
    setImportingQuestions(true);
    setError(null);
    setMessage(null);
    try {
      const accessToken = await getBrowserAccessToken();
      const csvText = await file.text();
      const updatedVip = normalizeVipCompetition(await backendFetch<AdminVipCompetition>(
        `/admin/vip/${selectedVip.id}/questions/import-csv`,
        accessToken,
        { method: "POST", body: JSON.stringify({ csv_text: csvText }) },
      ));
      replaceVipAndRefreshDetail(updatedVip, accessToken);
      syncQuestionDraft(updatedVip);
      setSelectedQuestionId(updatedVip.question_pool_questions[0]?.id ?? "");
      setMessage(`${updatedVip.question_pool_questions.length - selectedVip.question_pool_questions.length} preguntas importadas.`);
    } catch (caughtError) {
      const errorMessage = getCaughtMessage(caughtError, "No se pudo importar el CSV");
      setError(`Preguntas VIP: ${errorMessage}`);
    } finally {
      setImportingQuestions(false);
    }
  }

  async function handleDeleteQuestionPoolQuestion(questionId: string) {
    if (!selectedVip) {
      return;
    }
    const confirmed = window.confirm("Vas a borrar esta pregunta VIP y sus respuestas. Continuar?");
    if (!confirmed) {
      return;
    }
    setDeletingQuestionId(questionId);
    setError(null);
    setMessage(null);
    try {
      const accessToken = await getBrowserAccessToken();
      const updatedVip = await backendFetch<AdminVipCompetition>(
        `/admin/vip/${selectedVip.id}/questions/${questionId}`,
        accessToken,
        { method: "DELETE" },
      );
      replaceVipAndRefreshDetail(updatedVip, accessToken);
      syncQuestionDraft(updatedVip);
      setMessage("Pregunta VIP eliminada.");
    } catch (caughtError) {
      const errorMessage = getCaughtMessage(caughtError, "No se pudo borrar la pregunta VIP");
      setError(`Preguntas VIP: ${errorMessage}`);
    } finally {
      setDeletingQuestionId(null);
    }
  }

  function handleSelectQuestionPoolCorrectOption(questionId: string, optionId: string | null) {
    setQuestionCorrectOptionDrafts((current) => ({ ...current, [questionId]: optionId }));
  }

  async function handleSaveQuestionPoolCorrectOptions() {
    if (!selectedVip) {
      return;
    }
    const changedQuestions = questionPoolQuestions
      .map((question) => ({
        question_id: question.id,
        option_id: draftQuestionCorrectOptions[question.id] ?? null,
      }))
      .filter((row) => row.option_id !== savedQuestionCorrectOptions[row.question_id]);
    if (changedQuestions.length === 0) {
      setMessage("No hay cambios de respuestas correctas por guardar.");
      return;
    }
    setSavingQuestionAnswers(true);
    setError(null);
    setMessage(null);
    try {
      const accessToken = await getBrowserAccessToken();
      const updatedVip = normalizeVipCompetition(await backendFetch<AdminVipCompetition>(
        `/admin/vip/${selectedVip.id}/questions/correct-options`,
        accessToken,
        {
          method: "PUT",
          body: JSON.stringify({ questions: changedQuestions }),
        },
      ));
      replaceVipAndRefreshDetail(updatedVip, accessToken);
      syncQuestionDraft(updatedVip);
      setMessage(
        changedQuestions.length === 1
          ? "Respuesta correcta guardada."
          : `${changedQuestions.length} respuestas correctas guardadas.`,
      );
    } catch (caughtError) {
      const errorMessage = getCaughtMessage(caughtError, "No se pudieron guardar las respuestas correctas");
      setError(`Preguntas VIP: ${errorMessage}`);
    } finally {
      setSavingQuestionAnswers(false);
    }
  }

  async function requestVipPaymentUpdate(accessToken: string | undefined, membershipId: string, isPaid: boolean) {
    if (!selectedVip) {
      throw new Error("Selecciona una VIP");
    }

    const path = `/admin/vip/${selectedVip.id}/memberships/${membershipId}/payment`;
    const body = JSON.stringify({ is_paid: !isPaid });

    try {
      return await backendFetch<AdminVipCompetition>(path, accessToken, {
        method: "PUT",
        body,
      });
    } catch (caughtError) {
      const errorMessage = getCaughtMessage(caughtError, "No se pudo actualizar el pago VIP");
      if (errorMessage !== "Not Found") {
        throw caughtError;
      }
      return backendFetch<AdminVipCompetition>(path, accessToken, {
        method: "POST",
        body,
      });
    }
  }

  async function handleToggleVipPayment(membershipId: string, isPaid: boolean) {
    if (!selectedVip) {
      return;
    }
    setProcessingMembershipId(membershipId);
    setError(null);
    setMessage(null);
    try {
      const accessToken = await getBrowserAccessToken();
      const updatedVip = await requestVipPaymentUpdate(accessToken, membershipId, isPaid);
      replaceVipAndRefreshDetail(updatedVip, accessToken);
      setMessage(!isPaid ? "Pago VIP confirmado." : "Pago VIP marcado pendiente.");
    } catch (caughtError) {
      const errorMessage = getCaughtMessage(caughtError, "No se pudo actualizar el pago VIP");
      setError(
        errorMessage === "Not Found"
          ? "Pago VIP: el backend desplegado aun no trae la ruta de pago. Revisa/reinicia el deploy del backend."
          : `Pago VIP: ${errorMessage}`,
      );
    } finally {
      setProcessingMembershipId(null);
    }
  }

  async function handleRecalculateVip() {
    if (!selectedVip) {
      return;
    }
    setRecalculatingVip(true);
    setError(null);
    setMessage(null);
    try {
      const accessToken = await getBrowserAccessToken();
      await backendFetch(`/admin/vip/${selectedVip.id}/recalculate`, accessToken, { method: "POST" });
      window.setTimeout(() => {
        void loadVipDetail(selectedVip.id, accessToken).catch((caughtError) => {
          setError(caughtError instanceof Error ? caughtError.message : "No se pudo refrescar el leaderboard VIP");
        });
      }, 1200);
      setMessage("Recalculo VIP iniciado.");
    } catch (caughtError) {
      const errorMessage = getCaughtMessage(caughtError, "No se pudo recalcular la VIP");
      setError(`Recalcular VIP: ${errorMessage}`);
    } finally {
      setRecalculatingVip(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-ink/60">Cargando panel VIP...</p>;
  }

  return (
    <div className="space-y-6">
      {message ? <p className="text-sm text-mint">{message}</p> : null}
      {error ? <p className="text-sm text-coral">{error}</p> : null}

      <div className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-steel">VIPs</p>
            <button type="button" onClick={resetForNewVip} className="app-pill px-3">
              Nueva
            </button>
          </div>

          {vips.map((vip) => (
            <button
              key={vip.id}
              type="button"
              onClick={() => selectVip(vip)}
              className={`w-full rounded-[12px] border px-4 py-4 text-left transition ${
                selectedVipId === vip.id
                  ? "border-white/[0.14] bg-white/[0.05]"
                  : "border-white/[0.06] bg-white/[0.02] hover:border-white/[0.1]"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-base font-semibold text-ink">{vip.name}</p>
                  <p className="mt-1 text-sm text-steel">{vip.season_name}</p>
                </div>
                <span className={`text-xs font-semibold uppercase tracking-[0.18em] ${vip.lifecycle_status === "active" ? "text-mint" : "text-steel"}`}>
                  {lifecycleLabel(vip.lifecycle_status)}
                </span>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-3 text-xs text-steel">
                <div>
                  <p className="uppercase tracking-[0.18em]">Entrada</p>
                  <p className="mt-1 text-sm font-semibold text-ink">{formatCurrency(vip.entry_fee_amount)}</p>
                </div>
                <div>
                  <p className="uppercase tracking-[0.18em]">
                    {vip.competition_kind === "team_winner"
                      ? "Equipos"
                      : vip.competition_kind === "question_pool"
                        ? "Preguntas"
                        : "Jornadas"}
                  </p>
                  <p className="mt-1 text-sm font-semibold text-ink">
                    {vip.competition_kind === "team_winner"
                      ? vip.team_winner_teams.length
                      : vip.competition_kind === "question_pool"
                        ? vip.question_pool_questions.length
                        : vip.matchdays.length}
                  </p>
                </div>
                <div>
                  <p className="uppercase tracking-[0.18em]">
                    {vip.competition_kind === "team_winner"
                      ? "Sorteo"
                      : vip.competition_kind === "question_pool"
                        ? "Respuestas"
                        : "Pendientes"}
                  </p>
                  <p className="mt-1 text-sm font-semibold text-ink">
                    {vip.competition_kind === "team_winner"
                      ? `${vip.team_winner_entries.filter((entry) => entry.revealed_at).length}/${vip.team_winner_entries.length}`
                      : vip.competition_kind === "question_pool"
                        ? vip.question_pool_questions.reduce((sum, question) => sum + question.responses_count, 0)
                        : vip.pending_requests_count}
                  </p>
                </div>
              </div>
              {!vip.is_active ? (
                <p className="mt-3 text-xs text-steel">Oculta para usuarios</p>
              ) : null}
            </button>
          ))}

          {vips.length === 0 ? (
            <div className="rounded-[12px] border border-white/[0.06] bg-white/[0.02] px-4 py-5 text-sm text-steel">
              Todavia no hay VIPs creadas.
            </div>
          ) : null}
        </div>

        <div className="space-y-6 rounded-[12px] border border-white/[0.06] bg-white/[0.02] p-5">
          <section className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm uppercase tracking-[0.22em] text-steel">Configuracion VIP</p>
                <h2 className="mt-2 text-xl font-semibold text-ink">
                  {selectedVip ? `Editar ${selectedVip.name}` : "Nueva VIP"}
                </h2>
              </div>
              <div className="flex gap-2">
                {selectedVip?.lifecycle_status === "active" ? (
                  <button
                    type="button"
                    onClick={() => void handleCloseVip()}
                    disabled={updatingLifecycle}
                    className="app-pill px-4 text-coral disabled:opacity-50"
                  >
                    {updatingLifecycle ? "Cerrando" : "Cerrar VIP"}
                  </button>
                ) : null}
                {selectedVip?.lifecycle_status === "closed_pending_payments" ? (
                  <button type="button" onClick={openVipPayments} className="app-pill px-4 text-mint">
                    Preparar pagos
                  </button>
                ) : null}
                {selectedVip?.lifecycle_status === "settled" ? (
                  <button
                    type="button"
                    onClick={() => void handleArchiveVip()}
                    disabled={updatingLifecycle}
                    className="app-pill px-4 text-steel disabled:opacity-50"
                  >
                    {updatingLifecycle ? "Archivando" : "Archivar"}
                  </button>
                ) : null}
                {selectedVip ? (
                  <button
                    type="button"
                    onClick={() => void handleDeleteVip()}
                    disabled={deletingVip}
                    className="app-pill px-4 text-coral disabled:opacity-50"
                  >
                    {deletingVip ? "Borrando" : "Borrar"}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving || Boolean(selectedVip && selectedVip.lifecycle_status !== "active")}
                  className="app-pill px-4 disabled:opacity-50"
                >
                  {saving ? "Guardando" : selectedVip ? "Guardar cambios" : "Crear VIP"}
                </button>
              </div>
            </div>

            <div className="grid gap-x-4 gap-y-3 lg:grid-cols-4">
              <label className="grid gap-1">
                <span className={flatLabelClass}>Tipo</span>
                <select
                  value={form.competitionKind}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      competitionKind: event.target.value as VipCompetitionKind,
                      matchdayIds: event.target.value === "matchday" ? current.matchdayIds : [],
                    }))
                  }
                  className={flatFieldClass}
                >
                  <option value="matchday">VIP por jornadas</option>
                  <option value="team_winner">Equipo ganador</option>
                  <option value="question_pool">Preguntas / trivia</option>
                </select>
              </label>
              <label className="grid gap-1 lg:col-span-2">
                <span className={flatLabelClass}>Nombre</span>
                <input
                  value={form.name}
                  onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                  className={flatFieldClass}
                  placeholder="VIP Clausura"
                />
              </label>
              <label className="grid gap-1">
                <span className={flatLabelClass}>Temporada</span>
                <select
                  value={form.seasonId}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      seasonId: event.target.value,
                      matchdayIds: current.matchdayIds.filter((matchdayId) =>
                        matchdays.some(
                          (matchday) => matchday.id === matchdayId && matchday.season_id === event.target.value,
                        ),
                      ),
                    }))
                  }
                  className={flatFieldClass}
                >
                  {seasons.map((season) => (
                    <option key={season.id} value={season.id}>
                      {season.name}
                    </option>
                  ))}
                </select>
              </label>
              {isQuestionPoolMode ? (
                <label className="grid gap-1 lg:col-span-2">
                  <span className={flatLabelClass}>Bloqueo respuestas</span>
                  <input
                    type="datetime-local"
                    value={form.questionsLockAt}
                    onChange={(event) => setForm((current) => ({ ...current, questionsLockAt: event.target.value }))}
                    className={flatFieldClass}
                  />
                </label>
              ) : null}
              <label className="grid gap-1">
                <span className={flatLabelClass}>Costo entrada</span>
                <input
                  value={form.entryFeeAmount}
                  onChange={(event) => setForm((current) => ({ ...current, entryFeeAmount: event.target.value.replace(/[^\d.]/g, "") }))}
                  className={flatFieldClass}
                  placeholder="500"
                />
              </label>
              <div className="grid gap-1">
                <span className={flatLabelClass}>Visibilidad</span>
                <button
                  type="button"
                  aria-pressed={form.isActive}
                  onClick={() => setForm((current) => ({ ...current, isActive: !current.isActive }))}
                  className={`h-9 rounded-[6px] border px-3 text-left text-sm font-semibold transition ${
                    form.isActive
                      ? "border-mint/30 bg-mint/10 text-mint hover:border-mint/50"
                      : "border-coral/30 bg-coral/10 text-coral hover:border-coral/50"
                  }`}
                >
                  {form.isActive ? "Visible" : "Oculta"}
                </button>
              </div>
              <label className="grid gap-1">
                <span className={flatLabelClass}>% comision admin</span>
                <input
                  value={form.adminCommissionPct}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, adminCommissionPct: event.target.value.replace(/[^\d.]/g, "") }))
                  }
                  className={flatFieldClass}
                  placeholder="10"
                />
              </label>
              <label className="grid gap-1">
                <span className={flatLabelClass}>% 1er lugar</span>
                <input
                  value={form.firstPlacePct}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, firstPlacePct: event.target.value.replace(/[^\d.]/g, "") }))
                  }
                  className={flatFieldClass}
                  placeholder="50"
                />
              </label>
              <label className="grid gap-1">
                <span className={flatLabelClass}>% 2do lugar</span>
                <input
                  value={form.secondPlacePct}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, secondPlacePct: event.target.value.replace(/[^\d.]/g, "") }))
                  }
                  className={flatFieldClass}
                  placeholder="30"
                />
              </label>
              <label className="grid gap-1">
                <span className={flatLabelClass}>% 3er lugar</span>
                <input
                  value={form.thirdPlacePct}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, thirdPlacePct: event.target.value.replace(/[^\d.]/g, "") }))
                  }
                  className={flatFieldClass}
                  placeholder="20"
                />
              </label>
            </div>

            <div className="grid overflow-hidden rounded-[6px] border border-white/[0.08] sm:grid-cols-2 xl:grid-cols-4">
              <div className="border-b border-white/[0.06] px-4 py-3 xl:border-b-0 xl:border-r">
                <p className={flatLabelClass}>Bolsa total</p>
                <p className="mt-1 text-base font-semibold text-ink">
                  {formatCurrency(selectedVip?.gross_pool_amount ?? 0)}
                </p>
              </div>
              <div className="border-b border-white/[0.06] px-4 py-3 sm:border-l xl:border-b-0 xl:border-r xl:border-l-0">
                <p className={flatLabelClass}>Comision</p>
                <p className="mt-1 text-base font-semibold text-ink">
                  {formatCurrency(selectedVip?.admin_commission_amount ?? 0)}
                </p>
              </div>
              <div className="border-b border-white/[0.06] px-4 py-3 sm:border-b-0 xl:border-r">
                <p className={flatLabelClass}>Bolsa premios</p>
                <p className="mt-1 text-base font-semibold text-ink">
                  {formatCurrency(selectedVip?.distributable_prize_pool_amount ?? 0)}
                </p>
              </div>
              <div className="px-4 py-3 sm:border-l xl:border-l-0">
                <p className={flatLabelClass}>% reparto</p>
                <p className={`mt-1 text-base font-semibold ${payoutPct > 100 ? "text-coral" : "text-ink"}`}>
                  {payoutPct.toFixed(2)}%
                </p>
              </div>
            </div>

            {form.competitionKind === "matchday" ? (
            <div className="space-y-3">
              <p className="text-xs uppercase tracking-[0.18em] text-steel">Jornadas que cuentan</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {seasonMatchdays.map((matchday) => (
                  <label
                    key={matchday.id}
                    className="flex items-center gap-3 rounded-[12px] border border-white/[0.06] px-4 py-3 text-sm text-ink"
                  >
                    <input
                      type="checkbox"
                      checked={form.matchdayIds.includes(matchday.id)}
                      onChange={() => toggleMatchday(matchday.id)}
                    />
                    <span>
                      Jornada {matchday.number} • {matchday.name}
                    </span>
                  </label>
                ))}
              </div>
            </div>
            ) : null}
          </section>

          {isQuestionPoolMode ? (
            <section className="space-y-5">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="text-sm uppercase tracking-[0.22em] text-steel">Preguntas VIP</p>
                  <h3 className="mt-2 text-lg font-semibold text-ink">Configurar trivia</h3>
                </div>
                <div className="text-sm text-steel">
                  {form.questionsLockAt
                    ? `Cierra respuestas: ${formatLocalDateTimeLabel(form.questionsLockAt)}`
                    : "Define arriba el bloqueo global"}
                </div>
              </div>

              {!selectedVip ? (
                <p className="text-sm text-steel">
                  Primero crea la VIP y luego agrega las preguntas con sus opciones.
                </p>
              ) : (
                <>
                  <div className="flex flex-col gap-3 rounded-[10px] border border-white/[0.06] p-4 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-ink">Importar preguntas desde CSV</p>
                      <p className="mt-1 text-xs text-steel">
                        De 2 a 5 opciones por fila. La respuesta correcta se marca después del partido.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={handleDownloadQuestionCsvTemplate}
                        className="app-pill h-9 px-4 text-sm"
                      >
                        Descargar plantilla
                      </button>
                      <label className={`app-pill flex h-9 cursor-pointer items-center px-4 text-sm ${importingQuestions ? "pointer-events-none opacity-50" : ""}`}>
                        {importingQuestions ? "Importando..." : "Subir CSV"}
                        <input
                          type="file"
                          accept=".csv,text/csv"
                          className="sr-only"
                          disabled={importingQuestions}
                          onChange={(event) => {
                            const file = event.target.files?.[0] ?? null;
                            event.target.value = "";
                            void handleImportQuestionCsv(file);
                          }}
                        />
                      </label>
                    </div>
                  </div>

                  <div className="grid gap-4 rounded-[10px] border border-white/[0.06] p-4 xl:grid-cols-[minmax(0,1.5fr)_160px_120px]">
                    <label className="grid gap-1 xl:col-span-3">
                      <span className={flatLabelClass}>Pregunta</span>
                      <textarea
                        value={questionForm.prompt}
                        onChange={(event) => setQuestionForm((current) => ({ ...current, prompt: event.target.value }))}
                        className="field-control min-h-[92px] rounded-[8px] border-white/[0.08] bg-transparent px-3 py-3 text-sm"
                        placeholder="Ej. Quien levantara el trofeo en la final?"
                      />
                    </label>
                    <label className="grid gap-1">
                      <span className={flatLabelClass}>Puntos</span>
                      <input
                        value={questionForm.points}
                        onChange={(event) =>
                          setQuestionForm((current) => ({ ...current, points: event.target.value.replace(/[^\d]/g, "") }))
                        }
                        className={flatFieldClass}
                      />
                    </label>
                    <label className="grid gap-1">
                      <span className={flatLabelClass}>Orden</span>
                      <input
                        value={questionForm.sortOrder}
                        onChange={(event) =>
                          setQuestionForm((current) => ({ ...current, sortOrder: event.target.value.replace(/[^\d]/g, "") }))
                        }
                        className={flatFieldClass}
                      />
                    </label>
                    <label className="grid gap-1">
                      <span className={flatLabelClass}>Activa</span>
                      <button
                        type="button"
                        onClick={() => setQuestionForm((current) => ({ ...current, isActive: !current.isActive }))}
                        className={`h-9 rounded-[6px] border px-3 text-left text-sm font-semibold ${
                          questionForm.isActive
                            ? "border-mint/30 bg-mint/10 text-mint"
                            : "border-coral/30 bg-coral/10 text-coral"
                        }`}
                      >
                        {questionForm.isActive ? "Si" : "No"}
                      </button>
                    </label>
                    <div className="xl:col-span-3 space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-xs uppercase tracking-[0.18em] text-steel">Opciones</p>
                        <button
                          type="button"
                          onClick={addQuestionOption}
                          disabled={questionForm.options.length >= 5}
                          className="text-xs font-semibold text-mint disabled:opacity-50"
                        >
                          Agregar opcion
                        </button>
                      </div>
                      <div className="grid gap-2">
                        {questionForm.options.map((option, index) => (
                          <div key={`question-option-${index}`} className="flex items-center gap-2">
                            <input
                              value={option}
                              onChange={(event) => updateQuestionOption(index, event.target.value)}
                              className={`${flatFieldClass} flex-1`}
                              placeholder={`Opcion ${index + 1}`}
                            />
                            <button
                              type="button"
                              onClick={() => removeQuestionOption(index)}
                              disabled={questionForm.options.length <= 2}
                              className="app-pill h-9 px-3 text-coral disabled:opacity-50"
                            >
                              Quitar
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="xl:col-span-3 flex justify-end">
                      <button
                        type="button"
                        onClick={() => void handleCreateQuestionPoolQuestion()}
                        disabled={savingQuestion}
                        className="app-pill px-4 disabled:opacity-50"
                      >
                        {savingQuestion ? "Guardando..." : "Guardar pregunta"}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      <div className="rounded-[10px] border border-white/[0.06] px-4 py-3">
                        <p className={flatLabelClass}>Preguntas</p>
                        <p className="mt-1 text-lg font-semibold text-ink">{questionPoolQuestions.length}</p>
                      </div>
                      <div className="rounded-[10px] border border-white/[0.06] px-4 py-3">
                        <p className={flatLabelClass}>Puntos totales</p>
                        <p className="mt-1 text-lg font-semibold text-ink">{questionPoolTotalPoints}</p>
                      </div>
                      <div className="rounded-[10px] border border-white/[0.06] px-4 py-3">
                        <p className={flatLabelClass}>Con correcta</p>
                        <p className="mt-1 text-lg font-semibold text-mint">{questionPoolResolvedCount}</p>
                      </div>
                      <div className="rounded-[10px] border border-white/[0.06] px-4 py-3">
                        <p className={flatLabelClass}>Pendientes</p>
                        <p className="mt-1 text-lg font-semibold text-gold">
                          {Math.max(questionPoolQuestions.length - questionPoolResolvedCount, 0)}
                        </p>
                      </div>
                    </div>
                    {questionPoolQuestions.length > 0 ? (
                      <div className="space-y-4">
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                          <div>
                            <p className="text-xs uppercase tracking-[0.18em] text-steel">Calificacion por lote</p>
                            <p className="mt-1 text-sm text-steel">
                              Selecciona respuestas en varias preguntas y guarda todo junto.
                            </p>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs text-steel">
                              {questionPoolPendingSaveCount > 0
                                ? `${questionPoolPendingSaveCount} cambios pendientes`
                                : "Sin cambios pendientes"}
                            </span>
                            <button
                              type="button"
                              onClick={() => void handleSaveQuestionPoolCorrectOptions()}
                              disabled={savingQuestionAnswers || questionPoolPendingSaveCount === 0}
                              className="app-pill px-4 disabled:opacity-50"
                            >
                              {savingQuestionAnswers ? "Guardando..." : "Guardar correctas"}
                            </button>
                          </div>
                        </div>

                        <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
                          <div className="rounded-[10px] border border-white/[0.06] p-3">
                            <div className="flex items-center justify-between gap-3">
                              <p className="text-xs uppercase tracking-[0.18em] text-steel">Preguntas</p>
                              <p className="text-xs text-steel">
                                {questionPoolResolvedCount}/{questionPoolQuestions.length}
                              </p>
                            </div>
                            <div className="mt-3 max-h-[560px] space-y-2 overflow-y-auto pr-1">
                              {questionPoolQuestions.map((question) => {
                                const draftOptionId = draftQuestionCorrectOptions[question.id] ?? null;
                                const savedOptionId = savedQuestionCorrectOptions[question.id] ?? null;
                                const isResolved = Boolean(draftOptionId);
                                const hasPendingChange = draftOptionId !== savedOptionId;
                                const isActive = selectedQuestion?.id === question.id;
                                return (
                                  <button
                                    key={question.id}
                                    type="button"
                                    onClick={() => setSelectedQuestionId(question.id)}
                                    className={`w-full rounded-[10px] border px-3 py-3 text-left transition ${
                                      isActive
                                        ? "border-white/[0.18] bg-white/[0.08] text-ink"
                                        : hasPendingChange
                                          ? "border-gold/30 bg-gold/10 text-gold"
                                          : isResolved
                                            ? "border-mint/25 bg-mint/10 text-mint"
                                            : "border-white/[0.06] bg-white/[0.02] text-steel hover:border-white/[0.12]"
                                    }`}
                                  >
                                    <div className="flex items-start justify-between gap-3">
                                      <div className="min-w-0">
                                        <p className="text-xs font-semibold uppercase tracking-[0.14em]">
                                          P{question.sort_order} · {question.points} pts
                                        </p>
                                        <p className="mt-1 truncate text-sm">
                                          {shortenQuestionLabel(question.prompt)}
                                        </p>
                                      </div>
                                      <span className="text-[10px] uppercase tracking-[0.14em]">
                                        {hasPendingChange ? "Draft" : isResolved ? "OK" : "Pend"}
                                      </span>
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          </div>

                          {selectedQuestion ? (
                            <div className="rounded-[10px] border border-white/[0.06] p-4">
                              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                <div>
                                  <p className="text-xs uppercase tracking-[0.18em] text-steel">
                                    Orden {selectedQuestion.sort_order} · {selectedQuestion.points} pts · {selectedQuestion.responses_count} respuestas
                                  </p>
                                  <h4 className="mt-2 text-base font-semibold text-ink">{selectedQuestion.prompt}</h4>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                  <button
                                    type="button"
                                    onClick={() => handleSelectQuestionPoolCorrectOption(selectedQuestion.id, null)}
                                    className="app-pill px-4 text-steel"
                                  >
                                    Limpiar
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void handleDeleteQuestionPoolQuestion(selectedQuestion.id)}
                                    disabled={deletingQuestionId === selectedQuestion.id}
                                    className="app-pill px-4 text-coral disabled:opacity-50"
                                  >
                                    {deletingQuestionId === selectedQuestion.id ? "Borrando..." : "Borrar"}
                                  </button>
                                </div>
                              </div>
                              <div className="mt-2 text-sm text-steel">
                                Marca localmente la opcion correcta. Se guarda hasta que des click en `Guardar correctas`.
                              </div>
                              <div className="mt-4 grid gap-2">
                                {selectedQuestion.options.map((option) => {
                                  const isDraftCorrect = draftQuestionCorrectOptions[selectedQuestion.id] === option.id;
                                  const wasSavedCorrect = savedQuestionCorrectOptions[selectedQuestion.id] === option.id;
                                  return (
                                    <button
                                      key={option.id}
                                      type="button"
                                      onClick={() =>
                                        handleSelectQuestionPoolCorrectOption(
                                          selectedQuestion.id,
                                          isDraftCorrect ? null : option.id,
                                        )
                                      }
                                      className={`rounded-[8px] border px-3 py-3 text-left text-sm transition ${
                                        isDraftCorrect
                                          ? "border-mint/30 bg-mint/10 text-mint"
                                          : "border-white/[0.06] text-ink hover:border-white/[0.16]"
                                      }`}
                                    >
                                      <div className="flex items-center justify-between gap-3">
                                        <span>{option.option_text}</span>
                                        <span className="text-xs font-semibold uppercase tracking-[0.14em]">
                                          {isDraftCorrect
                                            ? questionPoolPendingSaveCount > 0 && !wasSavedCorrect
                                              ? "Draft"
                                              : "Correcta"
                                            : wasSavedCorrect
                                              ? "Guardada"
                                              : "Marcar"}
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
                    ) : (
                      <p className="rounded-[8px] border border-white/[0.06] px-4 py-4 text-sm text-steel">
                        Todavia no hay preguntas cargadas en esta VIP.
                      </p>
                    )}
                  </div>
                </>
              )}
            </section>
          ) : null}

          {isTeamWinnerMode ? (
            <section className="space-y-5">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="text-sm uppercase tracking-[0.22em] text-steel">Equipo ganador</p>
                  <h3 className="mt-2 text-lg font-semibold text-ink">
                    {hasTeamWinnerDraw ? "Sorteo en vivo" : "Preparar sorteo"}
                  </h3>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void handleSaveTeamWinnerConfig()}
                    disabled={!selectedVip || savingTeamWinner || hasTeamWinnerDraw}
                    className="app-pill h-9 px-4 text-sm disabled:opacity-50"
                  >
                    {savingTeamWinner ? "Guardando" : "Guardar sorteo"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSaveAndRunTeamWinnerDraw()}
                    disabled={savingTeamWinner || !canRunTeamWinnerDraw}
                    className="app-pill h-9 px-4 text-sm text-mint disabled:opacity-50"
                  >
                    Guardar y sortear
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleResetTeamWinnerDraw()}
                    disabled={!selectedVip || savingTeamWinner || !hasTeamWinnerDraw}
                    className="app-pill h-9 px-4 text-sm text-coral disabled:opacity-50"
                  >
                    Resetear sorteo
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleTeamWinnerAction("reveal-next")}
                    disabled={
                      savingTeamWinner ||
                      !teamWinnerEntries.some((entry) => entry.reveal_order && !entry.revealed_at)
                    }
                    className="app-pill h-9 px-4 text-sm disabled:opacity-50"
                  >
                    {nextTeamWinnerEntry ? `Destapar ${nextTeamWinnerEntry.display_name}` : "Destapar siguiente"}
                  </button>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-[8px] border border-white/[0.06] px-4 py-3">
                  <p className={flatLabelClass}>Participantes</p>
                  <p className="mt-1 text-lg font-semibold text-ink">{teamWinnerParticipantCount}</p>
                </div>
                <div className="rounded-[8px] border border-white/[0.06] px-4 py-3">
                  <p className={flatLabelClass}>Equipos</p>
                  <p className={`mt-1 text-lg font-semibold ${teamWinnerTeamIds.length < teamWinnerParticipantCount ? "text-coral" : "text-ink"}`}>
                    {teamWinnerTeamIds.length}
                  </p>
                </div>
                <div className="rounded-[8px] border border-white/[0.06] px-4 py-3">
                  <p className={flatLabelClass}>Revelados</p>
                  <p className="mt-1 text-lg font-semibold text-ink">
                    {revealedTeamWinnerCount}/{teamWinnerEntries.length}
                  </p>
                </div>
                <div className="rounded-[8px] border border-white/[0.06] px-4 py-3">
                  <p className={flatLabelClass}>Siguiente</p>
                  <p className="mt-1 truncate text-sm font-semibold text-ink">
                    {nextTeamWinnerEntry?.display_name ?? (hasTeamWinnerDraw ? "Completo" : "Sin sortear")}
                  </p>
                </div>
              </div>

              {!hasTeamWinnerDraw && teamWinnerTeamIds.length < teamWinnerParticipantCount ? (
                <p className="text-sm text-coral">
                  Faltan equipos: necesitas al menos un equipo por participante antes de sortear.
                </p>
              ) : null}
              {!selectedVip ? (
                <p className="text-sm text-steel">
                  Primero crea la VIP para recibir solicitudes, aprobar participantes y preparar el sorteo.
                </p>
              ) : null}
              {selectedVip && approvedMemberships.length === 0 ? (
                <p className="text-sm text-steel">
                  Aprueba solicitudes o agrega participantes manualmente antes de configurar el sorteo.
                </p>
              ) : null}

              <div className="grid gap-4 xl:grid-cols-2">
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs uppercase tracking-[0.18em] text-steel">
                      Equipos sorteables · {teamWinnerTeamIds.length}
                    </p>
                    {!hasTeamWinnerDraw ? (
                      <div className="flex gap-3 text-xs font-semibold">
                        <button type="button" onClick={selectAllTeamWinnerTeams} className="text-mint">
                          Todos
                        </button>
                        <button type="button" onClick={clearUnassignedTeamWinnerTeams} className="text-coral">
                          Limpiar
                        </button>
                      </div>
                    ) : null}
                  </div>
                  <div className="grid max-h-[360px] gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
                    {eligibleTeams.map((team) => {
                      const assigned = teamWinnerEntries.some((entry) => entry.assigned_team_id === team.id);
                      return (
                        <label
                          key={team.id}
                          className={`flex items-center gap-3 rounded-[8px] border px-3 py-2 text-sm ${
                            assigned ? "border-mint/25 bg-mint/10" : "border-white/[0.06]"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={teamWinnerTeamIds.includes(team.id)}
                            disabled={assigned || hasTeamWinnerDraw}
                            onChange={() => toggleTeamWinnerTeam(team.id)}
                          />
                          <span className="truncate">{team.name}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs uppercase tracking-[0.18em] text-steel">
                      Participantes · {teamWinnerParticipantCount}
                    </p>
                    {!hasTeamWinnerDraw ? (
                      <div className="flex gap-3 text-xs font-semibold">
                        <button type="button" onClick={selectAllTeamWinnerUsers} className="text-mint">
                          Todos
                        </button>
                        <button type="button" onClick={clearUnassignedTeamWinnerUsers} className="text-coral">
                          Limpiar
                        </button>
                      </div>
                    ) : null}
                  </div>
                  <label className="flex items-center gap-3 rounded-[8px] border border-white/[0.06] px-3 py-2 text-sm">
                    <input
                      type="checkbox"
                      checked={includeHouse}
                      disabled={hasTeamWinnerDraw}
                      onChange={(event) => setIncludeHouse(event.target.checked)}
                    />
                    <span>Agregar casa</span>
                    <input
                      value={houseLabel}
                      onChange={(event) => setHouseLabel(event.target.value)}
                      className={`${flatFieldClass} ml-auto max-w-[160px]`}
                      disabled={!includeHouse || hasTeamWinnerDraw}
                    />
                  </label>
                  <div className="grid max-h-[312px] gap-2 overflow-y-auto pr-1">
                    {approvedMemberships.map((membership) => {
                      const assigned = teamWinnerEntries.some(
                        (entry) => entry.profile_id === membership.profile_id && entry.assigned_team_id,
                      );
                      return (
                        <label
                          key={membership.id}
                          className={`flex items-center gap-3 rounded-[8px] border px-3 py-2 text-sm ${
                            assigned ? "border-mint/25 bg-mint/10" : "border-white/[0.06]"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={teamWinnerProfileIds.includes(membership.profile_id)}
                            disabled={assigned || hasTeamWinnerDraw}
                            onChange={() => toggleTeamWinnerProfile(membership.profile_id)}
                          />
                          <span className="truncate">{membership.display_name}</span>
                        </label>
                      );
                    })}
                    {approvedMemberships.length === 0 ? (
                      <p className="rounded-[8px] border border-white/[0.06] px-3 py-3 text-sm text-steel">
                        No hay miembros aprobados todavia.
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto rounded-[8px] border border-white/[0.06]">
                <div className="grid min-w-[680px] grid-cols-[64px_minmax(0,1fr)_minmax(0,1fr)_110px_160px] gap-3 border-b border-white/[0.06] px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-steel">
                  <span>#</span>
                  <span>Participante</span>
                  <span>Equipo</span>
                  <span>Pago</span>
                  <span className="text-right">Acciones</span>
                </div>
                {teamWinnerEntries.map((entry) => {
                  const teamName = getTeamWinnerEntryTeamName(entry);
                  return (
                    <div
                      key={entry.id}
                      className={`grid min-w-[680px] grid-cols-[64px_minmax(0,1fr)_minmax(0,1fr)_110px_160px] items-center gap-3 border-b border-white/[0.04] px-4 py-3 text-sm last:border-b-0 ${
                        entry.assigned_team_champion
                          ? "bg-mint/10"
                          : entry.assigned_team_eliminated
                            ? "opacity-55"
                            : ""
                      }`}
                    >
                      <span className="text-steel">{entry.reveal_order ?? "-"}</span>
                      <span className="truncate font-semibold text-ink">
                        {entry.display_name}{entry.is_house ? " · Casa" : ""}
                      </span>
                      <span className="truncate">
                        {teamName ?? (entry.reveal_order ? "Oculto" : "Sin sortear")}
                      </span>
                      <span className={entry.is_paid ? "font-semibold text-mint" : "font-semibold text-amber-100"}>
                        {getPaymentLabel(entry.is_paid)}
                      </span>
                      <button
                        type="button"
                        onClick={() => void handleTeamWinnerPayment(entry.id, entry.is_paid)}
                        disabled={savingTeamWinner}
                        className="justify-self-end text-sm font-semibold text-mint disabled:opacity-50"
                      >
                        {entry.is_paid ? "Pago pend." : "Marcar pag."}
                      </button>
                    </div>
                  );
                })}
                {teamWinnerEntries.length === 0 ? (
                  <p className="px-4 py-4 text-sm text-steel">
                    Selecciona participantes y crea la VIP para preparar el sorteo.
                  </p>
                ) : null}
              </div>

              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {teamWinnerTeams.map((team) => (
                  <div
                    key={team.id}
                    className={`rounded-[8px] border border-white/[0.06] px-4 py-3 ${
                      team.is_champion ? "bg-mint/10" : team.is_eliminated ? "opacity-55" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="truncate text-sm font-semibold text-ink">{team.team_name}</p>
                      <span className="text-xs text-steel">
                        {team.is_champion ? "Campeon" : team.is_eliminated ? "Eliminado" : "Vivo"}
                      </span>
                    </div>
                    <div className="mt-3 flex gap-3">
                      <button
                        type="button"
                        onClick={() => void handleTeamWinnerTeamStatus(team.id, !team.is_eliminated, false)}
                        disabled={savingTeamWinner}
                        className="text-xs font-semibold text-coral disabled:opacity-50"
                      >
                        {team.is_eliminated ? "Reactivar" : "Eliminar"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleTeamWinnerTeamStatus(team.id, false, !team.is_champion)}
                        disabled={savingTeamWinner}
                        className="text-xs font-semibold text-mint disabled:opacity-50"
                      >
                        {team.is_champion ? "Quitar campeon" : "Campeon"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {selectedVip ? (
            <section className="space-y-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <p className="text-sm uppercase tracking-[0.22em] text-steel">Agregar participante</p>
                  <h3 className="mt-2 text-lg font-semibold text-ink">
                    Alta manual admin
                  </h3>
                </div>
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] lg:min-w-[520px]">
                  <select
                    value={addMemberProfileId}
                    onChange={(event) => setAddMemberProfileId(event.target.value)}
                    className={flatFieldClass}
                  >
                    <option value="">Selecciona usuario</option>
                    {addableUsers.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.display_name} {user.email ? `- ${user.email}` : ""}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => void handleAddMember()}
                    disabled={addingMember || !addMemberProfileId}
                    className="app-pill h-9 px-4 text-sm disabled:opacity-50"
                  >
                    {addingMember ? "Agregando" : "Agregar"}
                  </button>
                </div>
              </div>
              {selectedVip.join_locked ? (
                <p className="text-xs text-steel">
                  La VIP ya cerro solicitudes publicas; el alta manual admin sigue disponible.
                </p>
              ) : null}
            </section>
          ) : null}

          <section className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm uppercase tracking-[0.22em] text-steel">Solicitudes</p>
                <h3 className="mt-2 text-lg font-semibold text-ink">
                  {selectedVip ? `${pendingMemberships.length} pendientes` : "Selecciona una VIP"}
                </h3>
              </div>
            </div>

            {selectedVip ? (
              pendingMemberships.length > 0 ? (
                <div className="space-y-3">
                  {pendingMemberships.map((membership) => (
                    <div
                      key={membership.id}
                      className="flex flex-col gap-3 rounded-[12px] border border-white/[0.06] px-4 py-4 lg:flex-row lg:items-center lg:justify-between"
                    >
                      <div>
                        <p className="text-sm font-semibold text-ink">{membership.display_name}</p>
                        <p className="mt-1 text-xs text-steel">
                          Solicito acceso a {selectedVip.name}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={processingMembershipId === membership.id}
                          onClick={() => void handleDecision(membership.id, "approve")}
                          className="app-pill px-3 text-mint"
                        >
                          Aprobar
                        </button>
                        <button
                          type="button"
                          disabled={processingMembershipId === membership.id}
                          onClick={() => void handleDecision(membership.id, "reject")}
                          className="app-pill px-3 text-coral"
                        >
                          Rechazar
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-steel">No hay solicitudes pendientes en esta VIP.</p>
              )
            ) : (
              <p className="text-sm text-steel">Crea o selecciona una VIP para revisar solicitudes.</p>
            )}
          </section>

          {selectedVip ? (
            <section className="space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm uppercase tracking-[0.22em] text-steel">Miembros</p>
                  <h3 className="mt-2 text-lg font-semibold text-ink">
                    {approvedMemberships.length} aprobados
                  </h3>
                </div>
              </div>
              {approvedMemberships.length > 0 ? (
                <div className="overflow-x-auto rounded-[8px] border border-white/[0.06]">
                  <div className="grid min-w-[520px] grid-cols-[minmax(0,1fr)_120px_160px] gap-3 border-b border-white/[0.06] px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-steel">
                    <span>Jugador</span>
                    <span>Pago</span>
                    <span className="text-right">Acciones</span>
                  </div>
                  {approvedMemberships.map((membership) => (
                    <div
                      key={membership.id}
                      className="grid min-w-[520px] grid-cols-[minmax(0,1fr)_120px_160px] items-center gap-3 border-b border-white/[0.04] px-4 py-3 last:border-b-0"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-ink">{membership.display_name}</p>
                        <p className="mt-1 text-xs text-steel">
                          Miembro aprobado de {selectedVip.name}
                        </p>
                      </div>
                      <span className={`text-sm font-semibold ${membership.is_paid ? "text-mint" : "text-amber-100"}`}>
                        {getPaymentLabel(membership.is_paid)}
                      </span>
                      <div className="flex justify-end gap-3">
                        <button
                          type="button"
                          disabled={processingMembershipId === membership.id}
                          onClick={() => void handleToggleVipPayment(membership.id, membership.is_paid)}
                          className={`text-sm font-semibold transition disabled:opacity-50 ${
                            membership.is_paid ? "text-coral hover:text-coral/80" : "text-mint hover:text-mint/80"
                          }`}
                        >
                          {processingMembershipId === membership.id
                            ? "..."
                            : membership.is_paid
                              ? "Pago pend."
                              : "Marcar pag."}
                        </button>
                        <button
                          type="button"
                          disabled={processingMembershipId === membership.id}
                          onClick={() => void handleDecision(membership.id, "remove")}
                          className="text-sm font-semibold text-coral transition hover:text-coral/80 disabled:opacity-50"
                        >
                          {processingMembershipId === membership.id ? "Sacando..." : "Sacar"}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-steel">No hay miembros aprobados en esta VIP.</p>
              )}
            </section>
          ) : null}

          {selectedVip?.competition_kind === "matchday" ? (
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-4">
                <p className="text-sm font-semibold uppercase tracking-[0.22em] text-steel">Leaderboard</p>
                <div className="flex items-center gap-3">
                  <p className="text-xs text-steel">{selectedVip.leaderboard.length} participantes</p>
                  <button
                    type="button"
                    onClick={handleRecalculateVip}
                    disabled={recalculatingVip}
                    className="app-pill px-3 text-xs"
                  >
                    {recalculatingVip ? "Recalculando" : "Recalcular"}
                  </button>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-[12px] border border-white/[0.06] px-4 py-3">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-steel">Bolsa total</p>
                  <p className="mt-2 text-sm font-semibold text-ink">{formatCurrency(selectedVip.gross_pool_amount)}</p>
                </div>
                <div className="rounded-[12px] border border-white/[0.06] px-4 py-3">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-steel">1er lugar</p>
                  <p className="mt-2 text-sm font-semibold text-ink">{formatCurrency(selectedVip.first_place_amount)}</p>
                  <p className="mt-1 text-xs text-steel">{selectedVip.first_place_pct.toFixed(2)}%</p>
                </div>
                <div className="rounded-[12px] border border-white/[0.06] px-4 py-3">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-steel">2do lugar</p>
                  <p className="mt-2 text-sm font-semibold text-ink">{formatCurrency(selectedVip.second_place_amount)}</p>
                  <p className="mt-1 text-xs text-steel">{selectedVip.second_place_pct.toFixed(2)}%</p>
                </div>
                <div className="rounded-[12px] border border-white/[0.06] px-4 py-3">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-steel">3er lugar</p>
                  <p className="mt-2 text-sm font-semibold text-ink">{formatCurrency(selectedVip.third_place_amount)}</p>
                  <p className="mt-1 text-xs text-steel">{selectedVip.third_place_pct.toFixed(2)}%</p>
                </div>
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
                        <td className="px-3 py-3">{entry.display_name}</td>
                        <td className="px-3 py-3 text-center">{entry.total_points}</td>
                        <td className="px-3 py-3 text-center">{entry.correct_results}</td>
                        <td className="px-3 py-3 text-center">{entry.exact_scores}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {selectedVip.leaderboard.length === 0 ? (
                <p className="text-sm text-steel">Todavia no hay miembros aprobados con puntos acumulados.</p>
              ) : null}
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
