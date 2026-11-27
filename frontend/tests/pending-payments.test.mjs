import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const source = ts.transpileModule(readFileSync(new URL("../src/lib/pending-payments.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText;
const moduleExports = {};
vm.runInThisContext(`(function(exports, require) { ${source}\n })`)(moduleExports, require);
const { buildPendingPaymentsWorkbook, getPendingReport, paymentDateCdmx } = moduleExports;

const scope = { scope_type: "season", scope_id: "id" };
const item = (id, status, amount, extra = {}) => ({
  ...scope, id, status, amount, currency: "mxn",
  payer_display_name: "=1+1", payee_display_name: "Persona B",
  proof_uploaded_at: null, updated_at: "2026-11-28T01:15:00Z",
  payee_deposit_account: "omit-bank", proof_note: "omit-note",
  proof_image_url: "https://example.test/omit-proof", ...extra,
});

test("non-confirmed assignments only, isolated by scope and grouped by status and currency", () => {
  const report = getPendingReport([
    item("1", "pending_proof", "10.12"), item("2", "pending_proof", 0.19),
    item("3", "proof_submitted", 25), item("4", "rejected", 15, { currency: "usd" }),
    item("5", "confirmed", 1000), item("6", "pending_proof", 5000, { scope_type: "survivor" }),
    item("7", "pending_proof", 5000, { scope_id: "other" }),
  ], scope);
  assert.deepEqual(report.rows.map((x) => x.id), ["1", "2", "3", "4"]);
  assert.deepEqual(report.totals, [
    { status: "pending_proof", currency: "MXN", count: 2, amount: 10.31 },
    { status: "proof_submitted", currency: "MXN", count: 1, amount: 25 },
    { status: "rejected", currency: "USD", count: 1, amount: 15 },
  ]);
  assert.deepEqual(getPendingReport([item("5", "confirmed", 1000)], scope), { rows: [], totals: [] });
});

test("CDMX cutoff across UTC day boundary", () => {
  assert.equal(paymentDateCdmx("2026-11-28T01:15:00Z"), "2026-11-27 19:15");
  assert.equal(paymentDateCdmx(null), "");
});

test("downloads a true workbook with numeric totals and no bank details, links or formula cells", async () => {
  const report = getPendingReport([
    item("1", "pending_proof", 10.25), item("2", "proof_submitted", 20.10),
    item("3", "rejected", 8, { currency: "USD" }), item("4", "confirmed", 200),
  ], scope);
  const built = await buildPendingPaymentsWorkbook("Apertura 2026 · Quinielón", report);
  const opened = new ExcelJS.Workbook();
  await opened.xlsx.load(await built.xlsx.writeBuffer());
  assert.deepEqual(opened.worksheets.map((s) => s.name), ["Resumen", "Pendientes"]);
  assert.deepEqual(opened.getWorksheet("Resumen").getRow(8).values.slice(1), ["Pendiente total", "MXN", 2, 30.35]);
  const detail = opened.getWorksheet("Pendientes");
  assert.equal(detail.rowCount, 7);
  assert.equal(detail.getCell("C5").value, 10.25);
  assert.equal(detail.getCell("A5").value, "=1+1");
  assert.equal(detail.getCell("A5").type, ExcelJS.ValueType.String);
  for (const sheet of opened.worksheets) {
    sheet.eachRow((r) => assert.doesNotMatch(JSON.stringify(r.values), /omit-bank|omit-note|omit-proof/));
  }
});
