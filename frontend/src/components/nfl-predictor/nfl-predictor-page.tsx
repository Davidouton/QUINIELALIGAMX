"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { backendFetch } from "@/lib/api/backend";
import { getBrowserAccessToken } from "@/lib/supabase/session";
import { formatMexicoCityDateTime } from "@/lib/datetime/mexico-city";

import { KellyReport } from "./kelly-report";

type Bet = {
  Mercado: string; Seleccion: string; Linea: number | null; Momio: number | null;
  Prob_ganar: number | null; Prob_push: number | null; EV_por_unidad: number | null;
};
type Game = {
  Game_ID: string; season: number; week: number; home_team: string; away_team: string;
  kickoff_at: string | null; home_points: number | null; away_points: number | null;
  lambda_home?: number; lambda_away?: number; odds_captured_at?: string;
};
type Prediction = { payload: Game; game: Game; bets: Bet[]; run_id: string; started_at: string };
type Run = {
  id: string; status: string; started_at: string; stage: string;
  details: { reason?: string; season?: number; week?: number; games?: number; epa_coverage?: Record<string, number> };
};
type Response = {
  predictions: Prediction[]; runs: Run[]; periods: { season: number; week: number }[];
};
const percent = (n: number | null | undefined) => n == null ? "—" : `${(n * 100).toFixed(1)}%`;
const quote = (n: number | null) => n == null ? "—" : n >= 100 ? `+${n}` : `${n}`;
const states: Record<string, string> = { complete: "Actualizado", failed: "Falló la actualización", running: "Actualizando", skipped: "Sin jornada próxima" };
const stages: Record<string, string> = { starting: "Iniciando", schedule: "Calendario y resultados", play_by_play: "Estadísticas por jugada", odds: "Líneas", predict: "Calculando probabilidades", interrupted: "Ejecución interrumpida" };

function LivePredictions() {
  const [data, setData] = useState<Response | null>(null);
  const [period, setPeriod] = useState("");
  const [market, setMarket] = useState("ALL");
  const [positiveOnly, setPositiveOnly] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const token = await getBrowserAccessToken();
      if (!token) throw new Error("Inicia sesión para consultar NFL Predictor.");
      const query = period ? `?season=${period.split(":")[0]}&week=${period.split(":")[1]}` : "";
      const response = await backendFetch<Response>(`/nfl-predictor${query}`, token, { signal });
      if (signal?.aborted) return;
      setData(response); setError("");
      if (!period && response.predictions.length) {
        const sorted = [...response.predictions].sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at));
        const newest = sorted[0].payload;
        setPeriod(`${newest.season}:${newest.week}`);
      }
    } catch (e) {
      if (!signal?.aborted) setError(e instanceof Error ? e.message : "No se pudo cargar el predictor.");
    } finally { if (!signal?.aborted) setLoading(false); }
  }, [period]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    const interval = setInterval(() => { void load(controller.signal); }, 60000);
    return () => { controller.abort(); clearInterval(interval); };
  }, [load]);

  const predictions = useMemo(() => [...(data?.predictions ?? [])].sort((a, b) =>
    (a.game.kickoff_at ?? "").localeCompare(b.game.kickoff_at ?? "")), [data]);
  const latestRun = data?.runs[0];
  const positiveCount = predictions.flatMap(p => p.bets).filter(b => (b.EV_por_unidad ?? -1) > 0).length;
  const lastPublished = predictions.length ? predictions.reduce((latest, p) => p.started_at > latest ? p.started_at : latest, "") : null;

  return <section className="space-y-6">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <p className="text-xs uppercase tracking-[0.25em] text-steel">Quiniela · Análisis NFL</p>
        <h1 className="page-title mt-2">NFL Predictor</h1>
        <p className="mt-2 max-w-2xl text-sm text-steel">Probabilidades y líneas por jornada. El modelo se actualiza automáticamente con resultados y estadísticas de los equipos.</p>
      </div>
      <button type="button" className="app-pill px-4" disabled={loading} onClick={() => void load()}>{loading ? "Cargando…" : "Actualizar vista"}</button>
    </header>

    {error && <div role="alert" className="rounded-xl border border-red-400/30 bg-red-400/10 p-4 text-sm text-ink">{error}</div>}
    <div className="grid gap-3 sm:grid-cols-3">
      {[ ["Partidos analizados", String(predictions.length)], ["Selecciones con EV positivo", String(positiveCount)],
        ["Última ejecución", latestRun ? states[latestRun.status] ?? latestRun.status : "Pendiente"] ].map(([label, value]) =>
        <div key={label} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5"><p className="text-xs text-steel">{label}</p><p className="mt-2 text-xl font-semibold text-ink">{value}</p></div>)}
    </div>
    {latestRun && <p className="text-xs text-steel" aria-live="polite">
      {formatMexicoCityDateTime(latestRun.started_at)} · {stages[latestRun.stage] ?? latestRun.stage}
      {latestRun.status === "failed" ? ". Se conservan los últimos pronósticos publicados; la actualización requiere revisión." : ""}
      {latestRun.details.reason ? ` · ${latestRun.details.reason}` : ""}
      {lastPublished ? ` · Pronósticos publicados: ${formatMexicoCityDateTime(lastPublished)}` : ""}
    </p>}

    <div className="flex flex-wrap items-end gap-4 rounded-2xl border border-white/10 p-4">
      <label className="text-xs text-steel">Temporada / semana
        <select value={period} onChange={e => { setPeriod(e.target.value); setData(current => current ? { ...current, predictions: [] } : null); }} className="mt-1 block rounded-lg border border-white/15 bg-slate-900 p-2 text-sm text-white">
          <option value="">Últimas predicciones</option>
          {data?.periods.map(p => <option key={`${p.season}:${p.week}`} value={`${p.season}:${p.week}`}>{p.season} · Semana {p.week}</option>)}
        </select>
      </label>
      <label className="text-xs text-steel">Mercado
        <select value={market} onChange={e => setMarket(e.target.value)} className="mt-1 block rounded-lg border border-white/15 bg-slate-900 p-2 text-sm text-white">
          <option value="ALL">Todos</option><option value="ML">Ganador</option><option value="ATS">Spread / ATS</option><option value="TOTAL">Totales</option>
        </select>
      </label>
      <label className="flex items-center gap-2 py-2 text-sm text-ink"><input type="checkbox" checked={positiveOnly} onChange={e => setPositiveOnly(e.target.checked)} />Solo EV positivo</label>
    </div>

    {!predictions.length && !loading && !error && <div className="rounded-2xl border border-dashed border-white/20 p-10 text-center">
      <h2 className="text-lg font-semibold text-ink">Todavía no hay pronósticos publicados</h2>
      <p className="mt-2 text-sm text-steel">El pipeline publicará las probabilidades cuando tenga los datos y líneas de una jornada próxima. También puedes consultar otra semana.</p>
    </div>}

    <div className="grid gap-5 xl:grid-cols-2">{predictions.map(prediction => {
      const game = prediction.game;
      const settled = game.home_points != null && game.away_points != null;
      const started = game.kickoff_at != null && Date.parse(game.kickoff_at) <= Date.now();
      const bets = prediction.bets.filter(b => (market === "ALL" || b.Mercado === market) && (!positiveOnly || (b.EV_por_unidad ?? -1) > 0));
      return <article key={prediction.payload.Game_ID} className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02]">
        <div className="border-b border-white/10 p-5">
          <div className="flex items-center justify-between gap-2 text-xs text-steel"><span>{game.kickoff_at ? formatMexicoCityDateTime(game.kickoff_at) : "Horario pendiente"}</span><span>{settled ? "Finalizado" : started ? "En curso / por confirmar" : "Próximo"}</span></div>
          <h2 className="mt-3 text-xl font-semibold text-ink">{game.away_team} <span className="mx-2 font-normal text-steel">en</span> {game.home_team}</h2>
          <p className="mt-2 text-sm text-steel">{settled ? `Resultado: ${game.away_team} ${game.away_points} – ${game.home_points} ${game.home_team}` : `Proyección: ${prediction.payload.lambda_away?.toFixed(1) ?? "—"} – ${prediction.payload.lambda_home?.toFixed(1) ?? "—"}`}</p>
          <p className="mt-2 text-xs text-steel">Cuotas consultadas: {formatMexicoCityDateTime(prediction.payload.odds_captured_at ?? prediction.started_at)}{started ? " · Pronóstico guardado antes del partido" : ""}</p>
        </div>
        <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-xs text-steel"><tr>
          {["Selección", "Línea", "Momio", "Prob.", "EV"].map(h => <th key={h} className="px-4 py-3">{h}</th>)}
        </tr></thead><tbody>{bets.map(b => <tr key={`${b.Mercado}:${b.Seleccion}`} className="border-t border-white/5 text-ink">
          <td className="px-4 py-3"><span className="mr-2 text-[10px] text-steel">{b.Mercado}</span>{b.Seleccion}</td>
          <td className="px-4 py-3">{b.Linea ?? "—"}</td><td className="px-4 py-3">{quote(b.Momio)}</td><td className="px-4 py-3">{percent(b.Prob_ganar)}</td>
          <td className={`px-4 py-3 ${(b.EV_por_unidad ?? -1) > 0 ? "font-semibold text-emerald-400" : "text-steel"}`}>{b.EV_por_unidad != null && b.EV_por_unidad > 0 ? "+" : ""}{percent(b.EV_por_unidad)}</td>
        </tr>)}</tbody></table></div>
        {!bets.length && <p className="p-5 text-sm text-steel">Sin selecciones para este filtro.</p>}
      </article>;
    })}</div>
    <p className="text-xs text-steel">EV es el valor esperado por unidad según el modelo, incluyendo devolución por empate de línea. Las cuotas pueden cambiar; un EV positivo no garantiza ganancias. Las probabilidades ML contemplan la aproximación de empate del modelo.</p>
  </section>;
}

export function NFLPredictorPage() {
  const [view, setView] = useState<"report" | "live">("report");
  return <div className="space-y-6">
    <header><p className="text-xs uppercase tracking-[.25em] text-steel">Quiniela+ · Super admin</p><h1 className="page-title mt-2">Predictor NFL</h1></header>
    <div className="tab-list" aria-label="Vista del predictor">
      <button className={view === "report" ? "tab-control tab-control-active" : "tab-control"} onClick={() => setView("report")}>Reporte Kelly</button>
      <button className={view === "live" ? "tab-control tab-control-active" : "tab-control"} onClick={() => setView("live")}>Pronósticos actuales</button>
    </div>
    {view === "report" ? <KellyReport /> : <LivePredictions />}
  </div>;
}
