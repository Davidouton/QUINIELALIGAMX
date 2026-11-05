import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);

function loadTypeScript(relativePath, mocks = {}) {
  const filename = new URL(relativePath, import.meta.url);
  const source = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  vm.runInNewContext(source, { exports, require: (name) => mocks[name] ?? require(name), Date, Intl }, { filename: filename.pathname });
  return exports;
}

const dates = loadTypeScript("../src/lib/datetime/mexico-city.ts");
const weekly = loadTypeScript("../src/lib/vip-weekly.ts");
const display = loadTypeScript("../src/lib/vip-display.ts");
const { VipCatalog } = loadTypeScript("../src/components/vip/vip-catalog.tsx", { "@/lib/vip-display": display });

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

test("VIP archive state is independent of financial settlement and weekly seasons", () => {
  const vip = { competition_kind: "weekly_pool", lifecycle_status: "active", season_name: null };
  assert.equal(display.isVipArchived(vip), false);
  assert.equal(display.isVipArchived({ ...vip, lifecycle_status: "settled" }), false);
  assert.equal(display.isVipArchived({ ...vip, is_archived: true }), true);
  assert.equal(display.isVipArchived({ ...vip, archived_at: "2026-11-04T00:00:00Z" }), true);
  assert.equal(display.isVipArchived({ ...vip, lifecycle_status: "archived" }), true);
  assert.equal(display.isVipArchived({ ...vip, season_visibility_status: "archived" }), false);
  assert.equal(display.isVipArchived({ ...vip, competition_kind: "matchday", season_visibility_status: "archived" }), true);
  assert.equal(display.vipContextLabel(vip), "Independiente · 10 juegos");
});

test("VIP catalog keeps names and selection compact; archived entries stay in their tab", () => {
  const activeName = "Quinielón Semanal especial para la primera semana de noviembre";
  const archivedName = "VIP del torneo anterior";
  const base = { mode: "Quinielón Semanal", context: "Independiente · 10 juegos", status: "Registro abierto", statusTone: "text-mint", fee: 100.5, pool: 1500, participants: 15 };
  const props = {
    items: [{ ...base, id: "current", name: activeName, archived: false }, { ...base, id: "old", name: archivedName, status: "Archivada", archived: true }],
    filter: "active", search: "", selectedId: "current", onFilterChange() {}, onSearchChange() {}, onSelect() {},
  };
  const active = renderToStaticMarkup(React.createElement(VipCatalog, props));
  assert.ok(active.includes(activeName));
  assert.ok(active.includes("Registro abierto"));
  assert.ok(active.includes("Seleccionada"));
  assert.ok(!active.includes("$100.5"));
  assert.ok(!active.includes(archivedName));
  const archived = renderToStaticMarkup(React.createElement(VipCatalog, { ...props, filter: "archived" }));
  assert.ok(archived.includes(archivedName));
  assert.ok(!archived.includes(activeName));
  const searched = renderToStaticMarkup(React.createElement(VipCatalog, { ...props, search: "quinielon" }));
  assert.ok(searched.includes(activeName));
});
