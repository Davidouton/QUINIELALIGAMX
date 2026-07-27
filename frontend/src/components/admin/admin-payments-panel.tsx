"use client";

import { useEffect, useMemo, useState } from "react";

import { backendFetch } from "@/lib/api/backend";
import { getBrowserAccessToken } from "@/lib/supabase/session";
import type { AdminUser, AdminVipCompetition, Season, SettlementGeneratedScope, SettlementScopeSummary } from "@/types/api";

type ScopeType = "season" | "vip";

function formatMoney(value: number) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDateTime(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function scopeTitle(scopeType: ScopeType) {
  return scopeType === "season" ? "Temporada" : "VIP";
}

function statusLabel(status: SettlementScopeSummary["assignments"][number]["status"]) {
  if (status === "pending_proof") return "Pendiente de ficha";
  if (status === "proof_submitted") return "En validación";
  if (status === "confirmed") return "Confirmado";
  return "Rechazado";
}

export function AdminPaymentsPanel() {
  const [scopeType, setScopeType] = useState<ScopeType>("season");
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [vips, setVips] = useState<AdminVipCompetition[]>([]);
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [selectedScopeId, setSelectedScopeId] = useState("");
  const [summary, setSummary] = useState<SettlementScopeSummary | null>(null);
  const [generatedScopes, setGeneratedScopes] = useState<SettlementGeneratedScope[]>([]);
  const [selectedPayerIds, setSelectedPayerIds] = useState<string[]>([]);
  const [configDraft, setConfigDraft] = useState({
    max_payment_amount: "5000",
    confirmation_window_hours: "24",
    commission_allocations: [] as { profile_id: string; amount: string }[],
  });
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [clearingAssignments, setClearingAssignments] = useState(false);
  const [savingManualAssignment, setSavingManualAssignment] = useState(false);
  const [dispatchingAssignments, setDispatchingAssignments] = useState(false);
  const [editingAssignmentId, setEditingAssignmentId] = useState<string | null>(null);
  const [overrideDraft, setOverrideDraft] = useState({ payer_profile_id: "", payee_profile_id: "", amount: "" });
  const [manualAssignment, setManualAssignment] = useState({ payer_profile_id: "", payee_profile_id: "", amount: "" });
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    async function loadCatalogs() {
      setLoadingCatalog(true);
      setError(null);
      try {
        const accessToken = await getBrowserAccessToken();
        const [seasonRows, vipRows, generatedRows, userRows] = await Promise.all([
          backendFetch<Season[]>("/seasons", accessToken),
          backendFetch<AdminVipCompetition[]>("/admin/vip?include_leaderboard=true", accessToken),
          backendFetch<SettlementGeneratedScope[]>("/payments/settlements/admin/generated", accessToken),
          backendFetch<AdminUser[]>("/admin/users", accessToken),
        ]);
        setSeasons(seasonRows);
        setVips(vipRows);
        setGeneratedScopes(generatedRows);
        setAdminUsers(userRows.filter((row) => row.role_code === "admin" || row.role_code === "master_admin"));
        const searchParams = new URLSearchParams(window.location.search);
        const requestedScopeType = searchParams.get("scope_type") === "vip" ? "vip" : "season";
        const requestedScopeId = searchParams.get("scope_id") ?? "";
        const activeSeasonId = seasonRows.find((row) => row.is_active)?.id ?? seasonRows[0]?.id ?? "";
        const activeVipId = vipRows.find((row) => row.is_active)?.id ?? vipRows[0]?.id ?? "";
        const requestedRows = requestedScopeType === "vip" ? vipRows : seasonRows;
        setScopeType(requestedScopeType);
        setSelectedScopeId(
          requestedRows.some((row) => row.id === requestedScopeId)
            ? requestedScopeId
            : requestedScopeType === "vip"
              ? activeVipId
              : activeSeasonId,
        );
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "No se pudo cargar el panel de pagos.");
      } finally {
        setLoadingCatalog(false);
      }
    }

    void loadCatalogs();
  }, []);

  const availableScopes = scopeType === "season" ? seasons : vips;

  useEffect(() => {
    if (!availableScopes.length) {
      setSelectedScopeId("");
      return;
    }
    if (!availableScopes.some((row) => row.id === selectedScopeId)) {
      setSelectedScopeId(availableScopes.find((row) => row.is_active)?.id ?? availableScopes[0]?.id ?? "");
    }
  }, [availableScopes, selectedScopeId]);

  async function loadSummary(nextScopeType: ScopeType, nextScopeId: string) {
    if (!nextScopeId) {
      setSummary(null);
      setSelectedPayerIds([]);
      return;
    }

    setLoadingSummary(true);
    setError(null);
    try {
      const accessToken = await getBrowserAccessToken();
      const response = await backendFetch<SettlementScopeSummary>(
        `/payments/settlements/admin/summary?scope_type=${nextScopeType}&scope_id=${nextScopeId}`,
        accessToken,
      );
      setSummary(response);
      const savedAllocations = response.config.commission_allocations.map((row) => ({
        profile_id: row.profile_id,
        amount: String(row.amount),
      }));
      const commissionAmount = response.expected_admin_commission_amount;
      setConfigDraft({
        max_payment_amount: String(response.config.max_payment_amount || 5000),
        confirmation_window_hours: String(response.config.confirmation_window_hours || 24),
        commission_allocations: savedAllocations.length > 0
          ? savedAllocations
          : commissionAmount > 0
            ? [{ profile_id: "", amount: String(commissionAmount) }]
            : [],
      });
      const defaultPayers =
        response.selected_payer_profile_ids.length > 0
          ? response.selected_payer_profile_ids
          : response.participants.filter((participant) => participant.is_payer_candidate).map((participant) => participant.profile_id);
      setSelectedPayerIds(defaultPayers);
    } catch (caughtError) {
      setSummary(null);
      setSelectedPayerIds([]);
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo cargar el split.");
    } finally {
      setLoadingSummary(false);
    }
  }

  useEffect(() => {
    void loadSummary(scopeType, selectedScopeId);
  }, [scopeType, selectedScopeId]);

  const selectedScope = useMemo(
    () => availableScopes.find((row) => row.id === selectedScopeId) ?? null,
    [availableScopes, selectedScopeId],
  );
  function togglePayer(profileId: string) {
    setSelectedPayerIds((current) =>
      current.includes(profileId) ? current.filter((item) => item !== profileId) : [...current, profileId],
    );
  }

  async function handleSaveConfig() {
    if (!selectedScopeId) return;
    setSavingConfig(true);
    setError(null);
    setMessage(null);
    try {
      const accessToken = await getBrowserAccessToken();
      await backendFetch(
        "/payments/settlements/admin/config",
        accessToken,
        {
          method: "PUT",
          body: JSON.stringify({
            scope_type: scopeType,
            scope_id: selectedScopeId,
            max_payment_amount: Number(configDraft.max_payment_amount),
            confirmation_window_hours: Number(configDraft.confirmation_window_hours),
            commission_allocations: configDraft.commission_allocations.map((row) => ({ ...row, amount: Number(row.amount) })),
          }),
        },
      );
      setMessage("Configuración guardada.");
      await loadSummary(scopeType, selectedScopeId);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo guardar la configuración.");
    } finally {
      setSavingConfig(false);
    }
  }

  async function handleGenerateSplit() {
    if (!selectedScopeId) return;
    const allocatedCommission = configDraft.commission_allocations.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    if (summary && Math.abs(allocatedCommission - summary.expected_admin_commission_amount) >= 0.01) {
      setError(`Distribuye exactamente ${formatMoney(summary.expected_admin_commission_amount)} de comisión antes de generar el split.`);
      return;
    }
    const hasExistingAssignments = Boolean(summary?.assignments.length);
    if (
      hasExistingAssignments
      && !window.confirm(
        `Se reemplazaran las ${summary?.assignments.length ?? 0} asignaciones actuales usando el nuevo limite por pago. Continuar?`,
      )
    ) {
      return;
    }
    setGenerating(true);
    setError(null);
    setMessage(null);
    try {
      const accessToken = await getBrowserAccessToken();
      await backendFetch(
        "/payments/settlements/admin/config",
        accessToken,
        {
          method: "PUT",
          body: JSON.stringify({
            scope_type: scopeType,
            scope_id: selectedScopeId,
            max_payment_amount: Number(configDraft.max_payment_amount),
            confirmation_window_hours: Number(configDraft.confirmation_window_hours),
            commission_allocations: configDraft.commission_allocations.map((row) => ({ ...row, amount: Number(row.amount) })),
          }),
        },
      );
      const refreshedSummary = await backendFetch<SettlementScopeSummary>(
        `/payments/settlements/admin/summary?scope_type=${scopeType}&scope_id=${selectedScopeId}`,
        accessToken,
      );
      const payerCandidates = new Set(
        refreshedSummary.participants.filter((participant) => participant.is_payer_candidate).map((participant) => participant.profile_id),
      );
      const rebalancedPayerIds = selectedPayerIds.filter((profileId) => payerCandidates.has(profileId));
      const effectivePayerIds = rebalancedPayerIds.length > 0
        ? rebalancedPayerIds
        : [...payerCandidates];
      const response = await backendFetch<SettlementScopeSummary>(
        "/payments/settlements/admin/generate",
        accessToken,
        {
          method: "POST",
          body: JSON.stringify({
            scope_type: scopeType,
            scope_id: selectedScopeId,
            payer_profile_ids: effectivePayerIds,
          }),
        },
      );
      setSummary(response);
      setSelectedPayerIds(response.selected_payer_profile_ids);
      setConfigDraft({
        max_payment_amount: String(response.config.max_payment_amount),
        confirmation_window_hours: String(response.config.confirmation_window_hours),
        commission_allocations: response.config.commission_allocations.map((row) => ({
          profile_id: row.profile_id,
          amount: String(row.amount),
        })),
      });
      setGeneratedScopes(
        await backendFetch<SettlementGeneratedScope[]>("/payments/settlements/admin/generated", accessToken),
      );
      setMessage(hasExistingAssignments ? "Configuración guardada y split regenerado." : "Configuración guardada y split generado.");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo generar el split.");
    } finally {
      setGenerating(false);
    }
  }

  async function handleClearAssignments() {
    if (!summary?.assignments.length) return;
    if (!window.confirm(`Se borrarán las ${summary.assignments.length} asignaciones pendientes de ${summary.scope_label}. ¿Continuar?`)) return;
    setClearingAssignments(true);
    setError(null);
    setMessage(null);
    try {
      const accessToken = await getBrowserAccessToken();
      const response = await backendFetch<SettlementScopeSummary>(
        `/payments/settlements/admin/assignments?scope_type=${scopeType}&scope_id=${selectedScopeId}`,
        accessToken,
        { method: "DELETE" },
      );
      setSummary(response);
      setSelectedPayerIds([]);
      setManualAssignment({ payer_profile_id: "", payee_profile_id: "", amount: "" });
      setGeneratedScopes(await backendFetch<SettlementGeneratedScope[]>("/payments/settlements/admin/generated", accessToken));
      setMessage("Asignaciones borradas. Ya puedes redistribuir desde cero.");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudieron borrar las asignaciones.");
    } finally {
      setClearingAssignments(false);
    }
  }

  async function handleCreateManualAssignment() {
    if (!summary || !manualAssignment.payer_profile_id || !manualAssignment.payee_profile_id || Number(manualAssignment.amount) <= 0) {
      setError("Selecciona quién paga, quién recibe y un monto mayor a cero.");
      return;
    }
    setSavingManualAssignment(true);
    setError(null);
    setMessage(null);
    try {
      const accessToken = await getBrowserAccessToken();
      const response = await backendFetch<SettlementScopeSummary>("/payments/settlements/admin/manual", accessToken, {
        method: "POST",
        body: JSON.stringify({
          scope_type: scopeType,
          scope_id: selectedScopeId,
          payer_profile_id: manualAssignment.payer_profile_id,
          payee_profile_id: manualAssignment.payee_profile_id,
          amount: Number(manualAssignment.amount),
        }),
      });
      setSummary(response);
      setSelectedPayerIds(response.selected_payer_profile_ids);
      setManualAssignment({ payer_profile_id: "", payee_profile_id: "", amount: "" });
      setGeneratedScopes(await backendFetch<SettlementGeneratedScope[]>("/payments/settlements/admin/generated", accessToken));
      setMessage("Movimiento manual agregado.");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo agregar el movimiento manual.");
    } finally {
      setSavingManualAssignment(false);
    }
  }

  async function handleDispatchAssignments() {
    if (!summary?.assignments.length) return;
    if (!window.confirm(`Se asignarán ${summary.assignments.length} pagos y se avisará a pagadores y receptores. ¿Continuar?`)) return;
    setDispatchingAssignments(true);
    setError(null);
    setMessage(null);
    try {
      const accessToken = await getBrowserAccessToken();
      const response = await backendFetch<{ assignments_count: number; notification_dispatches: number }>(
        `/payments/settlements/admin/assign?scope_type=${scopeType}&scope_id=${selectedScopeId}`,
        accessToken,
        { method: "POST" },
      );
      setMessage(`${response.assignments_count} pagos asignados. Se procesaron ${response.notification_dispatches} avisos.`);
      await loadSummary(scopeType, selectedScopeId);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudieron asignar los pagos.");
    } finally {
      setDispatchingAssignments(false);
    }
  }

  function startOverride(assignment: SettlementScopeSummary["assignments"][number]) {
    setEditingAssignmentId(assignment.id);
    setOverrideDraft({
      payer_profile_id: assignment.payer_profile_id,
      payee_profile_id: assignment.payee_profile_id,
      amount: String(assignment.amount),
    });
  }

  async function handleSaveOverride() {
    if (!editingAssignmentId || !overrideDraft.payer_profile_id || !overrideDraft.payee_profile_id || Number(overrideDraft.amount) <= 0) {
      setError("Completa pagador, receptor y monto para guardar el override.");
      return;
    }
    setSavingManualAssignment(true);
    setError(null);
    setMessage(null);
    try {
      const accessToken = await getBrowserAccessToken();
      const response = await backendFetch<SettlementScopeSummary>(
        `/payments/settlements/admin/assignments/${editingAssignmentId}`,
        accessToken,
        {
          method: "PUT",
          body: JSON.stringify({ ...overrideDraft, amount: Number(overrideDraft.amount) }),
        },
      );
      setSummary(response);
      setSelectedPayerIds(response.selected_payer_profile_ids);
      setEditingAssignmentId(null);
      setMessage("Override guardado. Presiona Asignar pagos cuando termines de revisar.");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo guardar el override.");
    } finally {
      setSavingManualAssignment(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <p className="text-[11px] uppercase tracking-[0.28em] text-steel">Pagos</p>
        <h1 className="text-2xl font-semibold text-ink">Panel de conciliación</h1>
        <p className="max-w-3xl text-sm text-steel">
          Selecciona quién paga a los ganadores, configura el monto máximo por depósito y revisa el estado de cada ficha.
        </p>
      </section>

      <section className="grid gap-4 rounded-[20px] border border-white/[0.08] bg-white/[0.03] p-5 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="space-y-4">
          <label className="block space-y-2 text-sm">
            <span className="text-steel">Competencia normal o VIP</span>
            <select
              value={selectedScopeId ? `${scopeType}:${selectedScopeId}` : ""}
              onChange={(event) => {
                const [nextScopeType, nextScopeId] = event.target.value.split(":", 2) as [ScopeType, string];
                setScopeType(nextScopeType);
                setSelectedScopeId(nextScopeId);
              }}
              className="field-control"
              disabled={loadingCatalog || (seasons.length === 0 && vips.length === 0)}
            >
              <optgroup label="Temporadas normales">
                {seasons.map((row) => (
                  <option key={`season:${row.id}`} value={`season:${row.id}`}>{row.name}</option>
                ))}
              </optgroup>
              <optgroup label="VIP">
                {vips.map((row) => (
                  <option key={`vip:${row.id}`} value={`vip:${row.id}`}>{row.name}</option>
                ))}
              </optgroup>
            </select>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-2 text-sm">
              <span className="text-steel">Monto máximo por pago</span>
              <input
                type="number"
                min="1"
                max="99999999.99"
                step="0.01"
                value={configDraft.max_payment_amount}
                onChange={(event) => setConfigDraft((current) => ({ ...current, max_payment_amount: event.target.value }))}
                className="field-control"
              />
            </label>
            <label className="block space-y-2 text-sm">
              <span className="text-steel">Ventana de confirmación (horas)</span>
              <input
                type="number"
                min="1"
                max="168"
                step="1"
                value={configDraft.confirmation_window_hours}
                onChange={(event) =>
                  setConfigDraft((current) => ({ ...current, confirmation_window_hours: event.target.value }))
                }
                className="field-control"
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={handleSaveConfig} disabled={savingConfig || !selectedScopeId} className="secondary-button">
              {savingConfig ? "Guardando..." : "Guardar configuración"}
            </button>
            <button type="button" onClick={handleGenerateSplit} disabled={generating || !selectedScopeId} className="app-pill px-4 text-sm">
              {generating
                ? "Generando..."
                : summary?.assignments.length
                  ? "Guardar y regenerar split"
                  : "Guardar y generar split"}
            </button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <article className="rounded-[16px] border border-white/[0.08] bg-black/10 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-steel">Reciben</p>
            <p className="mt-2 text-2xl font-semibold text-ink">
              {summary ? formatMoney(summary.total_receivable_amount) : formatMoney(0)}
            </p>
          </article>
          <article className="rounded-[16px] border border-white/[0.08] bg-black/10 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-steel">Pagan seleccionados</p>
            <p className="mt-2 text-2xl font-semibold text-ink">
              {summary ? formatMoney(summary.total_selected_payable_amount) : formatMoney(0)}
            </p>
          </article>
          <article className="rounded-[16px] border border-white/[0.08] bg-black/10 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-steel">Asignado</p>
            <p className="mt-2 text-2xl font-semibold text-ink">
              {summary ? formatMoney(summary.total_assigned_amount) : formatMoney(0)}
            </p>
          </article>
          <article className="rounded-[16px] border border-white/[0.08] bg-black/10 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-steel">Pendiente por cubrir</p>
            <p className="mt-2 text-2xl font-semibold text-coral">
              {summary ? formatMoney(summary.uncovered_receiver_amount) : formatMoney(0)}
            </p>
          </article>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-ink">Splits generados</h2>
            <p className="mt-1 text-sm text-steel">Conciliaciones normales y VIP que ya tienen pagos asignados.</p>
          </div>
          <span className="text-sm text-steel">{generatedScopes.length}</span>
        </div>
        {generatedScopes.length ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {generatedScopes.map((generated) => {
              const isSelected = generated.scope_type === scopeType && generated.scope_id === selectedScopeId;
              return (
                <button
                  key={`${generated.scope_type}:${generated.scope_id}`}
                  type="button"
                  onClick={() => {
                    setScopeType(generated.scope_type);
                    setSelectedScopeId(generated.scope_id);
                  }}
                  className={`rounded-[16px] border p-4 text-left transition ${
                    isSelected
                      ? "border-[#4f7df3]/50 bg-[#4f7df3]/10"
                      : "border-white/[0.08] bg-white/[0.02] hover:border-white/[0.16]"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.22em] text-steel">
                        {generated.scope_type === "vip" ? "VIP" : "Temporada normal"}
                      </p>
                      <p className="mt-1 font-semibold text-ink">{generated.scope_label}</p>
                    </div>
                    <span className="text-xs text-steel">{generated.assignments_count} pagos</span>
                  </div>
                  <p className="mt-3 text-lg font-semibold text-ink">{formatMoney(generated.total_assigned_amount)}</p>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-steel">
                    <span>{generated.pending_count} pendientes</span>
                    <span>{generated.proof_submitted_count} en validación</span>
                    <span>{generated.confirmed_count} confirmados</span>
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-steel">Todavía no hay splits generados.</p>
        )}
      </section>

      {loadingCatalog || loadingSummary ? <p className="text-sm text-steel">Cargando panel...</p> : null}
      {error ? <p className="text-sm text-coral">{error}</p> : null}
      {message ? <p className="text-sm text-moss">{message}</p> : null}

      {summary ? (
        <>
          <section className="space-y-4 rounded-[20px] border border-white/[0.08] bg-white/[0.02] p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.28em] text-steel">{scopeTitle(scopeType)}</p>
                <h2 className="mt-1 text-lg font-semibold text-ink">{summary.scope_label}</h2>
              </div>
              <p className="text-sm text-steel">
                {summary.participants.length} jugadores · {selectedPayerIds.length} pagadores seleccionados
              </p>
            </div>

            {summary.expected_admin_commission_amount > 0 ? (
              <div className="space-y-3 rounded-[16px] border border-[#4f7df3]/40 bg-[#4f7df3]/[0.08] p-4 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-ink">1. Define quién recibe la comisión</p>
                    <p className="mt-1 text-xs text-steel">Estas personas aparecerán abajo como receptores de pago. Después guarda y regenera el split.</p>
                  </div>
                  <button type="button" className="secondary-button" onClick={() => setConfigDraft((current) => ({
                    ...current,
                    commission_allocations: [...current.commission_allocations, { profile_id: "", amount: "" }],
                  }))}>+ Otro administrador</button>
                </div>
                {configDraft.commission_allocations.map((allocation, index) => (
                  <div key={`${index}-${allocation.profile_id}`} className="grid gap-2 sm:grid-cols-[1fr_170px_auto]">
                    <select value={allocation.profile_id} onChange={(event) => setConfigDraft((current) => ({
                      ...current,
                      commission_allocations: current.commission_allocations.map((row, rowIndex) => rowIndex === index ? { ...row, profile_id: event.target.value } : row),
                    }))} className="field-control">
                      <option value="">Selecciona quién recibe</option>
                      {adminUsers.map((admin) => <option key={admin.id} value={admin.id}>{admin.display_name}{admin.bank_name ? ` · ${admin.bank_name}` : " · sin banco"}</option>)}
                    </select>
                    <input type="number" min="0.01" step="0.01" aria-label="Monto de comisión" placeholder="Monto" value={allocation.amount} onChange={(event) => setConfigDraft((current) => ({
                      ...current,
                      commission_allocations: current.commission_allocations.map((row, rowIndex) => rowIndex === index ? { ...row, amount: event.target.value } : row),
                    }))} className="field-control" />
                    <button type="button" className="secondary-button" onClick={() => setConfigDraft((current) => ({
                      ...current,
                      commission_allocations: current.commission_allocations.filter((_, rowIndex) => rowIndex !== index),
                    }))}>Quitar</button>
                  </div>
                ))}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs text-steel">Asignado: <strong className="text-ink">{formatMoney(configDraft.commission_allocations.reduce((sum, row) => sum + Number(row.amount || 0), 0))}</strong> de {formatMoney(summary.expected_admin_commission_amount)}</p>
                  <button type="button" onClick={handleGenerateSplit} disabled={generating || !selectedScopeId} className="app-pill px-4 text-sm">
                    {generating ? "Generando..." : summary.assignments.length ? "Guardar y regenerar pagos" : "Guardar y generar pagos"}
                  </button>
                </div>
              </div>
            ) : null}

            <div className="android-scroll-x">
              <table className="min-w-[1420px] w-full table-fixed text-left text-[12px] text-ink">
                <thead className="app-table-head">
                  <tr>
                    <th className="px-3 py-3">Paga</th>
                    <th className="px-3 py-3">Jugador</th>
                    <th className="px-3 py-3">Pos.</th>
                    <th className="px-3 py-3">Pts</th>
                    <th className="px-3 py-3">Premio final</th>
                    <th className="px-3 py-3">Premios jornada</th>
                    <th className="px-3 py-3">Comisión admin</th>
                    <th className="px-3 py-3">Total premios</th>
                    <th className="px-3 py-3">Adeudo</th>
                    <th className="px-3 py-3">Neto</th>
                    <th className="px-3 py-3">Banco</th>
                    <th className="px-3 py-3">Cuenta</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.participants.map((participant) => (
                    <tr key={participant.profile_id} className="app-table-row border-b last:border-b-0">
                      <td className="px-3 py-3">
                        {participant.is_payer_candidate ? (
                          <input
                            type="checkbox"
                            checked={selectedPayerIds.includes(participant.profile_id)}
                            onChange={() => togglePayer(participant.profile_id)}
                            className="h-4 w-4"
                          />
                        ) : (
                          <span className="text-steel">-</span>
                        )}
                      </td>
                      <td className="px-3 py-3 font-medium">{participant.display_name}</td>
                      <td className="px-3 py-3">{participant.rank_position ? `#${participant.rank_position}` : "-"}</td>
                      <td className="px-3 py-3">{participant.total_points}</td>
                      <td className="px-3 py-3">{formatMoney(participant.final_prize_amount)}</td>
                      <td className="px-3 py-3">{formatMoney(participant.weekly_prize_amount)}</td>
                      <td className="px-3 py-3">{formatMoney(participant.admin_commission_amount)}</td>
                      <td className="px-3 py-3 font-medium">{formatMoney(participant.prize_amount)}</td>
                      <td className="px-3 py-3">{formatMoney(participant.pending_entry_amount)}</td>
                      <td className={`px-3 py-3 font-semibold ${participant.net_amount > 0 ? "text-moss" : participant.net_amount < 0 ? "text-coral" : "text-ink"}`}>
                        {participant.net_amount > 0
                          ? `Recibe ${formatMoney(participant.net_amount)}`
                          : participant.net_amount < 0
                            ? `Paga ${formatMoney(Math.abs(participant.net_amount))}`
                            : formatMoney(0)}
                      </td>
                      <td className="px-3 py-3 text-steel">{participant.bank_name ?? "-"}</td>
                      <td className="px-3 py-3 text-steel">{participant.deposit_account ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="space-y-4 rounded-[20px] border border-white/[0.08] bg-white/[0.02] p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-ink">Asignaciones generadas</h2>
                <p className="mt-1 text-sm text-steel">
                  Estado de fichas, comprobantes y validaciones del receptor.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-sm text-steel">{summary.assignments.length} pagos</p>
                <button type="button" onClick={handleDispatchAssignments} disabled={dispatchingAssignments || summary.assignments.length === 0} className="app-pill px-4 text-sm">
                  {dispatchingAssignments ? "Asignando..." : "Asignar pagos"}
                </button>
                <button type="button" onClick={handleClearAssignments} disabled={clearingAssignments || summary.assignments.length === 0} className="secondary-button text-coral">
                  {clearingAssignments ? "Borrando..." : "Borrar todas"}
                </button>
              </div>
            </div>

            <div className="space-y-3 rounded-[16px] border border-white/[0.08] bg-white/[0.03] p-4">
              <div>
                <h3 className="text-sm font-semibold text-ink">Agregar movimiento manual</h3>
                <p className="mt-1 text-xs text-steel">Crea directamente una línea de pago sin recalcular las demás asignaciones.</p>
              </div>
              <div className="grid gap-3 lg:grid-cols-[1fr_1fr_170px_auto]">
                <select value={manualAssignment.payer_profile_id} onChange={(event) => setManualAssignment((current) => ({ ...current, payer_profile_id: event.target.value }))} className="field-control">
                  <option value="">Quién paga</option>
                  {summary.participants.map((participant) => <option key={`payer-${participant.profile_id}`} value={participant.profile_id}>{participant.display_name}</option>)}
                </select>
                <select value={manualAssignment.payee_profile_id} onChange={(event) => setManualAssignment((current) => ({ ...current, payee_profile_id: event.target.value }))} className="field-control">
                  <option value="">Quién recibe</option>
                  {summary.participants.map((participant) => <option key={`payee-${participant.profile_id}`} value={participant.profile_id}>{participant.display_name}</option>)}
                </select>
                <input type="number" min="0.01" step="0.01" placeholder="Monto" aria-label="Monto del movimiento manual" value={manualAssignment.amount} onChange={(event) => setManualAssignment((current) => ({ ...current, amount: event.target.value }))} className="field-control" />
                <button type="button" onClick={handleCreateManualAssignment} disabled={savingManualAssignment} className="app-pill px-4 text-sm">
                  {savingManualAssignment ? "Agregando..." : "Agregar pago"}
                </button>
              </div>
            </div>

            <div className="android-scroll-x">
              <table className="min-w-[1280px] w-full table-fixed text-left text-[12px] text-ink">
                <thead className="app-table-head">
                  <tr>
                    <th className="px-3 py-3">Paga</th>
                    <th className="px-3 py-3">Recibe</th>
                    <th className="px-3 py-3">Banco</th>
                    <th className="px-3 py-3">Cuenta</th>
                    <th className="px-3 py-3">Monto</th>
                    <th className="px-3 py-3">Status</th>
                    <th className="px-3 py-3">Ficha</th>
                    <th className="px-3 py-3">Auto confirmación</th>
                    <th className="px-3 py-3">Resolución</th>
                    <th className="px-3 py-3">Ajuste</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.assignments.map((assignment) => (
                    <tr key={assignment.id} className="app-table-row border-b last:border-b-0 align-top">
                      <td className="px-3 py-3 font-medium">
                        {editingAssignmentId === assignment.id ? (
                          <select value={overrideDraft.payer_profile_id} onChange={(event) => setOverrideDraft((current) => ({ ...current, payer_profile_id: event.target.value }))} className="field-control min-w-[160px]">
                            {summary.participants.map((participant) => <option key={`override-payer-${participant.profile_id}`} value={participant.profile_id}>{participant.display_name}</option>)}
                          </select>
                        ) : assignment.payer_display_name}
                      </td>
                      <td className="px-3 py-3 font-medium">
                        {editingAssignmentId === assignment.id ? (
                          <select value={overrideDraft.payee_profile_id} onChange={(event) => setOverrideDraft((current) => ({ ...current, payee_profile_id: event.target.value }))} className="field-control min-w-[160px]">
                            {summary.participants.map((participant) => <option key={`override-payee-${participant.profile_id}`} value={participant.profile_id}>{participant.display_name}</option>)}
                          </select>
                        ) : assignment.payee_display_name}
                      </td>
                      <td className="px-3 py-3 text-steel">{assignment.payee_bank_name ?? "-"}</td>
                      <td className="px-3 py-3 text-steel">{assignment.payee_deposit_account ?? "-"}</td>
                      <td className="px-3 py-3 font-semibold">
                        {editingAssignmentId === assignment.id ? (
                          <input type="number" min="0.01" step="0.01" value={overrideDraft.amount} onChange={(event) => setOverrideDraft((current) => ({ ...current, amount: event.target.value }))} className="field-control min-w-[130px]" />
                        ) : formatMoney(assignment.amount)}
                      </td>
                      <td className="px-3 py-3">{statusLabel(assignment.status)}</td>
                      <td className="px-3 py-3">
                        {assignment.proof_image_url ? (
                          <a href={assignment.proof_image_url} target="_blank" rel="noreferrer" className="text-[#4f7df3] underline-offset-4 hover:underline">
                            Ver ficha
                          </a>
                        ) : (
                          <span className="text-steel">Pendiente</span>
                        )}
                        {assignment.proof_note ? <p className="mt-1 text-[11px] text-steel">{assignment.proof_note}</p> : null}
                      </td>
                      <td className="px-3 py-3 text-steel">{formatDateTime(assignment.auto_confirm_at)}</td>
                      <td className="px-3 py-3 text-steel">
                        {assignment.confirmed_at ? `Confirmado ${formatDateTime(assignment.confirmed_at)}` : null}
                        {assignment.rejected_at ? `Rechazado ${formatDateTime(assignment.rejected_at)}` : null}
                        {!assignment.confirmed_at && !assignment.rejected_at ? "-" : null}
                        {assignment.rejection_reason ? <p className="mt-1 text-[11px] text-coral">{assignment.rejection_reason}</p> : null}
                      </td>
                      <td className="px-3 py-3">
                        {editingAssignmentId === assignment.id ? (
                          <div className="flex flex-col gap-2">
                            <button type="button" onClick={handleSaveOverride} disabled={savingManualAssignment} className="app-pill px-3 text-xs">Guardar</button>
                            <button type="button" onClick={() => setEditingAssignmentId(null)} className="secondary-button text-xs">Cancelar</button>
                          </div>
                        ) : (
                          <button type="button" onClick={() => startOverride(assignment)} disabled={assignment.status === "proof_submitted" || assignment.status === "confirmed"} className="secondary-button text-xs">Override</button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {summary.assignments.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="px-3 py-8 text-sm text-steel">
                        Todavía no hay pagos generados para {selectedScope?.name ?? "esta selección"}.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
