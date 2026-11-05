import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);

function loadTypeScript(relativePath) {
  const filename = new URL(relativePath, import.meta.url);
  const source = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(source, { exports, require, Date, Intl }, { filename: filename.pathname });
  return exports;
}

const dates = loadTypeScript("../src/lib/datetime/mexico-city.ts");
const weekly = loadTypeScript("../src/lib/vip-weekly.ts");

test("CDMX inputs convert to UTC without using the browser timezone", () => {
  const previous = process.env.TZ;
  try {
    for (const timeZone of ["UTC", "America/Mexico_City", "America/Los_Angeles", "Asia/Tokyo"]) {
      process.env.TZ = timeZone;
      assert.equal(dates.fromMexicoCityInputValue("2026-11-07T20:00"), "2026-11-08T02:00:00.000Z");
      assert.equal(dates.fromMexicoCityInputValue("2026-11-07T00:00"), "2026-11-07T06:00:00.000Z");
    }
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

test("date input roundtrips through Mexico City and rejects impossible calendar dates", () => {
  assert.equal(dates.toMexicoCityInputValue("2026-11-08T02:00:00.000Z"), "2026-11-07T20:00");
  assert.equal(dates.fromMexicoCityInputValue("2028-02-29T09:30"), "2028-02-29T15:30:00.000Z");
  for (const value of ["", "2026-02-29T09:30", "2026-11-31T09:30", "2026-13-01T09:30", "2026-11-01T24:30", "2026-11-01T09:60", "2026-11-01T09:30Z"]) {
    assert.equal(dates.fromMexicoCityInputValue(value), null, value);
  }
});

test("each match closes at its exact server deadline, independently of other matches", () => {
  const first = { lock_at: "2026-11-08T01:50:00Z", is_locked: false };
  const second = { lock_at: "2026-11-08T03:50:00Z", is_locked: false };
  const deadline = Date.parse(first.lock_at);
  assert.equal(weekly.weeklyMatchIsLocked(first, deadline - 1), false);
  assert.equal(weekly.weeklyMatchIsLocked(first, deadline), true);
  assert.equal(weekly.weeklyMatchIsLocked(second, deadline), false);
  assert.equal(weekly.weeklyMatchIsLocked({ ...first, is_locked: true }, deadline - 1), true);
  assert.equal(weekly.weeklyMatchIsLocked({ lock_at: "invalid", is_locked: false }, deadline), true);
});

test("goal entries preserve zero and accept only integer totals from zero to 99", () => {
  assert.equal(weekly.weeklyGoalValue("0"), 0);
  assert.equal(weekly.weeklyGoalValue("99"), 99);
  for (const value of ["", "-1", "1.5", "100", "1e1", " 1", "1 ", "NaN"]) {
    assert.equal(weekly.weeklyGoalValue(value), null, value);
  }
});

test("a score is pending until both values exist, and a scoreless draw counts", () => {
  assert.equal(weekly.weeklyMatchResult({ home_score: null, away_score: null }), null);
  assert.equal(weekly.weeklyMatchResult({ home_score: 0, away_score: null }), null);
  assert.equal(weekly.weeklyMatchResult({ home_score: 0, away_score: 0 }), "draw");
  assert.equal(weekly.weeklyMatchResult({ home_score: 2, away_score: 1 }), "home");
  assert.equal(weekly.weeklyMatchResult({ home_score: 0, away_score: 1 }), "away");
});
