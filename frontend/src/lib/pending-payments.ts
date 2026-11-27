import type { SettlementAssignment } from "../types/api";

export const pendingStatuses = ["pending_proof", "proof_submitted", "rejected"] as const;
type PendingStatus = (typeof pendingStatuses)[number];

export const pendingStatusLabels: Record<PendingStatus, string> = {
  pending_proof: "Sin comprobante",
  proof_submitted: "Por validar",
  rejected: "Rechazado",
};

export type PendingPayment = SettlementAssignment & { status: PendingStatus };
export type PendingTotal = { status: PendingStatus; currency: string; count: number; amount: number };

export function getPendingReport(assignments: SettlementAssignment[], scope: { scope_type: string; scope_id: string }) {
  const rows = assignments.filter((row): row is PendingPayment =>
    row.scope_type === scope.scope_type && row.scope_id === scope.scope_id &&
    pendingStatuses.some((status) => status === row.status),
  );
  const grouped = new Map<string, PendingTotal>();
  for (const row of rows) {
    const currency = row.currency.toUpperCase();
    const key = `${row.status}:${currency}`;
    const total = grouped.get(key) ?? { status: row.status, currency, count: 0, amount: 0 };
    total.count++;
    // Accumulate exact cents, including when the API serializes a decimal as text.
    total.amount += Math.round(Number(row.amount) * 100);
    grouped.set(key, total);
  }
  return {
    rows,
    totals: Array.from(grouped.values(), (row) => ({ ...row, amount: row.amount / 100 }))
      .sort((a, b) => pendingStatuses.indexOf(a.status) - pendingStatuses.indexOf(b.status) || a.currency.localeCompare(b.currency)),
  };
}

export function paymentDateCdmx(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

export async function buildPendingPaymentsWorkbook(
  title: string,
  report: ReturnType<typeof getPendingReport>,
  now = new Date(),
) {
  const excel = await import("exceljs");
  const workbook = new (excel.default ?? excel).Workbook();
  workbook.creator = "El Quinielón";
  workbook.created = now;
  const summary = workbook.addWorksheet("Resumen");
  const detail = workbook.addWorksheet("Pendientes");
  const subtitle = `Corte: ${paymentDateCdmx(now.toISOString())} CDMX · Solo asignaciones sin confirmar`;
  const sheets = [
    { sheet: summary, title: `Pagos pendientes · ${title}`, widths: [30, 14, 16, 20], headers: ["Estado", "Moneda", "Movimientos", "Monto"] },
    { sheet: detail, title, widths: [30, 30, 16, 13, 22, 25, 25, 40], headers: ["Quién paga", "Quién recibe", "Monto", "Moneda", "Estado", "Comprobante (CDMX)", "Último cambio (CDMX)", "Folio del movimiento"] },
  ];
  for (const { sheet, title: sheetTitle, widths, headers } of sheets) {
    sheet.columns = widths.map((width) => ({ width }));
    sheet.mergeCells(1, 1, 1, headers.length);
    sheet.mergeCells(2, 1, 2, headers.length);
    sheet.getCell("A1").value = sheetTitle;
    sheet.getCell("A1").font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
    sheet.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF172554" } };
    sheet.getRow(1).height = 27;
    sheet.getCell("A2").value = subtitle;
    sheet.getCell("A2").font = { color: { argb: "FF475569" } };
    const header = sheet.getRow(4);
    header.values = headers;
    header.font = { bold: true, color: { argb: "FFFFFFFF" } };
    header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1D4ED8" } };
    sheet.views = [{ state: "frozen", ySplit: 4 }];
  }
  const currencyTotals = new Map<string, { count: number; cents: number }>();
  for (const row of report.totals) {
    summary.addRow([pendingStatusLabels[row.status], row.currency, row.count, row.amount]);
    const total = currencyTotals.get(row.currency) ?? { count: 0, cents: 0 };
    total.count += row.count;
    total.cents += Math.round(row.amount * 100);
    currencyTotals.set(row.currency, total);
  }
  for (const [currency, total] of currencyTotals) {
    summary.addRow(["Pendiente total", currency, total.count, total.cents / 100]).font = { bold: true };
  }
  summary.getColumn(4).numFmt = "#,##0.00";
  for (const row of report.rows) {
    // Names and folios are text cells, never formulas, hyperlinks, or bank details.
    detail.addRow([row.payer_display_name, row.payee_display_name, Number(row.amount), row.currency.toUpperCase(),
      pendingStatusLabels[row.status], paymentDateCdmx(row.proof_uploaded_at), paymentDateCdmx(row.updated_at), row.id]);
  }
  detail.getColumn(3).numFmt = "#,##0.00";
  detail.autoFilter = { from: "A4", to: `H${detail.rowCount}` };
  return workbook;
}
