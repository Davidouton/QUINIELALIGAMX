"use client";

import { useEffect, useState } from "react";

import { backendFetch } from "@/lib/api/backend";
import { formatMexicoCityDateTime } from "@/lib/datetime/mexico-city";
import { getBrowserAccessToken } from "@/lib/supabase/session";
import type { OddsPullResult, OddsSnapshotOption } from "@/types/api";

const LAST_ODDS_RESULT_KEY = "qm-admin-odds-last-result";
const GAME_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Mexico_City",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function getGameDateKey(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return GAME_DATE_FORMATTER.format(date);
}

function formatAmericanAsDecimal(value: string | null) {
  if (!value) {
    return "-";
  }

  const american = Number(value);
  if (!Number.isFinite(american) || american === 0) {
    return value;
  }

  const decimal = american > 0 ? american / 100 + 1 : 100 / Math.abs(american) + 1;
  return decimal.toFixed(2);
}

export function AdminOddsPanel() {
  const [loading, setLoading] = useState(false);
  const [loadingSaved, setLoadingSaved] = useState(true);
  const [reloadingSaved, setReloadingSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<OddsPullResult | null>(null);
  const [snapshots, setSnapshots] = useState<OddsSnapshotOption[]>([]);
  const [selectedSnapshotDate, setSelectedSnapshotDate] = useState("latest");
  const [fromGameDate, setFromGameDate] = useState("all");
  const [toGameDate, setToGameDate] = useState("all");

  async function loadSnapshotResult(accessToken: string, snapshotDate?: string) {
    const query = snapshotDate ? `?snapshot_date=${encodeURIComponent(snapshotDate)}` : "";
    return await backendFetch<OddsPullResult>(`/admin/odds/latest${query}`, accessToken);
  }

  async function loadSnapshotOptions(accessToken: string) {
    return await backendFetch<OddsSnapshotOption[]>("/admin/odds/snapshots", accessToken);
  }

  function buildSnapshotMessage(nextResult: OddsPullResult) {
    if (!nextResult.snapshot_date) {
      return nextResult.pull_output || "Todavia no hay snapshot guardado en la tabla raw.";
    }

    return `Snapshot ${nextResult.snapshot_date}: ${nextResult.raw_rows_processed ?? 0} rows raw cargadas desde Supabase.`;
  }

  function persistResult(nextResult: OddsPullResult) {
    if (!nextResult.snapshot_date) {
      return;
    }

    window.localStorage.setItem(LAST_ODDS_RESULT_KEY, JSON.stringify(nextResult));
  }

  function applySnapshotResult(nextResult: OddsPullResult) {
    setResult(nextResult);
    setMessage(buildSnapshotMessage(nextResult));
    persistResult(nextResult);
  }

  async function refreshSavedSnapshot(snapshotDate?: string) {
    const accessToken = await getBrowserAccessToken();
    const [snapshotOptions, nextResult] = await Promise.all([
      loadSnapshotOptions(accessToken),
      loadSnapshotResult(accessToken, snapshotDate),
    ]);

    setSnapshots(snapshotOptions);
    setSelectedSnapshotDate(snapshotDate ?? nextResult.snapshot_date ?? "latest");
    applySnapshotResult(nextResult);
  }

  useEffect(() => {
    let cancelled = false;

    async function loadSavedResult() {
      try {
        if (cancelled) {
          return;
        }

        await refreshSavedSnapshot();
        if (cancelled) {
          return;
        }
      } catch (caughtError) {
        if (!cancelled) {
          setError(
            caughtError instanceof Error
              ? caughtError.message
              : "No se pudo cargar el snapshot guardado desde la tabla raw",
          );
        }
      } finally {
        if (!cancelled) {
          setLoadingSaved(false);
        }
      }

      try {
        const rawValue = window.localStorage.getItem(LAST_ODDS_RESULT_KEY);
        if (!rawValue || cancelled) {
          return;
        }

        const parsed = JSON.parse(rawValue) as OddsPullResult;
        setResult(parsed);
        setMessage(
          `Mostrando el ultimo snapshot guardado localmente: ${parsed.raw_rows_processed ?? 0} rows raw, ${parsed.matched ?? 0} ligados, ${parsed.unmatched ?? 0} pendientes.`,
        );
      } catch {
        window.localStorage.removeItem(LAST_ODDS_RESULT_KEY);
      }
    }

    void loadSavedResult();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!result?.snapshot_date) {
      return;
    }

    persistResult(result);
  }, [result]);

  useEffect(() => {
    const nextDates = Array.from(new Set((result?.preview_rows ?? []).map((row) => getGameDateKey(row.match_date))))
      .filter(Boolean)
      .sort();

    if (fromGameDate !== "all" && !nextDates.includes(fromGameDate)) {
      setFromGameDate("all");
    }

    if (toGameDate !== "all" && !nextDates.includes(toGameDate)) {
      setToGameDate("all");
    }
  }, [result, fromGameDate, toGameDate]);

  async function handlePullOdds() {
    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      const accessToken = await getBrowserAccessToken();
      const nextResult = await backendFetch<OddsPullResult>("/admin/odds/pull", accessToken, {
        method: "POST",
        timeoutMs: 180000,
      });
      setFromGameDate("all");
      setToGameDate("all");
      setSelectedSnapshotDate(nextResult.snapshot_date ?? "latest");
      await refreshSavedSnapshot(nextResult.snapshot_date ?? undefined);
      setMessage(
        `Odds cargados: ${nextResult.raw_rows_processed ?? 0} rows raw, ${nextResult.matched ?? 0} ligados, ${nextResult.unmatched ?? 0} pendientes.`,
      );
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudieron bajar los odds");
    } finally {
      setLoading(false);
    }
  }

  async function handleReloadSaved() {
    setReloadingSaved(true);
    setError(null);
    setMessage(null);

    try {
      await refreshSavedSnapshot(selectedSnapshotDate === "latest" ? undefined : selectedSnapshotDate);
      setFromGameDate("all");
      setToGameDate("all");
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "No se pudo recargar el snapshot guardado desde la tabla raw",
      );
    } finally {
      setReloadingSaved(false);
    }
  }

  const gameDates = Array.from(new Set((result?.preview_rows ?? []).map((row) => getGameDateKey(row.match_date))))
    .filter(Boolean)
    .sort();
  const visibleRows = (result?.preview_rows ?? []).filter((row) => {
    const gameDate = getGameDateKey(row.match_date);
    if (!gameDate) {
      return false;
    }

    if (fromGameDate !== "all" && gameDate < fromGameDate) {
      return false;
    }

    if (toGameDate !== "all" && gameDate > toGameDate) {
      return false;
    }

    return true;
  });

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-ink">Get odds</h2>
          <p className="mt-2 max-w-2xl text-sm text-steel">
            Jala The Odds API, guarda el raw de Liga MX a 3-6 dias y luego lo liga contra la
            app. Si el juego ya existe, solo reescribe sus odds. Si no existe, crea el partido
            automaticamente.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void handleReloadSaved()}
            disabled={reloadingSaved || loadingSaved}
            className="app-pill px-4 disabled:opacity-60"
          >
            {reloadingSaved ? "Recargando..." : "Recargar guardado"}
          </button>
          <button
            type="button"
            onClick={() => void handlePullOdds()}
            disabled={loading}
            className="app-pill-active px-4 disabled:opacity-60"
          >
            {loading ? "Bajando..." : "Get odds"}
          </button>
        </div>
      </div>

      {loadingSaved ? <p className="mt-5 text-sm text-steel">Cargando ultimo snapshot guardado...</p> : null}
      {message ? <p className="mt-5 text-sm text-moss">{message}</p> : null}
      {error ? <p className="mt-5 text-sm text-coral">{error}</p> : null}

      {snapshots.length > 0 ? (
        <div className="mt-5 flex flex-wrap items-end gap-4">
          <label className="space-y-2 text-sm">
            <span className="text-steel">Snapshot</span>
            <select
              value={selectedSnapshotDate}
              onChange={(event) => setSelectedSnapshotDate(event.target.value)}
              className="field-control min-w-52"
            >
              <option value="latest">Ultimo disponible</option>
              {snapshots.map((snapshot) => (
                <option key={snapshot.snapshot_date} value={snapshot.snapshot_date}>
                  {snapshot.snapshot_date} · {snapshot.raw_rows_processed} rows
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}

      {gameDates.length > 0 ? (
        <div className="mt-5 flex flex-wrap items-end gap-4">
          <label className="space-y-2 text-sm">
            <span className="text-steel">Desde</span>
            <select
              value={fromGameDate}
              onChange={(event) => setFromGameDate(event.target.value)}
              className="field-control min-w-52"
            >
              <option value="all">Inicio abierto</option>
              {gameDates.map((gameDate) => (
                <option key={gameDate} value={gameDate}>
                  {gameDate}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-2 text-sm">
            <span className="text-steel">Hasta</span>
            <select
              value={toGameDate}
              onChange={(event) => setToGameDate(event.target.value)}
              className="field-control min-w-52"
            >
              <option value="all">Fin abierto</option>
              {gameDates.map((gameDate) => (
                <option key={gameDate} value={gameDate}>
                  {gameDate}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}

      {result ? (
        <div className="space-y-4">
          <p className="font-medium text-ink">Snapshot {result.snapshot_date ?? "sin fecha detectada"}</p>
          <p className="mt-2 text-sm text-steel">
            {result.raw_rows_processed ?? 0} filas raw · {result.matched ?? 0} ligadas ·{" "}
            {result.unmatched ?? 0} pendientes
          </p>
          {visibleRows.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm text-steel">
                <thead className="app-table-head">
                  <tr>
                    <th className="px-4 py-3">Fecha</th>
                    <th className="px-4 py-3">Local</th>
                    <th className="px-4 py-3">Visitante</th>
                    <th className="px-4 py-3">ML Home</th>
                    <th className="px-4 py-3">ML Draw</th>
                    <th className="px-4 py-3">ML Away</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((row) => (
                    <tr key={`${row.match_date}-${row.home_team}-${row.away_team}`} className="app-table-row border-b last:border-b-0">
                      <td className="px-4 py-3">{formatMexicoCityDateTime(row.match_date)}</td>
                      <td className="px-4 py-3">{row.home_team}</td>
                      <td className="px-4 py-3">{row.away_team}</td>
                      <td className="px-4 py-3">{formatAmericanAsDecimal(row.ml_home)}</td>
                      <td className="px-4 py-3">{formatAmericanAsDecimal(row.ml_draw)}</td>
                      <td className="px-4 py-3">{formatAmericanAsDecimal(row.ml_away)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-4 text-sm text-steel">No hay rows para mostrar en este snapshot.</p>
          )}
          <details className="mt-4 text-sm text-steel">
            <summary className="cursor-pointer text-ink">Ver salida tecnica</summary>
            <pre className="mt-3 overflow-x-auto whitespace-pre-wrap bg-white/[0.03] px-4 py-3 text-xs text-steel">
              {result.pull_output}
              {"\n\n"}
              {result.sync_output}
            </pre>
          </details>
        </div>
      ) : !loadingSaved ? (
        <div className="mt-6 px-1 text-sm text-steel">
          No se pudo cargar ningun snapshot guardado todavia.
        </div>
      ) : null}
    </section>
  );
}
