"use client";

import type { MyMatchdayPointsEntry } from "@/types/api";

type MatchdayPointsTableProps = {
  rows: MyMatchdayPointsEntry[];
};

export function MatchdayPointsTable({ rows }: MatchdayPointsTableProps) {
  return (
    <section className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between sm:gap-4">
        <div>
          <h2 className="text-sm font-semibold text-ink">Puntos por jornada</h2>
        </div>
      </div>

      {rows.length > 0 ? (
        <>
          <div className="mt-4 space-y-2.5 md:hidden">
            {rows.map((row) => (
              <div key={row.matchday_id} className="border-b border-white/10 pb-3">
                <div className="mb-2">
                  <p className="text-[11px] font-medium leading-tight text-ink">
                    {row.matchday_name.trim().toLowerCase().startsWith("jornada")
                      ? row.matchday_name
                      : `Jornada ${row.matchday_number}`}
                  </p>
                </div>
                <div className="grid grid-cols-[0.85fr_1.2fr_1.2fr_0.9fr_0.95fr] gap-1.5 text-steel">
                  <div className="min-w-0 text-center">
                    <p className="text-[6px] uppercase tracking-[0.06em] text-steel/80">Pts</p>
                    <p className="mt-1 text-[11px] font-semibold leading-none text-ink">{row.total_points}</p>
                  </div>
                  <div className="min-w-0 text-center">
                    <p className="text-[6px] uppercase tracking-[0.04em] text-steel/80">Ganador</p>
                    <p className="mt-1 text-[11px] font-semibold leading-none text-ink">{row.correct_results}</p>
                  </div>
                  <div className="min-w-0 text-center">
                    <p className="text-[6px] uppercase tracking-[0.04em] text-steel/80">Exactos</p>
                    <p className="mt-1 text-[11px] font-semibold leading-none text-ink">{row.exact_scores}</p>
                  </div>
                  <div className="min-w-0 text-center">
                    <p className="text-[6px] uppercase tracking-[0.06em] text-steel/80">Lugar</p>
                    <p className="mt-1 text-[11px] font-semibold leading-none text-ink">{row.rank_position ? `#${row.rank_position}` : "-"}</p>
                  </div>
                  <div className="min-w-0 text-center">
                    <p className="text-[6px] uppercase tracking-[0.06em] text-steel/80">Acum</p>
                    <p className="mt-1 text-[11px] font-semibold leading-none text-emerald-300">{row.cumulative_points}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-5 hidden overflow-x-auto md:block">
          <table className="min-w-full text-left text-[13px] text-steel">
            <thead className="app-table-head">
              <tr>
                <th className="px-3 py-2.5 font-medium">Jornada</th>
                <th className="px-3 py-2.5 font-medium text-center">Puntos</th>
                <th className="px-3 py-2.5 font-medium text-center">Ganador</th>
                <th className="px-3 py-2.5 font-medium text-center">Exactos</th>
                <th className="px-3 py-2.5 font-medium text-center">Lugar</th>
                <th className="px-3 py-2.5 font-medium text-center">Acumulado</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.matchday_id} className="app-table-row border-b last:border-b-0">
                  <td className="px-3 py-2.5">
                    <p className="font-medium leading-tight text-ink">
                      {row.matchday_name.trim().toLowerCase().startsWith("jornada")
                        ? row.matchday_name
                        : `Jornada ${row.matchday_number}`}
                    </p>
                  </td>
                  <td className="px-3 py-2.5 text-center text-base font-semibold text-ink">{row.total_points}</td>
                  <td className="px-3 py-2.5 text-center">{row.correct_results}</td>
                  <td className="px-3 py-2.5 text-center">{row.exact_scores}</td>
                  <td className="px-3 py-2.5 text-center font-semibold text-ink">
                    {row.rank_position ? (
                      row.rank_position
                    ) : (
                      <span className="text-steel">-</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-center text-base font-semibold text-emerald-300">
                    {row.cumulative_points}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </>
      ) : (
        <p className="mt-5 text-sm text-steel">Todavia no hay jornadas calculadas para esta temporada.</p>
      )}
    </section>
  );
}
