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

function getTeamInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((segment) => segment[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 3);
}

function TeamBubble({ name, shortName, crestUrl }: { name: string; shortName: string; crestUrl: string | null }) {
  const fallback = shortName || getTeamInitials(name);
  if (crestUrl) {
    return (
      <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-white/[0.06]">
        <img src={crestUrl} alt={name} className="h-full w-full object-cover" />
      </span>
    );
  }

  return (
    <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-[8px] font-semibold text-ink">
      {fallback.slice(0, 2)}
    </span>
  );
}

function TeamInline({ name, shortName, crestUrl }: { name: string; shortName: string; crestUrl: string | null }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <TeamBubble name={name} shortName={shortName} crestUrl={crestUrl} />
      <span className="truncate font-semibold text-ink">{name}</span>
    </span>
  );
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
        <section className="overflow-hidden rounded-[12px] border border-white/[0.06] bg-white/[0.025]">
          <div className="overflow-x-auto">
            <table className="min-w-[820px] w-full table-fixed text-left text-xs text-steel">
              <colgroup>
                <col className="w-[96px]" />
                <col className="w-[130px]" />
                <col className="w-[360px]" />
                <col className="w-[78px]" />
                <col className="w-[78px]" />
                <col className="w-[78px]" />
              </colgroup>
              <thead className="border-b border-white/[0.06] text-[10px] uppercase tracking-[0.14em] text-steel">
                <tr>
                  <th className="px-3 py-2 font-semibold">Jornada</th>
                  <th className="px-3 py-2 font-semibold">Fecha</th>
                  <th className="px-3 py-2 font-semibold">Partido</th>
                  <th className="px-3 py-2 text-right font-semibold text-moss">Local</th>
                  <th className="px-3 py-2 text-right font-semibold text-gold">Empate</th>
                  <th className="px-3 py-2 text-right font-semibold text-coral">Visitante</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {visibleMatches.map((match) => (
                  <tr key={match.match_id} className="transition hover:bg-white/[0.03]">
                    <td className="whitespace-nowrap px-3 py-2 text-[10px] uppercase tracking-[0.12em] text-steel">
                      {buildMatchdayLabel(match)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-[11px] text-steel">
                      {formatMexicoCityDateTime(match.kickoff_at)}
                    </td>
                    <td className="px-3 py-2">
                      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
                        <TeamInline
                          name={match.home_team_name}
                          shortName={match.home_team_short_name}
                          crestUrl={match.home_team_crest_url}
                        />
                        <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-steel">vs</span>
                        <TeamInline
                          name={match.away_team_name}
                          shortName={match.away_team_short_name}
                          crestUrl={match.away_team_crest_url}
                        />
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-semibold text-moss">
                      {formatProbability(match.home_win_probability)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-semibold text-gold">
                      {formatProbability(match.draw_probability)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-semibold text-coral">
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
