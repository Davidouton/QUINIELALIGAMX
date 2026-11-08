import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ExcelJS from "exceljs";
import ts from "typescript";

const require = createRequire(import.meta.url);

function loadTypeScript(path, mocks = {}) {
  const filename = new URL(path, import.meta.url);
  const source = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(source, { exports, require: (name) => mocks[name] ?? require(name), Date, Intl }, { filename: filename.pathname });
  return exports;
}

const dates = loadTypeScript("../src/lib/datetime/mexico-city.ts");
const { parseWorkbookDateTime, importedMatchTimes, importedMatchdayBounds } = loadTypeScript(
  "../src/lib/datetime/calendar-import.ts", { "./mexico-city": dates },
);

async function inEachTimeZone(check) {
  const previous = process.env.TZ;
  try {
    for (const zone of ["UTC", "America/Mexico_City", "America/Los_Angeles", "Asia/Tokyo"]) {
      process.env.TZ = zone;
      await check(zone);
    }
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
}

test("explicit UTC and offsets preserve the instant and seconds in any browser zone", async () => {
  await inEachTimeZone(() => {
    assert.equal(parseWorkbookDateTime("2026-11-08T18:00:45.123Z"), "2026-11-08T18:00:45.123Z");
    assert.equal(parseWorkbookDateTime("2026-11-08T12:00:45.123-06:00"), "2026-11-08T18:00:45.123Z");
    assert.equal(parseWorkbookDateTime("2026-11-08T23:30:45.123+0530"), "2026-11-08T18:00:45.123Z");
    assert.equal(parseWorkbookDateTime("2026-11-08 18:00Z"), "2026-11-08T18:00:00.000Z");
    assert.equal(dates.toMexicoCityInputValue(parseWorkbookDateTime("2026-11-08T18:00:00Z")), "2026-11-08T12:00");
  });
});

test("dates without a zone use Mexico City's wall clock including date rollover", async () => {
  await inEachTimeZone(() => {
    assert.equal(parseWorkbookDateTime("2026-11-08 12:00"), "2026-11-08T18:00:00.000Z");
    assert.equal(parseWorkbookDateTime(" 2026-11-08T23:55:30.125 "), "2026-11-09T05:55:30.125Z");
    assert.equal(parseWorkbookDateTime("2028-02-29T20:00"), "2028-03-01T02:00:00.000Z");
  });
});

test("real XLSX Date cells retain their displayed clock while ISO text retains its zone", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Calendario");
  sheet.getCell("A1").value = new Date("2026-11-08T18:00:00Z");
  sheet.getCell("A1").numFmt = "yyyy-mm-dd hh:mm";
  sheet.getCell("B1").value = "2026-11-08T18:00:00Z";
  sheet.getCell("C1").value = "2026-11-08 18:00";
  const buffer = await workbook.xlsx.writeBuffer();

  await inEachTimeZone(async () => {
    const loaded = new ExcelJS.Workbook();
    await loaded.xlsx.load(buffer);
    const row = loaded.getWorksheet("Calendario").getRow(1);
    assert.ok(row.getCell(1).value instanceof Date);
    assert.equal(parseWorkbookDateTime(row.getCell(1).value), "2026-11-09T00:00:00.000Z");
    assert.equal(parseWorkbookDateTime(row.getCell(2).value), "2026-11-08T18:00:00.000Z");
    assert.equal(parseWorkbookDateTime(row.getCell(3).value), "2026-11-09T00:00:00.000Z");
  });
});

test("formula results and text cells use the same parsing rules, with optional blanks", () => {
  assert.equal(parseWorkbookDateTime({ formula: "A1", result: new Date("2026-11-08T12:00:00Z") }), "2026-11-08T18:00:00.000Z");
  assert.equal(parseWorkbookDateTime({ text: "2026-11-08T12:00-06:00" }), "2026-11-08T18:00:00.000Z");
  for (const value of [null, undefined, "", "   ", { formula: "A1", result: "" }]) {
    assert.equal(parseWorkbookDateTime(value), "");
  }
});

test("impossible dates and malformed zones fail instead of rolling over or losing a suffix", () => {
  for (const value of [
    "2026-02-29T12:00", "2026-02-29T12:00Z", "2026-11-31T12:00-06:00",
    "2026-00-08T12:00", "2026-13-08T12:00", "2026-11-00T12:00", "2026-11-08T24:00",
    "2026-11-08T12:60Z", "2026-11-08T12:00:60Z", "2026-11-08T12:00+24:00",
    "2026-11-08T12:00-06:60", "2026-11-08T12:00 UTC", "2026-11-08T12:00Z suffix",
    "08/11/2026 12:00", "2026-11-08", 46334, true, new Date("invalid"),
  ]) {
    assert.throws(() => parseWorkbookDateTime(value), undefined, String(value));
  }
});

test("default locks subtract absolute minutes and can cross the previous CDMX day", async () => {
  await inEachTimeZone(() => {
    const times = importedMatchTimes("2026-11-08T00:05", "", 10);
    assert.equal(times.kickoff_at, "2026-11-08T06:05:00.000Z");
    assert.equal(times.picks_lock_at, "2026-11-08T05:55:00.000Z");
    assert.equal(dates.toMexicoCityInputValue(times.picks_lock_at), "2026-11-07T23:55");
    assert.equal(importedMatchTimes("2026-11-08T00:05Z", null, 20).picks_lock_at, "2026-11-07T23:45:00.000Z");
    assert.equal(importedMatchTimes("2026-11-08T12:00Z", "", 0).picks_lock_at, "2026-11-08T12:00:00.000Z");
    assert.equal(importedMatchTimes("2026-11-08T12:00Z", "", -30).picks_lock_at, "2026-11-08T12:30:00.000Z");
  });
});

test("explicit locks preserve their instant, including existing admin reopening rules", () => {
  assert.equal(importedMatchTimes("2026-11-08T18:00Z", "2026-11-08T11:15-06:00", 10).picks_lock_at, "2026-11-08T17:15:00.000Z");
  assert.equal(importedMatchTimes("2026-11-08T18:00Z", "2026-11-08 11:55", 10).picks_lock_at, "2026-11-08T17:55:00.000Z");
  assert.throws(() => importedMatchTimes("", "", 10), /Falta fecha/);
  assert.equal(importedMatchTimes("2026-11-08T18:00Z", "2026-11-08T18:01Z", 10).picks_lock_at, "2026-11-08T18:01:00.000Z");
  assert.throws(() => importedMatchTimes("2026-11-08T18:00Z", "invalid", 10));
  for (const offset of [-1_000_001, 1_000_001, 0.5, NaN, Infinity]) {
    assert.throws(() => importedMatchTimes("2026-11-08T18:00Z", "", offset));
  }
});

test("matchday bounds use the earliest and latest instants across mixed offsets and days", async () => {
  await inEachTimeZone(() => {
    const bounds = importedMatchdayBounds([
      "2026-11-08T20:30-06:00", "2026-11-08T18:00:00Z", "2026-11-08 15:25",
    ]);
    assert.equal(bounds.starts_at, "2026-11-08T18:00:00.000Z");
    assert.equal(bounds.ends_at, "2026-11-09T05:30:00.000Z");
    assert.throws(() => importedMatchdayBounds(["2026-11-08T18:00Z", "2026-11-31T18:00Z"]));
    assert.throws(() => importedMatchdayBounds([]));
    assert.throws(() => importedMatchdayBounds([""]));
  });
});
