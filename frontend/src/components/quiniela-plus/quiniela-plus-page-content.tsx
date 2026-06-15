"use client";

import { useEffect, useMemo, useState } from "react";

import { backendFetch } from "@/lib/api/backend";
import { formatMexicoCityDateTime } from "@/lib/datetime/mexico-city";
import { getBrowserAccessToken } from "@/lib/supabase/session";
import type { QuinielaPlusOddsSneakPeek, QuinielaPlusOddsSneakPeekMatch } from "@/types/api";

type OddsScope = "today" | "matchday";

function formatProbability(value: number) {
  return new Intl.NumberFormat("es-MX", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(value);
}

function getMexicoCityDateKey(value: string | Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function buildMatchdayLabel(match: QuinielaPlusOddsSneakPeekMatch) {
  return match.matchday_name.trim().toLowerCase().startsWith("jornada")
    ? match.matchday_name
    : `Jornada ${match.matchday_number}`;
}

export function QuinielaPlusPageContent() {
  const [oddsSneakPeek, setOddsSneakPeek] = useState<QuinielaPlusOddsSneakPeek | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [oddsScope, setOddsScope] = useState<OddsScope>("today");
  const [selectedMatchdayId, setSelectedMatchdayId] = useState("");

  useEffect(() => {
    async function loadOdds() {
      try {
        const accessToken = await getBrowserAccessToken();
        const response = await backendFetch<QuinielaPlusOddsSneakPeek>(
          "/quiniela-plus/odds-sneak-peek",
          accessToken,
        );
        setOddsSneakPeek(response);
        setError(null);
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "No se pudieron cargar las probabilidades");
      } finally {
        setLoading(false);
      }
    }

    void loadOdds();
  }, []);

  const matchdayOptions = useMemo(() => {
    const grouped = new Map<string, { id: string; label: string; number: number }>();
    for (const match of oddsSneakPeek?.matches ?? []) {
      if (!grouped.has(match.matchday_id)) {
        grouped.set(match.matchday_id, {
          id: match.matchday_id,
          label: buildMatchdayLabel(match),
          number: match.matchday_number,
        });
      }
    }
    return [...grouped.values()].sort((left, right) => left.number - right.number);
  }, [oddsSneakPeek?.matches]);

  useEffect(() => {
    setSelectedMatchdayId((current) => {
      if (matchdayOptions.some((matchday) => matchday.id === current)) {
        return current;
      }
      return matchdayOptions[0]?.id ?? "";
    });
  }, [matchdayOptions]);

  const visibleMatches = useMemo(() => {
    const matches = oddsSneakPeek?.matches ?? [];
    if (oddsScope === "today") {
      const todayKey = getMexicoCityDateKey(new Date());
      return matches.filter((match) => getMexicoCityDateKey(match.kickoff_at) === todayKey);
    }
    return matches.filter((match) => match.matchday_id === selectedMatchdayId);
  }, [oddsScope, oddsSneakPeek?.matches, selectedMatchdayId]);

  if (loading) {
    return <p className="text-sm text-ink/60">Cargando probabilidades...</p>;
  }

  if (error) {
    return <p className="text-sm text-coral">{error}</p>;
  }

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <p className="text-[11px] uppercase tracking-[0.28em] text-steel">Quiniela +</p>
        <h1 className="text-2xl font-semibold text-ink">Probabilidades sin vig</h1>
        <p className="max-w-3xl text-sm text-steel">
          Probabilidad implicita justa por partido, normalizada para quitar el margen de la casa.
        </p>
      </section>

      <section className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setOddsScope("today")}
            className={oddsScope === "today" ? "app-pill-active min-w-[10rem] px-3" : "app-pill min-w-[10rem] px-3"}
          >
            Partidos de hoy
          </button>
          <button
            type="button"
            onClick={() => setOddsScope("matchday")}
            className={oddsScope === "matchday" ? "app-pill-active min-w-[10rem] px-3" : "app-pill min-w-[10rem] px-3"}
          >
            Por jornada
          </button>
        </div>

        {oddsScope === "matchday" && matchdayOptions.length > 0 ? (
          <label className="w-full max-w-[320px] space-y-2 text-sm sm:w-auto">
            <span className="text-steel">Jornada</span>
            <select
              value={selectedMatchdayId}
              onChange={(event) => setSelectedMatchdayId(event.target.value)}
              className="field-control"
            >
              {matchdayOptions.map((matchday) => (
                <option key={matchday.id} value={matchday.id}>
                  {matchday.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </section>

      {visibleMatches.length > 0 ? (
        <section className="overflow-hidden rounded-[16px] border border-white/[0.06] bg-white/[0.03]">
          <div className="overflow-x-auto">
            <table className="min-w-[760px] w-full text-left text-sm">
              <thead className="border-b border-white/[0.06] text-[11px] uppercase tracking-[0.16em] text-steel">
                <tr>
                  <th className="px-4 py-3 font-semibold">Jornada</th>
                  <th className="px-4 py-3 font-semibold">Fecha</th>
                  <th className="px-4 py-3 font-semibold">Partido</th>
                  <th className="px-4 py-3 text-right font-semibold">Local</th>
                  <th className="px-4 py-3 text-right font-semibold">Empate</th>
                  <th className="px-4 py-3 text-right font-semibold">Visita</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {visibleMatches.map((match) => (
                  <tr key={match.match_id} className="transition hover:bg-white/[0.03]">
                    <td className="whitespace-nowrap px-4 py-3 text-xs uppercase tracking-[0.14em] text-steel">
                      {buildMatchdayLabel(match)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-steel">
                      {formatMexicoCityDateTime(match.kickoff_at)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-ink">{match.home_team_name}</p>
                        <p className="truncate text-steel">{match.away_team_name}</p>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-moss">
                      {formatProbability(match.home_win_probability)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-amber-100">
                      {formatProbability(match.draw_probability)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-sky-100">
                      {formatProbability(match.away_win_probability)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <section className="rounded-[16px] border border-white/[0.06] bg-white/[0.03] p-4">
          <p className="text-sm text-steel">
            No hay odds mundialistas sincronizados para este filtro. Baja odds con `THE_ODDS_API_SPORT=soccer_fifa_world_cup`
            y luego sincroniza el snapshot contra los partidos del Mundial.
          </p>
        </section>
      )}
    </div>
  );
}
