"use client";

import { useEffect, useMemo, useState } from "react";

import { backendFetch } from "@/lib/api/backend";
import { getBrowserAccessToken } from "@/lib/supabase/session";
import type { AdminUser, AdminVipCompetition, Matchday, Season, Team, VipCompetitionKind } from "@/types/api";

type FormState = {
  competitionKind: VipCompetitionKind;
  name: string;
  seasonId: string;
  entryFeeAmount: string;
  adminCommissionPct: string;
  firstPlacePct: string;
  secondPlacePct: string;
  thirdPlacePct: string;
  isActive: boolean;
  matchdayIds: string[];
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
  isActive: true,
  matchdayIds: [],
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
  const [savingTeamWinner, setSavingTeamWinner] = useState(false);
  const [deletingVip, setDeletingVip] = useState(false);
  const [addingMember, setAddingMember] = useState(false);
  const [processingMembershipId, setProcessingMembershipId] = useState<string | null>(null);
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
        .filter((team) => !selectedSeason?.competition_id || team.competition_id === selectedSeason.competition_id)
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
    setTeamWinnerTeamIds(vip?.team_winner_teams.map((team) => team.team_id) ?? []);
    setTeamWinnerProfileIds(
      vip?.team_winner_entries
        .filter((entry) => !entry.is_house && entry.profile_id)
        .map((entry) => entry.profile_id as string) ?? [],
    );
    const houseEntry = vip?.team_winner_entries.find((entry) => entry.is_house) ?? null;
    setIncludeHouse(Boolean(houseEntry));
    setHouseLabel(houseEntry?.display_name ?? "Casa");
  }

  async function loadPanel(preferredVipId = selectedVipId) {
    const accessToken = await getBrowserAccessToken();
    const [seasonRows, matchdayRows, vipRows, userRows, teamRows] = await Promise.all([
      backendFetch<Season[]>("/seasons", accessToken),
      backendFetch<Matchday[]>("/matchdays", accessToken),
      backendFetch<AdminVipCompetition[]>("/admin/vip", accessToken),
      backendFetch<AdminUser[]>("/admin/users", accessToken),
      backendFetch<Team[]>("/teams", accessToken),
    ]);

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

  function resetForNewVip() {
    setSelectedVipId("");
    setForm(toFormState(null, seasons));
    setAddMemberProfileId("");
    syncTeamWinnerDraft(null);
    setMessage(null);
    setError(null);
  }

  function selectVip(vip: AdminVipCompetition) {
    setSelectedVipId(vip.id);
    setForm(toFormState(vip, seasons));
    setAddMemberProfileId("");
    syncTeamWinnerDraft(vip);
    setMessage(null);
    setError(null);
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

  async function handleSave() {
    const isUpdate = Boolean(selectedVipId);
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const accessToken = await getBrowserAccessToken();
      const path = selectedVipId ? `/admin/vip/${selectedVipId}` : "/admin/vip";
      const method = selectedVipId ? "PUT" : "POST";
      const savedVip = await backendFetch<AdminVipCompetition>(path, accessToken, {
        method,
        body: JSON.stringify({
          competition_kind: form.competitionKind,
          season_id: form.seasonId,
          name: form.name,
          entry_fee_amount: Number(form.entryFeeAmount || 0),
          admin_commission_pct: Number(form.adminCommissionPct || 0),
          first_place_pct: Number(form.firstPlacePct || 0),
          second_place_pct: Number(form.secondPlacePct || 0),
          third_place_pct: Number(form.thirdPlacePct || 0),
          matchday_ids: form.competitionKind === "matchday" ? form.matchdayIds : [],
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
      setVips((current) => current.map((vip) => (vip.id === updatedVip.id ? updatedVip : vip)));
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
      setVips((current) => current.map((vip) => (vip.id === updatedVip.id ? updatedVip : vip)));
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
      setVips((current) => current.map((vip) => (vip.id === updatedVip.id ? updatedVip : vip)));
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
      setVips((current) => current.map((vip) => (vip.id === drawnVip.id ? drawnVip : vip)));
      syncTeamWinnerDraft(drawnVip);
      setMessage("Sorteo corrido. Ya puedes destapar participante por participante.");
    } catch (caughtError) {
      const errorMessage = getCaughtMessage(caughtError, "No se pudo correr el sorteo");
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
      setVips((current) => current.map((vip) => (vip.id === updatedVip.id ? updatedVip : vip)));
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
      setVips((current) => current.map((vip) => (vip.id === updatedVip.id ? updatedVip : vip)));
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
                <span className={`text-xs font-semibold uppercase tracking-[0.18em] ${vip.is_active ? "text-mint" : "text-steel"}`}>
                  {vip.is_active ? "Activa" : "Pausa"}
                </span>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-3 text-xs text-steel">
                <div>
                  <p className="uppercase tracking-[0.18em]">Entrada</p>
                  <p className="mt-1 text-sm font-semibold text-ink">{formatCurrency(vip.entry_fee_amount)}</p>
                </div>
                <div>
                  <p className="uppercase tracking-[0.18em]">
                    {vip.competition_kind === "team_winner" ? "Equipos" : "Jornadas"}
                  </p>
                  <p className="mt-1 text-sm font-semibold text-ink">
                    {vip.competition_kind === "team_winner" ? vip.team_winner_teams.length : vip.matchdays.length}
                  </p>
                </div>
                <div>
                  <p className="uppercase tracking-[0.18em]">
                    {vip.competition_kind === "team_winner" ? "Sorteo" : "Pendientes"}
                  </p>
                  <p className="mt-1 text-sm font-semibold text-ink">
                    {vip.competition_kind === "team_winner"
                      ? `${vip.team_winner_entries.filter((entry) => entry.revealed_at).length}/${vip.team_winner_entries.length}`
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
                <button type="button" onClick={handleSave} disabled={saving} className="app-pill px-4">
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
                {teamWinnerEntries.map((entry) => (
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
                      {entry.assigned_team_name ?? (entry.reveal_order ? "Oculto" : "Sin sortear")}
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
                ))}
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
                <p className="text-xs text-steel">{selectedVip.leaderboard.length} participantes</p>
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
