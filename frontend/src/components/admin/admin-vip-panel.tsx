"use client";

import { useEffect, useMemo, useState } from "react";

import { backendFetch } from "@/lib/api/backend";
import { getBrowserAccessToken } from "@/lib/supabase/session";
import type { AdminVipCompetition, Matchday, Season } from "@/types/api";

type FormState = {
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

function toFormState(vip: AdminVipCompetition | null, seasons: Season[]): FormState {
  if (!vip) {
    return {
      ...initialForm,
      seasonId: seasons.find((season) => season.is_active)?.id ?? seasons[0]?.id ?? "",
    };
  }
  return {
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
  const [selectedVipId, setSelectedVipId] = useState("");
  const [form, setForm] = useState<FormState>(initialForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
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

  const pendingMemberships = useMemo(
    () => selectedVip?.memberships.filter((membership) => membership.status === "pending") ?? [],
    [selectedVip],
  );
  const approvedMemberships = useMemo(
    () => selectedVip?.memberships.filter((membership) => membership.status === "approved") ?? [],
    [selectedVip],
  );
  const payoutPct =
    Number(form.firstPlacePct || 0) + Number(form.secondPlacePct || 0) + Number(form.thirdPlacePct || 0);

  async function loadPanel() {
    const accessToken = await getBrowserAccessToken();
    const [seasonRows, matchdayRows, vipRows] = await Promise.all([
      backendFetch<Season[]>("/seasons", accessToken),
      backendFetch<Matchday[]>("/matchdays", accessToken),
      backendFetch<AdminVipCompetition[]>("/admin/vip", accessToken),
    ]);

    setSeasons(seasonRows);
    setMatchdays(matchdayRows);
    setVips(vipRows);

    const nextSelectedVip = vipRows.find((vip) => vip.id === selectedVipId) ?? vipRows[0] ?? null;
    setSelectedVipId(nextSelectedVip?.id ?? "");
    setForm(toFormState(nextSelectedVip, seasonRows));
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
    setMessage(null);
    setError(null);
  }

  function selectVip(vip: AdminVipCompetition) {
    setSelectedVipId(vip.id);
    setForm(toFormState(vip, seasons));
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

  async function handleSave() {
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
          name: form.name,
          entry_fee_amount: Number(form.entryFeeAmount || 0),
          admin_commission_pct: Number(form.adminCommissionPct || 0),
          first_place_pct: Number(form.firstPlacePct || 0),
          second_place_pct: Number(form.secondPlacePct || 0),
          third_place_pct: Number(form.thirdPlacePct || 0),
          matchday_ids: form.matchdayIds,
          is_active: form.isActive,
        }),
      });
      await loadPanel();
      setSelectedVipId(savedVip.id);
      setMessage(selectedVipId ? "VIP actualizada." : "VIP creada.");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo guardar la VIP");
    } finally {
      setSaving(false);
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
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo actualizar la membresia VIP");
    } finally {
      setProcessingMembershipId(null);
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
      const updatedVip = await backendFetch<AdminVipCompetition>(
        `/admin/vip/${selectedVip.id}/memberships/${membershipId}/payment`,
        accessToken,
        {
          method: "PUT",
          body: JSON.stringify({ is_paid: !isPaid }),
        },
      );
      setVips((current) => current.map((vip) => (vip.id === updatedVip.id ? updatedVip : vip)));
      setMessage(!isPaid ? "Pago VIP confirmado." : "Pago VIP marcado pendiente.");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo actualizar el pago VIP");
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
                  <p className="uppercase tracking-[0.18em]">Jornadas</p>
                  <p className="mt-1 text-sm font-semibold text-ink">{vip.matchdays.length}</p>
                </div>
                <div>
                  <p className="uppercase tracking-[0.18em]">Pendientes</p>
                  <p className="mt-1 text-sm font-semibold text-ink">{vip.pending_requests_count}</p>
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
              <button type="button" onClick={handleSave} disabled={saving} className="app-pill px-4">
                {saving ? "Guardando" : selectedVip ? "Guardar cambios" : "Crear VIP"}
              </button>
            </div>

            <div className="grid gap-x-4 gap-y-3 lg:grid-cols-4">
              <label className="grid gap-1 lg:col-span-2">
                <span className={flatLabelClass}>Nombre</span>
                <input
                  value={form.name}
                  onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                  className={flatFieldClass}
                  placeholder="VIP Clausura"
                />
              </label>
              <label className="grid gap-1 lg:col-span-2">
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
          </section>

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

          {selectedVip ? (
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
