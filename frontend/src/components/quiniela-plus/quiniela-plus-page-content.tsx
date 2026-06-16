"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { backendFetch } from "@/lib/api/backend";
import { formatMexicoCityDateTime } from "@/lib/datetime/mexico-city";
import { getBrowserAccessToken } from "@/lib/supabase/session";
import type {
  QuinielaPlusOddsSneakPeek,
  QuinielaPlusOddsSneakPeekMatch,
  QuinielaPlusUserDistribution,
  QuinielaPlusUserDistributionMatch,
} from "@/types/api";

type OddsScope = "today" | "matchday" | "locked";
type QuinielaPlusTab = "probabilities" | "user-distribution";
type MatchdaySourceMatch = Pick<QuinielaPlusOddsSneakPeekMatch, "matchday_id" | "matchday_name" | "matchday_number" | "kickoff_at">;
const TODAY_DISTRIBUTION_POLL_MS = 10_000;
const MATCHDAY_DISTRIBUTION_POLL_MS = 45_000;

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

function formatUpdatedAt(value: Date | null) {
  if (!value) {
    return "Sin actualizar";
  }
  return new Intl.DateTimeFormat("es-MX", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(value);
}

function buildMatchdayLabel(match: MatchdaySourceMatch) {
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

function getProbabilityTone(
  value: number,
  probabilities: [number, number, number],
) {
  const sorted = [...probabilities].sort((left, right) => right - left);
  const rank = sorted.findIndex((candidate) => candidate === value);
  if (rank === 0) {
    return "text-moss";
  }
  if (rank === 1) {
    return "text-gold";
  }
  return "text-coral";
}

export function QuinielaPlusPageContent() {
  const [oddsSneakPeek, setOddsSneakPeek] = useState<QuinielaPlusOddsSneakPeek | null>(null);
  const [userDistribution, setUserDistribution] = useState<QuinielaPlusUserDistribution | null>(null);
  const [loading, setLoading] = useState(true);
  const [distributionRefreshing, setDistributionRefreshing] = useState(false);
  const [distributionUpdatedAt, setDistributionUpdatedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<QuinielaPlusTab>("probabilities");
  const [oddsScope, setOddsScope] = useState<OddsScope>("today");
  const [selectedMatchdayId, setSelectedMatchdayId] = useState("");

  const refreshUserDistribution = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      if (!silent) {
        setDistributionRefreshing(true);
      }
      try {
        const accessToken = await getBrowserAccessToken();
        const distributionResponse = await backendFetch<QuinielaPlusUserDistribution>(
          "/quiniela-plus/user-distribution",
          accessToken,
        );
        setUserDistribution(distributionResponse);
        setDistributionUpdatedAt(new Date());
        setError(null);
      } catch (caughtError) {
        if (!silent) {
          setError(caughtError instanceof Error ? caughtError.message : "No se pudo actualizar la distribucion");
        }
      } finally {
        if (!silent) {
          setDistributionRefreshing(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    async function loadInitialData() {
      try {
        const accessToken = await getBrowserAccessToken();
        const [oddsResponse, distributionResponse] = await Promise.all([
          backendFetch<QuinielaPlusOddsSneakPeek>("/quiniela-plus/odds-sneak-peek", accessToken),
          backendFetch<QuinielaPlusUserDistribution>("/quiniela-plus/user-distribution", accessToken),
        ]);
        setOddsSneakPeek(oddsResponse);
        setUserDistribution(distributionResponse);
        setDistributionUpdatedAt(new Date());
        setError(null);
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "No se pudieron cargar las probabilidades");
      } finally {
        setLoading(false);
      }
    }

    void loadInitialData();
  }, []);

  useEffect(() => {
    if (activeTab !== "user-distribution") {
      return;
    }

    let timeoutId: number | null = null;
    let cancelled = false;

    const scheduleNextRefresh = () => {
      const pollMs = oddsScope === "today" ? TODAY_DISTRIBUTION_POLL_MS : MATCHDAY_DISTRIBUTION_POLL_MS;
      timeoutId = window.setTimeout(async () => {
        if (cancelled) {
          return;
        }
        if (document.visibilityState === "visible") {
          await refreshUserDistribution({ silent: true });
        }
        scheduleNextRefresh();
      }, pollMs);
    };

    void refreshUserDistribution({ silent: true });
    scheduleNextRefresh();

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refreshUserDistribution({ silent: true });
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [activeTab, oddsScope, refreshUserDistribution]);

  const matchdayOptions = useMemo(() => {
    const grouped = new Map<string, { id: string; label: string; number: number }>();
    const sourceMatches: MatchdaySourceMatch[] =
      activeTab === "probabilities" ? oddsSneakPeek?.matches ?? [] : userDistribution?.matches ?? [];
    for (const match of sourceMatches) {
      if (!grouped.has(match.matchday_id)) {
        grouped.set(match.matchday_id, {
          id: match.matchday_id,
          label: buildMatchdayLabel(match),
          number: match.matchday_number,
        });
      }
    }
    return [...grouped.values()].sort((left, right) => left.number - right.number);
  }, [activeTab, oddsSneakPeek?.matches, userDistribution?.matches]);

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
    if (oddsScope === "locked") {
      return [];
    }
    return matches.filter((match) => match.matchday_id === selectedMatchdayId);
  }, [oddsScope, oddsSneakPeek?.matches, selectedMatchdayId]);

  const visibleDistributionMatches = useMemo(() => {
    const matches = userDistribution?.matches ?? [];
    if (oddsScope === "today") {
      const todayKey = getMexicoCityDateKey(new Date());
      return matches.filter((match) => getMexicoCityDateKey(match.kickoff_at) === todayKey);
    }
    if (oddsScope === "locked") {
      return matches.filter((match) => match.is_locked);
    }
    return matches.filter((match) => match.matchday_id === selectedMatchdayId);
  }, [oddsScope, selectedMatchdayId, userDistribution?.matches]);

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
        <h1 className="text-2xl font-semibold text-ink">
          {activeTab === "probabilities" ? "Probabilidades sin vig" : "Distribucion de usuarios"}
        </h1>
        <p className="max-w-3xl text-sm text-steel">
          {activeTab === "probabilities"
            ? "Probabilidad implicita justa por partido, normalizada para quitar el margen de la casa."
            : "Picks agregados en vivo: porcentaje Local, Empate, Visitante y marcadores mas repetidos."}
        </p>
      </section>

      <section className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            setActiveTab("probabilities");
            setOddsScope((current) => (current === "locked" ? "today" : current));
          }}
          className={activeTab === "probabilities" ? "app-pill-active min-w-[10rem] px-3" : "app-pill min-w-[10rem] px-3"}
        >
          Probabilidades
        </button>
        <button
          type="button"
          onClick={() => {
            setActiveTab("user-distribution");
            setOddsScope((current) => (current === "locked" ? "today" : current));
          }}
          className={activeTab === "user-distribution" ? "app-pill-active min-w-[12rem] px-3" : "app-pill min-w-[12rem] px-3"}
        >
          Distribucion de usuarios
        </button>
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
          {activeTab === "user-distribution" ? (
            <button
              type="button"
              onClick={() => setOddsScope("locked")}
              className={oddsScope === "locked" ? "app-pill-active min-w-[10rem] px-3" : "app-pill min-w-[10rem] px-3"}
            >
              Cerrados
            </button>
          ) : null}
        </div>

        <div className="flex flex-wrap items-end gap-3">
          {activeTab === "user-distribution" ? (
            <div className="text-right text-[11px] text-steel">
              <p>{oddsScope === "today" ? "Auto 10s" : "Auto 45s"}</p>
              <p>Actualizado {formatUpdatedAt(distributionUpdatedAt)}</p>
            </div>
          ) : null}
          {activeTab === "user-distribution" ? (
            <button
              type="button"
              onClick={() => refreshUserDistribution()}
              disabled={distributionRefreshing}
              className="app-pill h-10 px-4 text-sm disabled:opacity-60"
            >
              {distributionRefreshing ? "Actualizando..." : "Actualizar"}
            </button>
          ) : null}
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
        </div>
      </section>

      {activeTab === "probabilities" && visibleMatches.length > 0 ? (
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
                  <th className="px-3 py-2 text-right font-semibold">Local</th>
                  <th className="px-3 py-2 text-right font-semibold">Empate</th>
                  <th className="px-3 py-2 text-right font-semibold">Visitante</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {visibleMatches.map((match) => {
                  const probabilities: [number, number, number] = [
                    match.home_win_probability,
                    match.draw_probability,
                    match.away_win_probability,
                  ];
                  return (
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
                      <td className={`whitespace-nowrap px-3 py-2 text-right font-semibold ${getProbabilityTone(match.home_win_probability, probabilities)}`}>
                        {formatProbability(match.home_win_probability)}
                      </td>
                      <td className={`whitespace-nowrap px-3 py-2 text-right font-semibold ${getProbabilityTone(match.draw_probability, probabilities)}`}>
                        {formatProbability(match.draw_probability)}
                      </td>
                      <td className={`whitespace-nowrap px-3 py-2 text-right font-semibold ${getProbabilityTone(match.away_win_probability, probabilities)}`}>
                        {formatProbability(match.away_win_probability)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {activeTab === "user-distribution" && visibleDistributionMatches.length > 0 ? (
        <section className="overflow-hidden rounded-[12px] border border-white/[0.06] bg-white/[0.025]">
          <div className="overflow-x-auto">
            <table className="min-w-[960px] w-full table-fixed text-left text-xs text-steel">
              <colgroup>
                <col className="w-[96px]" />
                <col className="w-[130px]" />
                <col className="w-[340px]" />
                <col className="w-[78px]" />
                <col className="w-[78px]" />
                <col className="w-[78px]" />
                <col className="w-[92px]" />
                <col className="w-[260px]" />
              </colgroup>
              <thead className="border-b border-white/[0.06] text-[10px] uppercase tracking-[0.14em] text-steel">
                <tr>
                  <th className="px-3 py-2 font-semibold">Jornada</th>
                  <th className="px-3 py-2 font-semibold">Fecha</th>
                  <th className="px-3 py-2 font-semibold">Partido</th>
                  <th className="px-3 py-2 text-right font-semibold">Local</th>
                  <th className="px-3 py-2 text-right font-semibold">Empate</th>
                  <th className="px-3 py-2 text-right font-semibold">Visitante</th>
                  <th className="px-3 py-2 text-right font-semibold">Picks</th>
                  <th className="px-3 py-2 font-semibold">Marcadores</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {visibleDistributionMatches.map((match) => {
                  const distribution = match.selection_distribution;
                  const percentages: [number, number, number] = [
                    distribution.home_percentage,
                    distribution.draw_percentage,
                    distribution.away_percentage,
                  ];
                  return (
                    <tr key={match.match_id} className="transition hover:bg-white/[0.03]">
                      <td className="whitespace-nowrap px-3 py-2 text-[10px] uppercase tracking-[0.12em] text-steel">
                        {buildMatchdayLabel(match)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-[11px] text-steel">
                        {formatMexicoCityDateTime(match.kickoff_at)}
                      </td>
                      <td className="px-3 py-2">
                        <div className="grid gap-1">
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
                          <span
                            className={`w-fit rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] ${
                              match.is_locked
                                ? "border-moss/25 bg-moss/10 text-moss"
                                : "border-gold/25 bg-gold/10 text-gold"
                            }`}
                          >
                            {match.is_locked ? "Cerrado" : "Abierto"}
                          </span>
                        </div>
                      </td>
                      <td className={`whitespace-nowrap px-3 py-2 text-right font-semibold ${getProbabilityTone(distribution.home_percentage, percentages)}`}>
                        {formatProbability(distribution.home_percentage)}
                      </td>
                      <td className={`whitespace-nowrap px-3 py-2 text-right font-semibold ${getProbabilityTone(distribution.draw_percentage, percentages)}`}>
                        {formatProbability(distribution.draw_percentage)}
                      </td>
                      <td className={`whitespace-nowrap px-3 py-2 text-right font-semibold ${getProbabilityTone(distribution.away_percentage, percentages)}`}>
                        {formatProbability(distribution.away_percentage)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-semibold text-ink">
                        {match.total_picks}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1.5">
                          {match.score_distribution.map((score) => (
                            <span
                              key={score.score_label}
                              className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2 py-1 text-[10px] font-semibold text-ink"
                            >
                              {score.score_label} · {formatProbability(score.percentage)}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {((activeTab === "probabilities" && visibleMatches.length === 0) ||
        (activeTab === "user-distribution" && visibleDistributionMatches.length === 0)) ? (
        <section className="rounded-[16px] border border-white/[0.06] bg-white/[0.03] p-4">
          <p className="text-sm text-steel">
            {activeTab === "probabilities"
              ? "No hay odds mundialistas sincronizados para este filtro. Baja odds con `THE_ODDS_API_SPORT=soccer_fifa_world_cup` y luego sincroniza el snapshot contra los partidos del Mundial."
              : "No hay distribucion de usuarios para este filtro. Los datos aparecen cuando haya picks guardados."}
          </p>
        </section>
      ) : null}
    </div>
  );
}
