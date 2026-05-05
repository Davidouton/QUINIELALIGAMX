"use client";

import type { PickResultRow } from "@/types/api";

type PickResultsTableProps = {
  rows: PickResultRow[];
  title?: string;
  subtitle?: string;
  emptyMessage?: string;
};

function getSelectionLabel(selection: PickResultRow["selection"]) {
  if (selection === "home") {
    return "Local";
  }
  if (selection === "away") {
    return "Visitante";
  }
  if (selection === "draw") {
    return "Empate";
  }
  return "Sin pick";
}

function getPointsTone(totalPoints: number, hasPick: boolean, isOfficial: boolean) {
  if (!isOfficial) {
    return "text-steel";
  }
  if (!hasPick || totalPoints === 0) {
    return "text-coral";
  }
  return "text-emerald-300";
}

function buildOverrideMessage(row: PickResultRow) {
  const base = row.overridden_by_display_name
    ? `Pick ajustado por ${row.overridden_by_display_name}.`
    : "Pick ajustado por admin.";
  if (row.admin_override_note) {
    return `${base} ${row.admin_override_note}`;
  }
  return base;
}

function TeamBadge({ crestUrl, name }: { crestUrl: string | null; name: string }) {
  return (
    <div className="flex w-[88px] min-w-0 flex-col items-center justify-center gap-1 text-center sm:w-[108px]">
      {crestUrl ? (
        <img
          src={crestUrl}
          alt={name}
          className="h-7 w-7 object-contain sm:h-10 sm:w-10"
        />
      ) : (
        <div className="flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-[8px] font-semibold uppercase text-steel sm:h-10 sm:w-10 sm:text-[10px]">
          {name.slice(0, 3)}
        </div>
      )}
      <p className="min-h-[20px] max-w-[58px] text-[8px] leading-tight text-steel sm:min-h-[32px] sm:max-w-[88px] sm:text-[11px]">
        {name}
      </p>
    </div>
  );
}

export function PickResultsTable({
  rows,
  title = "Jornada",
  emptyMessage = "Todavia no hay partidos para esta jornada.",
}: PickResultsTableProps) {
  const totalPoints = rows.reduce((sum, row) => sum + row.total_points, 0);

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-ink sm:text-2xl">{title}</h2>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-[0.14em] text-emerald-200">Total</p>
          <p className="mt-1 text-[12px] font-semibold text-emerald-300 sm:text-2xl">{totalPoints}</p>
        </div>
      </div>

      {rows.length > 0 ? (
        <>
          <div className="mt-4 space-y-2.5 md:hidden">
            {rows.map((row) => (
              <div key={row.match_id} className="border-b border-white/10 pb-3">
                <div className="grid grid-cols-[1.5fr_1fr_1fr_0.7fr] items-center gap-2">
                  <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-1">
                    <TeamBadge crestUrl={row.home_team_crest_url} name={row.home_team_name} />
                    <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-steel">vs</span>
                    <TeamBadge crestUrl={row.away_team_crest_url} name={row.away_team_name} />
                  </div>
                  <div className="text-center">
                    <p className="text-[6px] uppercase tracking-[0.06em] text-steel/80">Prediccion</p>
                    {row.has_pick ? (
                      <>
                        <p className="mt-1 text-[11px] font-semibold leading-none text-ink">
                          {row.predicted_home_score} - {row.predicted_away_score}
                        </p>
                        <p className="mt-1 text-[8px] uppercase tracking-[0.08em] text-steel">
                          {getSelectionLabel(row.selection)}
                        </p>
                        {row.is_admin_override ? (
                          <p className="mt-1 text-[9px] text-amber-100">{buildOverrideMessage(row)}</p>
                        ) : null}
                      </>
                    ) : (
                      <p className="mt-1 text-[10px] font-semibold text-coral">Sin pick</p>
                    )}
                  </div>
                  <div className="text-center">
                    <p className="text-[6px] uppercase tracking-[0.06em] text-steel/80">Resultado</p>
                    {row.is_official && row.home_score !== null && row.away_score !== null ? (
                      <>
                        <p className="mt-1 text-[11px] font-semibold leading-none text-ink">
                          {row.home_score} - {row.away_score}
                        </p>
                        <p className="mt-1 text-[8px] uppercase tracking-[0.08em] text-emerald-300">Oficial</p>
                      </>
                    ) : (
                      <p className="mt-1 text-[10px] font-semibold text-steel">Pend.</p>
                    )}
                  </div>
                  <div className="text-center">
                    <p className="text-[6px] uppercase tracking-[0.06em] text-steel/80">Puntos</p>
                    <p className={`mt-1 text-[12px] font-semibold leading-none ${getPointsTone(row.total_points, row.has_pick, row.is_official)}`}>
                      {row.is_official ? row.total_points : "-"}
                    </p>
                  </div>
                </div>

                {!row.is_official ? <p className="mt-2 text-[10px] text-steel">En espera del final</p> : null}
              </div>
            ))}
          </div>

          <div className="mt-5 hidden overflow-x-auto md:block">
          <table className="min-w-full text-left text-sm text-steel">
            <thead className="app-table-head">
              <tr>
                <th className="px-4 py-2.5 font-medium">Partido</th>
                <th className="px-4 py-2.5 font-medium">Mi prediccion</th>
                <th className="px-4 py-2.5 font-medium">Resultado real</th>
                <th className="px-4 py-2.5 font-medium text-center">Puntos</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.match_id} className="app-table-row border-b align-top last:border-b-0">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-3">
                      <TeamBadge crestUrl={row.home_team_crest_url} name={row.home_team_name} />
                      <span className="text-xs font-semibold uppercase tracking-[0.2em] text-steel">vs</span>
                      <TeamBadge crestUrl={row.away_team_crest_url} name={row.away_team_name} />
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    {row.has_pick ? (
                      <>
                        <p className="text-xl font-semibold text-ink">
                          {row.predicted_home_score} - {row.predicted_away_score}
                        </p>
                        <p className="mt-1 text-xs uppercase tracking-[0.18em] text-steel">
                          {getSelectionLabel(row.selection)}
                        </p>
                        {row.is_admin_override ? (
                          <p className="mt-2 text-xs text-amber-100">{buildOverrideMessage(row)}</p>
                        ) : null}
                      </>
                    ) : (
                      <span className="text-xs font-semibold text-coral">
                        Sin pick
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    {row.is_official && row.home_score !== null && row.away_score !== null ? (
                      <>
                        <p className="text-xl font-semibold text-ink">
                          {row.home_score} - {row.away_score}
                        </p>
                        <p className="mt-1 text-xs uppercase tracking-[0.18em] text-emerald-300">Oficial</p>
                      </>
                    ) : (
                      <span className="text-xs font-semibold text-steel">Pendiente</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <p className={`text-xl font-semibold ${getPointsTone(row.total_points, row.has_pick, row.is_official)}`}>
                      {row.is_official ? row.total_points : "-"}
                    </p>
                    {row.is_official ? (
                      <p className="mt-1 text-xs text-steel">{row.result_points} + {row.exact_score_points}</p>
                    ) : (
                      <p className="mt-1 text-xs text-steel">En espera del final</p>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </>
      ) : (
        <p className="mt-5 text-sm text-steel">{emptyMessage}</p>
      )}
    </section>
  );
}
