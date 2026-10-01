"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, TrendingUp } from "lucide-react";
import { backendFetch } from "@/lib/api/backend";
import { getBrowserAccessToken } from "@/lib/supabase/session";

type Row = {
  game_id: string; season: number; week: number; date: string; home: string; away: string;
  market: string; selection: string; line: number | null; base: number | null;
  probability: number | null; odds: number | null; ev: number | null; kelly: number | null;
  stake: number | null; profit: number | null; outcome: string; cumulative: number;
};
type Report = {
  comparison?: { games: number; duplicate_excel_rows: number; engine: { profit: number; staked?: number; pushes?: number; no_entry?: number; roi: number | null; wins: number; losses: number; entries: number }; original: { profit: number; staked?: number; pushes?: number; no_entry?: number; roi: number | null; wins: number; losses: number; entries: number } } | null;
  rows: Row[]; periods: { season: number; week: number }[];
  source: { metadata: { filename: string }; imported_at: string } | null;
  summary: { profit: number; staked: number; wins: number; losses: number; pushes: number; roi: number | null; win_rate: number | null };
};
const markets = [ ["ML", "Moneyline"], ["ATS", "Spread"], ["TOTAL", "Totales"], ["CONTRA_ATS", "Contra spread"], ["CONTRA_TOTAL", "Contra total"] ];
const money = (value: number | null | undefined) => value == null ? "—" : new Intl.NumberFormat("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
const percent = (value: number | null | undefined) => value == null ? "—" : `${(value * 100).toFixed(1)}%`;
const shortMoney = (value: number) => new Intl.NumberFormat("es-MX", { notation: "compact", maximumFractionDigits: 1 }).format(value);
const dateLabel = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "2-digit" });
const selectClass = "mt-2 w-full rounded-xl border border-white/15 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-400";

function ProfitChart({ rows }: { rows: Row[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 1000, height = 280, left = 75, right = 20, top = 20, bottom = 38;
  const values = [0, ...rows.map(r => r.cumulative)];
  const min = Math.min(0, ...values), max = Math.max(0, ...values);
  const pad = Math.max((max - min) * .12, 1);
  const lo = min - pad, hi = max + pad;
  const x = (i: number) => left + (i / Math.max(rows.length, 1)) * (width - left - right);
  const y = (value: number) => top + ((hi - value) / (hi - lo)) * (height - top - bottom);
  const path = values.map((value, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(value).toFixed(1)}`).join(" ");
  const fill = `${path} L${x(rows.length)},${y(0)} L${x(0)},${y(0)} Z`;
  const active = hover != null ? rows[Math.min(hover, rows.length - 1)] : rows.at(-1);
  const positive = (rows.at(-1)?.cumulative ?? 0) >= 0;
  const color = positive ? "#34d399" : "#fb7185";
  const ticks = [hi, (hi + lo) / 2, lo];
  return <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-[10px] uppercase tracking-[.2em] text-steel">Evolución de la estrategia</p><h3 className="mt-1 text-lg font-semibold text-ink">Ganancia / pérdida acumulada</h3></div>
      <div className="text-right"><p className={`font-mono text-xl font-semibold ${positive ? "text-emerald-400" : "text-rose-400"}`}>{money(active?.cumulative)}</p><p className="mt-1 text-xs text-steel">{active ? `${dateLabel(active.date)} · ${active.away} en ${active.home} · W${active.week}` : "Sin movimientos"}</p></div>
    </div>
    {rows.length ? <>
      <svg viewBox={`0 0 ${width} ${height}`} className="mt-5 w-full" role="img" aria-label="Ganancia y pérdida simulada acumulada en orden cronológico"
        onPointerMove={event => {
          const rect = event.currentTarget.getBoundingClientRect();
          const position = (event.clientX - rect.left) / rect.width * width;
          setHover(Math.max(0, Math.min(rows.length - 1, Math.round((position - left) / (width - left - right) * rows.length) - 1)));
        }} onPointerLeave={() => setHover(null)}>
        <defs><linearGradient id="kelly-profit-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity=".22"/><stop offset="100%" stopColor={color} stopOpacity=".015"/></linearGradient></defs>
        {ticks.map(tick => <g key={tick}><line x1={left} x2={width - right} y1={y(tick)} y2={y(tick)} stroke="currentColor" className="text-white/10"/><text x={left - 12} y={y(tick) + 4} textAnchor="end" fill="#94a3b8" fontSize="12">{shortMoney(tick)}</text></g>)}
        <line x1={left} x2={width - right} y1={y(0)} y2={y(0)} stroke="#94a3b8" strokeDasharray="5 6" opacity=".5"/>
        <path d={fill} fill="url(#kelly-profit-fill)"/><path d={path} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round"/>
        {hover != null && active && <g><line x1={x(hover + 1)} x2={x(hover + 1)} y1={top} y2={height - bottom} stroke="#64748b" strokeDasharray="3 4"/><circle cx={x(hover + 1)} cy={y(active.cumulative)} r="4.5" fill={color} stroke="#0f172a" strokeWidth="2"/></g>}
        <text x={left} y={height - 8} fill="#94a3b8" fontSize="12">{dateLabel(rows[0].date)}</text><text x={width - right} y={height - 8} textAnchor="end" fill="#94a3b8" fontSize="12">{dateLabel(rows[rows.length - 1].date)}</text>
      </svg>
      <label className="mt-1 flex items-center gap-3 text-[11px] text-steel">Explorar partidos<input aria-label="Partido de la gráfica" type="range" min="0" max={rows.length - 1} value={hover ?? rows.length - 1} onChange={e => setHover(Number(e.target.value))} className="h-1 flex-1 accent-emerald-400" /></label>
    </> : <p className="py-16 text-center text-sm text-steel">No hay registros para estos filtros.</p>}
  </div>;
}

export function KellyReport() {
  const [report, setReport] = useState<Report | null>(null);
  const [market, setMarket] = useState("ML");
  const [season, setSeason] = useState("2025");
  const [week, setWeek] = useState("");
  const [mode, setMode] = useState("engine");
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(""); setPage(0);
    async function load() {
      try {
        const token = await getBrowserAccessToken();
        const params = new URLSearchParams({ market, mode });
        if (season) params.set("season", season);
        if (week) params.set("week", week);
        const result = await backendFetch<Report>(`/nfl-predictor/report?${params}`, token, { signal: controller.signal });
        if (!controller.signal.aborted) setReport(result);
      } catch (e) {
        if (!controller.signal.aborted) { setReport(null); setError(e instanceof Error ? e.message : "No se pudo cargar el reporte."); }
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load(); return () => controller.abort();
  }, [market, season, week, mode]);
  const seasons = useMemo(() => Array.from(new Set(report?.periods.map(p => p.season) ?? [])).sort((a, b) => b - a), [report]);
  const weeks = useMemo(() => Array.from(new Set(report?.periods.filter(p => !season || p.season === Number(season)).map(p => p.week) ?? [])).sort((a, b) => a - b), [report, season]);
  const summary = report?.summary;
  const rows = report?.rows ?? [];
  const pageRows = rows.slice(page * 40, (page + 1) * 40);
  const pages = Math.max(1, Math.ceil(rows.length / 40));
  return <section className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><div className="flex items-center gap-2"><TrendingUp size={19} className="text-emerald-400"/><h2 className="text-xl font-semibold text-ink">Kelly Performance</h2></div><p className="mt-2 text-sm text-steel">Tu histórico de ML, spread, totales y estrategias contrarias, en una sola tabla.</p></div>
      <span className="rounded-full border border-amber-300/20 bg-amber-300/10 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider text-amber-300">Simulación histórica · 2018–2025</span>
    </div>
    <div className="grid gap-4 rounded-2xl border border-white/10 bg-white/[.025] p-5 sm:grid-cols-2 xl:grid-cols-4">
      <label className="text-xs text-steel">Mercado<select className={selectClass} value={market} onChange={e => setMarket(e.target.value)}>{markets.map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
      <label className="text-xs text-steel">Temporada<select className={selectClass} value={season} onChange={e => { setSeason(e.target.value); setWeek(""); }}><option value="">Todas las temporadas</option>{(seasons.length ? seasons : [2025]).map(s => <option key={s} value={s}>{s}</option>)}</select></label>
      <label className="text-xs text-steel">Semana<select className={selectClass} value={week} onChange={e => setWeek(e.target.value)}><option value="">Todas las semanas</option>{weeks.map(w => <option key={w} value={w}>W{w}</option>)}</select></label>
      <label className="text-xs text-steel">Cálculo<select className={selectClass} value={mode} onChange={e => setMode(e.target.value)}><option value="engine">Motor NFL · histórico</option><option value="original">Excel original</option></select></label>
    </div>
    <p className="text-xs leading-relaxed text-steel">{mode === "engine" ? "Motor actual entrenado nuevamente antes de cada semana, con ELO y estadísticas previas. Usa las líneas históricas del archivo: su hora de captura no está verificada. Kelly completo sobre base fija, sin límite conjunto de exposición. Las primeras semanas sin 50 partidos previos quedan fuera." : mode === "original" ? "Cifras guardadas en MUCHADATA2, incluyendo sus fórmulas originales. Los montos son simulados, no apuestas confirmadas. Esta vista conserva también los errores detectados en el Excel." : "Recalculado con el momio de cada lado, pushes devueltos y probabilidad contraria = 1 − probabilidad original − push. Kelly completo con las bases del archivo; la probabilidad de empate ML no está disponible en el reporte y se asume cero al calcular Kelly."}</p>
    {error && <p role="alert" className="rounded-xl border border-rose-400/30 bg-rose-400/10 p-4 text-sm text-rose-300">{error}</p>}
    <div aria-busy={loading} className={loading ? "pointer-events-none space-y-5 opacity-40" : "space-y-5"}>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/5 p-5"><p className="text-xs text-steel">Ganancia / pérdida neta</p><p className={`mt-2 flex items-center gap-2 text-2xl font-semibold tabular-nums ${(summary?.profit ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{(summary?.profit ?? 0) >= 0 ? <ArrowUpRight size={22}/> : <ArrowDownRight size={22}/>}{money(summary?.profit)}</p></div>
        <div className="rounded-2xl border border-white/10 p-5"><p className="text-xs text-steel">ROI simulado</p><p className="mt-2 text-2xl font-semibold tabular-nums text-ink">{percent(summary?.roi)}</p><p className="mt-1 text-[11px] text-steel">Sobre {money(summary?.staked)} liquidados</p></div>
        <div className="rounded-2xl border border-white/10 p-5"><p className="text-xs text-steel">Ganadas / perdidas / push</p><p className="mt-2 text-2xl font-semibold tabular-nums"><span className="text-emerald-400">{summary?.wins ?? 0}</span><span className="text-steel"> / </span><span className="text-rose-400">{summary?.losses ?? 0}</span><span className="text-steel"> / {summary?.pushes ?? 0}</span></p></div>
        <div className="rounded-2xl border border-white/10 p-5"><p className="text-xs text-steel">Acierto · sin pushes</p><p className="mt-2 text-2xl font-semibold tabular-nums text-ink">{percent(summary?.win_rate)}</p><p className="mt-1 text-[11px] text-steel">Solo entradas con monto positivo</p></div>
      </div>
      {report?.comparison && <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/5 p-5">
        <h3 className="font-semibold text-ink">Motor vs. Excel · {report.comparison.games} partidos en común</h3>
        <p className="mt-1 text-xs text-steel">Cada estrategia decide en cuáles apostar y cuánto: compartir calendario no significa tener las mismas apuestas ni el mismo monto total. El ROI es G/P dividido entre el monto simulado liquidado. {report.comparison.duplicate_excel_rows} filas duplicadas del Excel excluidas.</p>
        <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-xs text-steel"><tr><th className="py-2">Fuente</th><th>Monto liquidado</th><th>G/P</th><th>ROI</th><th>Ganadas / perdidas / push</th><th>Entradas</th><th>Sin apuesta</th></tr></thead><tbody>{([['Motor actual', report.comparison.engine], ['Excel original', report.comparison.original]] as const).map(([name, stats]) => <tr key={name} className="border-t border-white/10 text-ink"><td className="py-3 pr-3">{name}</td><td className="pr-3 font-mono">{money(stats.staked)}</td><td className="pr-3 font-mono">{money(stats.profit)}</td><td className="pr-3">{percent(stats.roi)}</td><td>{stats.wins} / {stats.losses} / {stats.pushes ?? "—"}</td><td>{stats.entries}</td><td>{stats.no_entry ?? "—"}</td></tr>)}</tbody></table></div>
        <p className="mt-3 text-xs text-amber-200">El Excel conserva sus cálculos originales; su rentabilidad no es una evaluación independiente del motor. Los montos son simulados sobre una base fija por mercado, no el saldo de una cuenta.</p>
      </div>}
      <ProfitChart key={`${market}:${season}:${week}:${mode}`} rows={rows}/>
      <div className="overflow-hidden rounded-2xl border border-white/10">
        <div className="flex items-center justify-between gap-3 border-b border-white/10 px-5 py-4"><h3 className="text-sm font-semibold text-ink">Detalle · {markets.find(m => m[0] === market)?.[1]}</h3><span className="text-xs text-steel">{rows.length.toLocaleString("es-MX")} partidos</span></div>
        <div className="overflow-x-auto"><table className="w-full whitespace-nowrap text-left text-xs"><thead className="bg-white/[.035] text-steel"><tr>{["Fecha / semana", "Partido", "Selección", "Línea", "Momio decimal", "Prob.", "EV", "Kelly", "Monto simulado", "Resultado", "G/P", "Acumulado"].map(h => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr></thead>
          <tbody>{pageRows.map(r => <tr key={`${r.game_id}:${r.market}`} className="border-t border-white/5 text-ink hover:bg-white/[.035]">
            <td className="px-4 py-3.5"><p>{dateLabel(r.date)}</p><p className="mt-1 text-[10px] text-steel">{r.season} · W{r.week}</p></td><td className="px-4 py-3.5 font-medium">{r.away} <span className="font-normal text-steel">en</span> {r.home}</td><td className="px-4 py-3.5 font-semibold">{r.selection}</td><td className="px-4 py-3.5">{r.line ?? "—"}</td><td className="px-4 py-3.5 tabular-nums">{r.odds?.toFixed(2) ?? "—"}</td><td className="px-4 py-3.5 tabular-nums">{percent(r.probability)}</td><td className="px-4 py-3.5 tabular-nums">{percent(r.ev)}</td><td className="px-4 py-3.5 tabular-nums">{percent(r.kelly)}</td><td className="px-4 py-3.5 tabular-nums">{money(r.stake)}</td>
            <td className="px-4 py-3.5"><span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${(r.stake ?? 0) <= 0 ? "bg-white/5 text-steel" : r.outcome === "win" ? "bg-emerald-400/10 text-emerald-400" : r.outcome === "loss" ? "bg-rose-400/10 text-rose-400" : "bg-amber-400/10 text-amber-300"}`}>{r.stake == null ? "Sin cálculo" : r.stake === 0 ? "Sin entrada" : ({ win: "Ganada", loss: "Perdida", push: "Push", pending: "Pendiente" }[r.outcome] ?? "Pendiente")}</span></td>
            <td className={`px-4 py-3.5 font-mono ${(r.profit ?? 0) > 0 ? "text-emerald-400" : (r.profit ?? 0) < 0 ? "text-rose-400" : "text-steel"}`}>{money(r.profit)}</td><td className="px-4 py-3.5 font-mono font-semibold">{money(r.cumulative)}</td>
          </tr>)}</tbody></table></div>
        {!rows.length && <p className="p-8 text-center text-sm text-steel">No hay datos para esta selección.</p>}
        <div className="flex items-center justify-between border-t border-white/10 px-5 py-3 text-xs text-steel"><span>Página {page + 1} de {pages}</span><div className="flex gap-2"><button className="app-pill px-3 disabled:opacity-30" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Anterior</button><button className="app-pill px-3 disabled:opacity-30" disabled={page + 1 >= pages} onClick={() => setPage(p => p + 1)}>Siguiente</button></div></div>
      </div>
    </div>
    {loading && <p role="status" className="text-sm text-steel">Cargando histórico…</p>}
    <p className="text-[11px] text-steel">Fuente: {report?.source?.metadata.filename ?? "NFLPredictorbet_MUCHADATA2.xlsx"}. El acumulado comienza en cero para el filtro elegido. Las simulaciones históricas no acreditan apuestas realizadas ni rentabilidad futura.</p>
  </section>;
}
