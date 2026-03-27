"use client";

import type { PerformanceRace } from "@/types/api";

type PerformanceRaceChartProps = {
  race: PerformanceRace | null;
  userLabel: string;
};

const WIDTH = 860;
const HEIGHT = 280;
const PADDING_LEFT = 40;
const PADDING_RIGHT = 24;
const PADDING_TOP = 20;
const PADDING_BOTTOM = 36;

function pointPath(points: Array<{ x: number; y: number }>) {
  if (points.length === 0) {
    return "";
  }
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
    .join(" ");
}

function areaPath(topPoints: Array<{ x: number; y: number }>, bottomPoints: Array<{ x: number; y: number }>) {
  if (topPoints.length === 0 || bottomPoints.length === 0 || topPoints.length !== bottomPoints.length) {
    return "";
  }

  const top = pointPath(topPoints);
  const bottom = bottomPoints
    .slice()
    .reverse()
    .map((point) => `L ${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
    .join(" ");

  return `${top} ${bottom} Z`;
}

export function PerformanceRaceChart({ race, userLabel }: PerformanceRaceChartProps) {
  const series = race?.points ?? [];
  const totalMatchdays = race?.tournament_matchdays ?? 0;
  const completedMatchdays = race?.completed_matchdays ?? 0;

  if (series.length === 0) {
    return (
      <section className="space-y-2">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-ink">Performance vs zona de premios</h2>
          </div>
          <p className="max-w-xl text-xs text-steel">
            Cuando haya jornadas calificadas, aqui veras tu avance acumulado y la proyeccion al cierre.
          </p>
        </div>
      </section>
    );
  }

  const actualSeries = series.slice(0, Math.max(completedMatchdays, 1));
  const chartPoints = Math.max(totalMatchdays, series.length, 1);
  const maxValue = Math.max(
    race?.projected_user_total ?? 0,
    race?.projected_first_place_total ?? 0,
    race?.projected_third_place_total ?? 0,
    ...series.flatMap((point) => [
      point.user_cumulative_points,
      point.first_place_cumulative_points,
      point.third_place_cumulative_points,
    ]),
    1,
  );
  const innerWidth = WIDTH - PADDING_LEFT - PADDING_RIGHT;
  const innerHeight = HEIGHT - PADDING_TOP - PADDING_BOTTOM;

  const xForIndex = (index: number) =>
    PADDING_LEFT + (chartPoints <= 1 ? innerWidth / 2 : (index / (chartPoints - 1)) * innerWidth);
  const yForValue = (value: number) => PADDING_TOP + innerHeight - (value / maxValue) * innerHeight;

  const actualUserPoints = actualSeries.map((point, index) => ({
    x: xForIndex(index),
    y: yForValue(point.user_cumulative_points),
  }));
  const actualFirstPlacePoints = actualSeries.map((point, index) => ({
    x: xForIndex(index),
    y: yForValue(point.first_place_cumulative_points),
  }));
  const actualThirdPlacePoints = actualSeries.map((point, index) => ({
    x: xForIndex(index),
    y: yForValue(point.third_place_cumulative_points),
  }));

  const projectionStartIndex = Math.max(completedMatchdays - 1, 0);
  const projectionEndIndex = Math.max(chartPoints - 1, projectionStartIndex);
  const lastActualPoint = actualSeries[Math.max(actualSeries.length - 1, 0)];
  const projectedUserPath =
    completedMatchdays > 0 && lastActualPoint
      ? pointPath([
          {
            x: xForIndex(projectionStartIndex),
            y: yForValue(lastActualPoint.user_cumulative_points),
          },
          {
            x: xForIndex(projectionEndIndex),
            y: yForValue(race?.projected_user_total ?? lastActualPoint.user_cumulative_points),
          },
        ])
      : "";
  const projectedFirstPlacePath =
    completedMatchdays > 0 && lastActualPoint
      ? pointPath([
          {
            x: xForIndex(projectionStartIndex),
            y: yForValue(lastActualPoint.first_place_cumulative_points),
          },
          {
            x: xForIndex(projectionEndIndex),
            y: yForValue(race?.projected_first_place_total ?? lastActualPoint.first_place_cumulative_points),
          },
        ])
      : "";
  const projectedThirdPlacePath =
    completedMatchdays > 0 && lastActualPoint
      ? pointPath([
          {
            x: xForIndex(projectionStartIndex),
            y: yForValue(lastActualPoint.third_place_cumulative_points),
          },
          {
            x: xForIndex(projectionEndIndex),
            y: yForValue(race?.projected_third_place_total ?? lastActualPoint.third_place_cumulative_points),
          },
        ])
      : "";
  const actualPrizeBandPath = areaPath(actualFirstPlacePoints, actualThirdPlacePoints);
  const projectedPrizeBandPath =
    completedMatchdays > 0 && lastActualPoint
      ? areaPath(
          [
            {
              x: xForIndex(projectionStartIndex),
              y: yForValue(lastActualPoint.first_place_cumulative_points),
            },
            {
              x: xForIndex(projectionEndIndex),
              y: yForValue(race?.projected_first_place_total ?? lastActualPoint.first_place_cumulative_points),
            },
          ],
          [
            {
              x: xForIndex(projectionStartIndex),
              y: yForValue(lastActualPoint.third_place_cumulative_points),
            },
            {
              x: xForIndex(projectionEndIndex),
              y: yForValue(race?.projected_third_place_total ?? lastActualPoint.third_place_cumulative_points),
            },
          ],
        )
      : "";

  const yTicks = 4;
  const tickValues = Array.from({ length: yTicks + 1 }, (_value, index) => (maxValue / yTicks) * index);

  return (
      <section className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between sm:gap-4">
        <div>
          <h2 className="text-sm font-semibold text-ink">Performance vs zona de premios</h2>
        </div>
      <div className="flex flex-wrap gap-3 text-[11px] text-steel sm:text-sm">
          <span className="inline-flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-sky-400" />
            {userLabel}
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="h-3 w-5 rounded-[4px] bg-amber-300/45" />
            Franja premios 1-3
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="h-px w-5 border-t-2 border-dashed border-sky-300/80" />
            Tu proyeccion
          </span>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-night/10 px-2 py-3 sm:px-3">
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-auto w-full">
          {tickValues.map((value) => {
            const y = yForValue(value);
            return (
              <g key={value}>
                <line x1={PADDING_LEFT} y1={y} x2={WIDTH - PADDING_RIGHT} y2={y} stroke="rgba(255,255,255,0.08)" />
                <text x={10} y={y + 4} fill="rgba(180,194,224,0.7)" fontSize="11">
                  {Math.round(value)}
                </text>
              </g>
            );
          })}

          <line
            x1={PADDING_LEFT}
            y1={HEIGHT - PADDING_BOTTOM}
            x2={WIDTH - PADDING_RIGHT}
            y2={HEIGHT - PADDING_BOTTOM}
            stroke="rgba(255,255,255,0.14)"
          />

          {series.map((point, index) => (
            <text
              key={point.matchday_id}
              x={xForIndex(index)}
              y={HEIGHT - 14}
              textAnchor="middle"
              fill="rgba(180,194,224,0.8)"
              fontSize="11"
            >
              J{point.matchday_number}
            </text>
          ))}

          {actualPrizeBandPath ? <path d={actualPrizeBandPath} fill="rgba(253, 186, 116, 0.18)" /> : null}
          {projectedPrizeBandPath ? (
            <path d={projectedPrizeBandPath} fill="rgba(253, 186, 116, 0.1)" stroke="rgba(253, 186, 116, 0.3)" strokeDasharray="8 8" />
          ) : null}

          <path
            d={pointPath(actualFirstPlacePoints)}
            fill="none"
            stroke="rgba(253, 186, 116, 0.75)"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <path
            d={pointPath(actualThirdPlacePoints)}
            fill="none"
            stroke="rgba(253, 186, 116, 0.55)"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <path d={pointPath(actualUserPoints)} fill="none" stroke="#38bdf8" strokeWidth="3" strokeLinecap="round" />

          {projectedUserPath ? (
            <path d={projectedUserPath} fill="none" stroke="#38bdf8" strokeWidth="2.5" strokeDasharray="8 8" />
          ) : null}
          {projectedFirstPlacePath ? (
            <path d={projectedFirstPlacePath} fill="none" stroke="rgba(253, 186, 116, 0.75)" strokeWidth="1.75" strokeDasharray="8 8" />
          ) : null}
          {projectedThirdPlacePath ? (
            <path d={projectedThirdPlacePath} fill="none" stroke="rgba(253, 186, 116, 0.55)" strokeWidth="1.75" strokeDasharray="8 8" />
          ) : null}

          {actualUserPoints.map((point, index) => (
            <circle key={`user-${index}`} cx={point.x} cy={point.y} r="4" fill="#38bdf8" />
          ))}
        </svg>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="border-b border-white/10 pb-3">
          <p className="text-[10px] uppercase tracking-[0.16em] text-steel">Tu cierre proyectado</p>
          <p className="mt-1.5 text-[12px] font-semibold text-sky-400 sm:text-lg">{(race?.projected_user_total ?? 0).toFixed(1)} pts</p>
        </div>
        <div className="border-b border-white/10 pb-3">
          <p className="text-[10px] uppercase tracking-[0.16em] text-steel">Franja proyectada premios</p>
          <p className="mt-1.5 text-[12px] font-semibold text-amber-200 sm:text-lg">
            {(race?.projected_third_place_total ?? 0).toFixed(1)} a {(race?.projected_first_place_total ?? 0).toFixed(1)} pts
          </p>
        </div>
      </div>
    </section>
  );
}
