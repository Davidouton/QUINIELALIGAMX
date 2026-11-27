"use client";

import { useMemo, useState } from "react";
import { buildPendingPaymentsWorkbook, getPendingReport, paymentDateCdmx, pendingStatusLabels } from "@/lib/pending-payments";
import type { SettlementScopeSummary } from "@/types/api";

const labels = { season: "Quinielón", survivor: "Survivor", vip: "VIP" };

export function AdminPendingPayments({ summary, loading }: { summary: SettlementScopeSummary | null; loading: boolean }) {
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);
  const snapshot = useMemo(() => summary ? { report: getPendingReport(summary.assignments, summary), at: new Date() } : null, [summary]);

  async function download() {
    if (!summary || !snapshot?.report.rows.length || exporting) return;
    const { report, at } = snapshot;
    const label = labels[summary.scope_type as keyof typeof labels] ?? summary.scope_type;
    const title = `${summary.scope_label} · ${label}`;
    setExporting(true);
    setError("");
    try {
      const workbook = await buildPendingPaymentsWorkbook(title, report, at);
      const bytes = await workbook.xlsx.writeBuffer();
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const link = document.createElement("a");
      const slug = summary.scope_label.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "torneo";
      link.href = url;
      link.download = `Pagos_pendientes_${slug}_${summary.scope_type}_${paymentDateCdmx(at.toISOString()).slice(0, 10)}.xlsx`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setError("No se pudo descargar el Excel. Inténtalo de nuevo.");
    } finally {
      setExporting(false);
    }
  }

  const report = snapshot?.report;
  return (
    <section id="pagos-pendientes" aria-labelledby="pending-payments-title" className="space-y-4 rounded-[20px] border border-white/[0.08] bg-white/[0.03] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="pending-payments-title" className="text-lg font-semibold text-ink">Pagos pendientes por torneo</h2>
          <p className="mt-1 text-sm text-steel">
            {summary ? `${summary.scope_label} · ${labels[summary.scope_type as keyof typeof labels] ?? summary.scope_type}` : "Usa el selector de torneo de arriba."}
          </p>
        </div>
        <button type="button" onClick={() => void download()} disabled={loading || !report?.rows.length || exporting}
          className="app-pill px-4 text-sm">{exporting ? "Preparando Excel..." : "Descargar XLSX"}</button>
      </div>
      {error ? <p role="alert" className="text-sm text-coral">{error}</p> : null}
      {loading ? <p role="status" className="text-sm text-steel">Cargando pagos...</p> : null}
      {!loading && snapshot && report ? (
        <div className="space-y-3">
          <p className="text-sm text-steel">{report.rows.length} pendientes · Corte: {paymentDateCdmx(snapshot.at.toISOString())} CDMX</p>
          {report.rows.length ? (
            <>
              <div className="flex flex-wrap gap-2">
                {report.totals.map((row) => <span key={`${row.status}:${row.currency}`} className="rounded-lg border border-white/[0.08] px-3 py-2 text-xs text-ink">
                  {pendingStatusLabels[row.status]}: {row.count} · {row.amount.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {row.currency}
                </span>)}
              </div>
              <div className="overflow-x-auto">
                <table aria-label="Movimientos pendientes" className="w-full min-w-[620px] text-left text-sm">
                  <thead className="text-steel"><tr>
                    {["Quién paga", "Quién recibe", "Monto", "Estado", "Último cambio (CDMX)"].map((title) => <th key={title} scope="col" className="px-3 py-2">{title}</th>)}
                  </tr></thead>
                  <tbody>{report.rows.map((row) => <tr key={row.id} className="app-table-row border-b last:border-b-0">
                    <td className="px-3 py-2">{row.payer_display_name}</td><td className="px-3 py-2">{row.payee_display_name}</td>
                    <td className="px-3 py-2 font-semibold">{Number(row.amount).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {row.currency.toUpperCase()}</td>
                    <td className="px-3 py-2">{pendingStatusLabels[row.status]}</td>
                    <td className="px-3 py-2 text-steel">{paymentDateCdmx(row.updated_at) || "–"}</td>
                  </tr>)}</tbody>
                </table>
              </div>
            </>
          ) : <p className="text-sm text-steel">No hay pagos pendientes en este torneo.</p>}
        </div>
      ) : null}
    </section>
  );
}
