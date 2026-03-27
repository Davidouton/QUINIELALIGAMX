"use client";

import type { AdvancedStats } from "@/types/api";

type AdvancedStatsPanelProps = {
  stats: AdvancedStats | null;
};

function formatPct(value: number) {
  return `${value.toFixed(1)}%`;
}

export function AdvancedStatsPanel({ stats }: AdvancedStatsPanelProps) {
  const rows = [
    { label: "Apuestas Local", value: stats?.home_bets ?? 0 },
    { label: "Apuestas Empate", value: stats?.draw_bets ?? 0 },
    { label: "Apuestas Visita", value: stats?.away_bets ?? 0 },
    { label: `Aciertos ${stats?.max_hit_points ?? 0} Pts`, value: stats?.exact_hits ?? 0 },
    { label: `Aciertos ${stats?.result_hit_points ?? 0} Pts`, value: stats?.result_hits ?? 0 },
    { label: "% Efectividad General", value: formatPct(stats?.overall_effectiveness_pct ?? 0) },
    { label: "% Efec. Local", value: formatPct(stats?.home_effectiveness_pct ?? 0) },
    { label: "% Efe. Empate", value: formatPct(stats?.draw_effectiveness_pct ?? 0) },
    { label: "% Efe. Visita", value: formatPct(stats?.away_effectiveness_pct ?? 0) },
    { label: "Puntos Local", value: stats?.home_points ?? 0 },
    { label: "Puntos Empate", value: stats?.draw_points ?? 0 },
    { label: "Puntos Visita", value: stats?.away_points ?? 0 },
  ];

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between sm:gap-4">
        <div>
          <h2 className="text-sm font-semibold text-ink sm:text-2xl">Estadisticas avanzadas</h2>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 border-b border-white/10 pb-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.14em] text-steel">Picks</p>
          <p className="mt-1 text-[12px] font-semibold text-ink sm:text-lg">{stats?.graded_picks ?? 0}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-[0.14em] text-steel">Temporada</p>
          <p className="mt-1 text-[12px] font-semibold text-ink sm:text-lg">{stats?.season_name ?? "Sin definir"}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-[0.14em] text-steel">Jornada top</p>
          <p className="mt-1 text-[12px] font-semibold text-emerald-300 sm:text-lg">
            {stats?.best_matchday_name ?? "Sin datos"}
          </p>
          <p className="mt-1 text-[11px] text-steel sm:text-sm">{stats?.best_matchday_points ?? 0} pts</p>
        </div>
      </div>

      <div className="space-y-2 md:hidden">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-3 border-b border-white/5 py-2">
            <p className="text-[10px] uppercase tracking-[0.12em] text-steel/80">{row.label}</p>
            <p className="text-[12px] font-semibold text-ink">{row.value}</p>
          </div>
        ))}
      </div>

      <div className="hidden overflow-x-auto md:block">
        <table className="min-w-full text-left text-sm text-steel">
          <thead className="app-table-head">
            <tr>
              <th className="px-4 py-3 font-medium">Dato</th>
              <th className="px-4 py-3 font-medium text-right">Valor</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="app-table-row border-b last:border-b-0">
                <td className="px-4 py-3 font-medium text-ink">{row.label}</td>
                <td className="px-4 py-3 text-right text-sm font-semibold text-ink">{row.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
