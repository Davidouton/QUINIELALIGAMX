"use client";

import { useEffect, useMemo, useState } from "react";

import { backendFetch } from "@/lib/api/backend";
import { getBrowserAccessToken } from "@/lib/supabase/session";
import type { AdminVipCompetition, Season, SettlementScopeSummary } from "@/types/api";

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
  const [selectedScopeId, setSelectedScopeId] = useState("");
  const [summary, setSummary] = useState<SettlementScopeSummary | null>(null);
  const [selectedPayerIds, setSelectedPayerIds] = useState<string[]>([]);
  const [configDraft, setConfigDraft] = useState({ max_payment_amount: "5000", confirmation_window_hours: "24" });
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    async function loadCatalogs() {
      setLoadingCatalog(true);
      setError(null);
      try {
        const accessToken = await getBrowserAccessToken();
        const [seasonRows, vipRows] = await Promise.all([
          backendFetch<Season[]>("/seasons", accessToken),
          backendFetch<AdminVipCompetition[]>("/admin/vip?include_leaderboard=true", accessToken),
        ]);
        setSeasons(seasonRows);
        setVips(vipRows);
        const activeSeasonId = seasonRows.find((row) => row.is_active)?.id ?? seasonRows[0]?.id ?? "";
        const activeVipId = vipRows.find((row) => row.is_active)?.id ?? vipRows[0]?.id ?? "";
        setSelectedScopeId(activeSeasonId || activeVipId);
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
      setConfigDraft({
        max_payment_amount: String(response.config.max_payment_amount || 5000),
        confirmation_window_hours: String(response.config.confirmation_window_hours || 24),
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
    setGenerating(true);
    setError(null);
    setMessage(null);
    try {
      const accessToken = await getBrowserAccessToken();
      const response = await backendFetch<SettlementScopeSummary>(
        "/payments/settlements/admin/generate",
        accessToken,
        {
          method: "POST",
          body: JSON.stringify({
            scope_type: scopeType,
            scope_id: selectedScopeId,
            payer_profile_ids: selectedPayerIds,
          }),
        },
      );
      setSummary(response);
      setSelectedPayerIds(response.selected_payer_profile_ids);
      setMessage("Split generado.");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo generar el split.");
    } finally {
      setGenerating(false);
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
          <div className="flex flex-wrap gap-2">
            {(["season", "vip"] as ScopeType[]).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setScopeType(option)}
                className={`app-pill px-4 ${scopeType === option ? "app-pill-active text-ink" : ""}`}
              >
                {scopeTitle(option)}
              </button>
            ))}
          </div>
          <label className="block space-y-2 text-sm">
            <span className="text-steel">{scopeTitle(scopeType)}</span>
            <select
              value={selectedScopeId}
              onChange={(event) => setSelectedScopeId(event.target.value)}
              className="field-control"
              disabled={loadingCatalog || availableScopes.length === 0}
            >
              {availableScopes.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-2 text-sm">
              <span className="text-steel">Monto máximo por pago</span>
              <input
                type="number"
                min="1"
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
              {generating ? "Generando..." : "Generar split"}
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

            <div className="no-scrollbar overflow-x-auto touch-pan-x">
              <table className="min-w-[1180px] w-full table-fixed text-left text-[12px] text-ink">
                <thead className="app-table-head">
                  <tr>
                    <th className="px-3 py-3">Paga</th>
                    <th className="px-3 py-3">Jugador</th>
                    <th className="px-3 py-3">Pos.</th>
                    <th className="px-3 py-3">Pts</th>
                    <th className="px-3 py-3">Premio</th>
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
                      <td className="px-3 py-3">{formatMoney(participant.prize_amount)}</td>
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
              <p className="text-sm text-steel">{summary.assignments.length} pagos</p>
            </div>

            <div className="no-scrollbar overflow-x-auto touch-pan-x">
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
                  </tr>
                </thead>
                <tbody>
                  {summary.assignments.map((assignment) => (
                    <tr key={assignment.id} className="app-table-row border-b last:border-b-0 align-top">
                      <td className="px-3 py-3 font-medium">{assignment.payer_display_name}</td>
                      <td className="px-3 py-3 font-medium">{assignment.payee_display_name}</td>
                      <td className="px-3 py-3 text-steel">{assignment.payee_bank_name ?? "-"}</td>
                      <td className="px-3 py-3 text-steel">{assignment.payee_deposit_account ?? "-"}</td>
                      <td className="px-3 py-3 font-semibold">{formatMoney(assignment.amount)}</td>
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
                    </tr>
                  ))}
                  {summary.assignments.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-3 py-8 text-sm text-steel">
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
