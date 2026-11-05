import type { VipLeaderboardEntry } from "@/types/api";

export function VipWeeklyRanking({ entries }: { entries: VipLeaderboardEntry[] }) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-steel">Ranking semanal</h3>
          <p className="mt-1 text-xs text-steel">Un punto por acierto. En empate, gana la menor diferencia con los goles reales del partido de desempate.</p>
        </div>
        <span className="text-xs text-steel">{entries.length} participantes</span>
      </div>
      {entries.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-left text-sm text-ink">
            <thead className="app-table-head">
              <tr>
                <th className="px-3 py-3">Pos.</th>
                <th className="px-3 py-3">Jugador</th>
                <th className="px-3 py-3 text-center">Aciertos</th>
                <th className="px-3 py-3 text-center">Goles elegidos</th>
                <th className="px-3 py-3 text-center">Diferencia</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.profile_id} className="app-table-row border-b last:border-b-0">
                  <td className="px-3 py-3 font-semibold">{entry.rank_position}</td>
                  <td className="px-3 py-3 font-medium">{entry.display_name}</td>
                  <td className="px-3 py-3 text-center">{entry.correct_results}</td>
                  <td className="px-3 py-3 text-center">{entry.tiebreak_prediction ?? "—"}</td>
                  <td className="px-3 py-3 text-center">{entry.tiebreak_difference ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="text-sm text-steel">Aún no hay participantes aprobados.</p>}
      <p className="text-xs text-steel">Si también empatan en diferencia, comparten la posición. El desempate se muestra cuando cierra ese partido.</p>
    </section>
  );
}
