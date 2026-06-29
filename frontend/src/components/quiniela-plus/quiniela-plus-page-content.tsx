"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { backendFetch } from "@/lib/api/backend";
import { VIP_SUMMARY_PATH } from "@/lib/api/vip";
import { formatMexicoCityDateTime } from "@/lib/datetime/mexico-city";
import { getBrowserAccessToken } from "@/lib/supabase/session";
import type {
  Me,
  QuinielaPlusAdvancedStats,
  QuinielaPlusAdvancedStatsMatch,
  QuinielaPlusOddsSneakPeek,
  QuinielaPlusOddsSneakPeekMatch,
  QuinielaPlusUserDistribution,
  QuinielaPlusUserDistributionMatch,
  QuinielaPlusValueLab,
  VipCompetition,
} from "@/types/api";

type OddsScope = "today" | "tomorrow" | "matchday" | "locked";
type QuinielaPlusTab = "probabilities" | "value-lab" | "advanced-stats" | "user-distribution";
type ValueLabMode = "entries" | "open" | "history" | "all";
type ValueMarketFilter = "all" | "ml" | "draw" | "btts" | "over" | "under";
type MatchdaySourceMatch = Pick<QuinielaPlusOddsSneakPeekMatch, "matchday_id" | "matchday_name" | "matchday_number" | "kickoff_at">;
type DistributionContextOption = {
  value: string;
  label: string;
};
const TODAY_DISTRIBUTION_POLL_MS = 10_000;
const MATCHDAY_DISTRIBUTION_POLL_MS = 45_000;
const VALUE_MARKET_FILTERS: { value: ValueMarketFilter; label: string }[] = [
  { value: "all", label: "Todos" },
  { value: "ml", label: "ML" },
  { value: "draw", label: "Empate" },
  { value: "btts", label: "BTTS" },
  { value: "over", label: "Over" },
  { value: "under", label: "Under" },
];

function formatProbability(value: number) {
  return new Intl.NumberFormat("es-MX", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatWholePercent(value: number) {
  return `${value.toFixed(value >= 10 ? 1 : 2)}%`;
}

function formatDecimal(value: number) {
  return new Intl.NumberFormat("es-MX", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(value);
}

function formatSignedPercent(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const pct = value * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

function formatOddsValue(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 20) return value > 0 ? `+${Math.round(value)}` : `${Math.round(value)}`;
  return value.toFixed(2);
}

function formatProfitUnits(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}u`;
}

function formatStakeUnits(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) return "0u";
  return `${value.toFixed(2)}u`;
}

function entryGradeLabel(value: string | null | undefined) {
  if (value === "bet") return "Estrategia";
  if (value === "watch") return "Watch";
  if (value === "track") return "Track";
  return "Evitar";
}

function valueMarketLabel(marketKey: string, selectionKey: string, lineValue: number | null) {
  if (marketKey === "h2h") {
    if (selectionKey === "home") return "Local";
    if (selectionKey === "draw") return "Empate";
    if (selectionKey === "away") return "Visitante";
  }
  if (marketKey === "total") {
    return `${selectionKey === "over" ? "Over" : "Under"} ${lineValue ?? ""}`.trim();
  }
  if (marketKey === "btts_model") {
    return `BTTS ${selectionKey === "yes" ? "Si" : "No"}`;
  }
  return `${marketKey} ${selectionKey}`;
}

function valueMarketMatches(filter: ValueMarketFilter, marketKey: string, selectionKey: string) {
  if (filter === "all") return true;
  if (filter === "ml") return marketKey === "h2h" && selectionKey !== "draw";
  if (filter === "draw") return marketKey === "h2h" && selectionKey === "draw";
  if (filter === "btts") return marketKey === "btts_model";
  if (filter === "over") return marketKey === "total" && selectionKey === "over";
  if (filter === "under") return marketKey === "total" && selectionKey === "under";
  return true;
}

function normalizeSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function getMexicoCityDateKey(value: string | Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function getRelativeMexicoCityDateKey(daysToAdd: number) {
  const value = new Date();
  value.setDate(value.getDate() + daysToAdd);
  return getMexicoCityDateKey(value);
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

function buildDistributionUrl(contextValue: string) {
  if (!contextValue) {
    return "/quiniela-plus/user-distribution";
  }
  const [contextType, contextId] = contextValue.split(":");
  const params = new URLSearchParams();
  if (contextType) {
    params.set("context_type", contextType);
  }
  if (contextId) {
    params.set("context_id", contextId);
  }
  const query = params.toString();
  return query ? `/quiniela-plus/user-distribution?${query}` : "/quiniela-plus/user-distribution";
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
    return "text-[#3ff28a]";
  }
  if (rank === 1) {
    return "text-[#ffe45c]";
  }
  return "text-coral";
}

function getGoalDistribution(match: QuinielaPlusAdvancedStatsMatch, team: "home" | "away") {
  const labels = ["0", "1", "2", "3", "4", "5+"];
  return labels.map((label) => {
    const target = label === "5+" ? 5 : Number(label);
    let value = 0;
    for (const [score, probability] of Object.entries(match.scoreline_probabilities)) {
      const [homeScore, awayScore] = score.split("-").map(Number);
      const teamScore = team === "home" ? homeScore : awayScore;
      if (teamScore === target) {
        value += probability;
      }
    }
    return { label, value };
  });
}

function getScorelineGrid(match: QuinielaPlusAdvancedStatsMatch) {
  const labels = ["0", "1", "2", "3", "4", "5+"];
  return labels.map((homeLabel) =>
    labels.map((awayLabel) => {
      const homeScore = homeLabel === "5+" ? 5 : Number(homeLabel);
      const awayScore = awayLabel === "5+" ? 5 : Number(awayLabel);
      const key = `${homeScore}-${awayScore}`;
      return {
        key,
        homeLabel,
        awayLabel,
        value: match.scoreline_probabilities[key] ?? 0,
      };
    }),
  );
}

function getWinMarginRows(match: QuinielaPlusAdvancedStatsMatch) {
  const rows = [
    { label: `${match.home} gana por 3+`, value: 0, tone: "bg-[#4377ff]" },
    { label: `${match.home} gana por 2`, value: 0, tone: "bg-[#6aa0ff]" },
    { label: `${match.home} gana por 1`, value: 0, tone: "bg-[#9bc5ff]" },
    { label: "Empate", value: 0, tone: "bg-steel" },
    { label: `${match.away} gana por 1`, value: 0, tone: "bg-coral" },
    { label: `${match.away} gana por 2`, value: 0, tone: "bg-coral" },
    { label: `${match.away} gana por 3+`, value: 0, tone: "bg-coral" },
  ];

  for (const [score, probability] of Object.entries(match.scoreline_probabilities)) {
    const [homeScore, awayScore] = score.split("-").map(Number);
    const margin = homeScore - awayScore;
    if (margin >= 3) rows[0].value += probability;
    else if (margin === 2) rows[1].value += probability;
    else if (margin === 1) rows[2].value += probability;
    else if (margin === 0) rows[3].value += probability;
    else if (margin === -1) rows[4].value += probability;
    else if (margin === -2) rows[5].value += probability;
    else rows[6].value += probability;
  }

  return rows.filter((row) => row.value > 0.05);
}

function getCleanSheetProbability(match: QuinielaPlusAdvancedStatsMatch, team: "home" | "away") {
  let value = 0;
  for (const [score, probability] of Object.entries(match.scoreline_probabilities)) {
    const [homeScore, awayScore] = score.split("-").map(Number);
    if (team === "home" && awayScore === 0) {
      value += probability;
    }
    if (team === "away" && homeScore === 0) {
      value += probability;
    }
  }
  return value;
}

function PercentBar({ value, tone = "bg-[#4fd19b]" }: { value: number; tone?: string }) {
  return (
    <div className="grid grid-cols-[minmax(80px,1fr)_64px] items-center gap-3">
      <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.05]">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.min(Math.max(value, 0), 100)}%` }} />
      </div>
      <span className="text-right text-xs text-ink">{formatWholePercent(value)}</span>
    </div>
  );
}

function AdvancedStatsCard({ match, defaultOpen }: { match: QuinielaPlusAdvancedStatsMatch; defaultOpen: boolean }) {
  const homeGoals = getGoalDistribution(match, "home");
  const awayGoals = getGoalDistribution(match, "away");
  const scorelineGrid = getScorelineGrid(match);
  const winMargins = getWinMarginRows(match);
  const topScorelineValue = Math.max(...Object.values(match.scoreline_probabilities), 1);
  const homeCleanSheet = getCleanSheetProbability(match, "home");
  const awayCleanSheet = getCleanSheetProbability(match, "away");

  return (
    <details
      open={defaultOpen}
      className="group overflow-hidden rounded-[12px] border border-white/[0.08] bg-white/[0.025]"
    >
      <summary className="grid cursor-pointer list-none gap-3 px-4 py-4 transition hover:bg-white/[0.035] md:grid-cols-[120px_minmax(0,1fr)_auto] md:items-center">
        <div className="text-xs text-steel">
          <p className="font-semibold uppercase tracking-[0.16em]">Grupo {match.group ?? "-"}</p>
          <p>{formatMexicoCityDateTime(match.kickoff_at)}</p>
        </div>
        <div className="min-w-0">
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 text-sm md:text-base">
            <span className="truncate text-right text-ink">{match.home}</span>
            <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-4 py-1 text-xs text-steel">
              vs
            </span>
            <span className="truncate text-ink">{match.away}</span>
          </div>
          <div className="mt-2 flex flex-wrap justify-center gap-2 text-[11px] text-ink">
            <span className="rounded-[6px] border border-white/[0.08] bg-white/[0.04] px-2 py-1">
              {formatWholePercent(match.home_win_prob)}
            </span>
            <span className="rounded-[6px] border border-white/[0.08] bg-white/[0.04] px-2 py-1">
              {formatWholePercent(match.draw_prob)}
            </span>
            <span className="rounded-[6px] border border-white/[0.08] bg-white/[0.04] px-2 py-1">
              {formatWholePercent(match.away_win_prob)}
            </span>
          </div>
        </div>
        <span className="text-right text-xs uppercase tracking-[0.16em] text-steel group-open:text-[#3ff28a]">
          Detalle
        </span>
      </summary>

      <div className="space-y-6 border-t border-white/[0.06] px-4 py-5">
        <div className="grid gap-4 lg:grid-cols-4">
          <div className="rounded-[10px] border border-white/[0.06] bg-white/[0.025] p-4">
            <p className="text-[10px] uppercase tracking-[0.16em] text-steel">xG</p>
            <p className="mt-2 text-lg text-ink">
              {match.home} {formatDecimal(match.xg_home)} - {formatDecimal(match.xg_away)} {match.away}
            </p>
          </div>
          <div className="rounded-[10px] border border-white/[0.06] bg-white/[0.025] p-4">
            <p className="text-[10px] uppercase tracking-[0.16em] text-steel">Marcador mas probable</p>
            <p className="mt-2 text-lg font-semibold text-ink">{match.most_likely_score}</p>
            <p className="text-xs text-steel">{formatWholePercent(match.most_likely_score_prob)}</p>
          </div>
          <div className="rounded-[10px] border border-white/[0.06] bg-white/[0.025] p-4">
            <p className="text-[10px] uppercase tracking-[0.16em] text-steel">Ambos anotan</p>
            <p className="mt-2 text-lg font-semibold text-ink">{formatWholePercent(match.btts_prob)}</p>
          </div>
          <div className="rounded-[10px] border border-white/[0.06] bg-white/[0.025] p-4">
            <p className="text-[10px] uppercase tracking-[0.16em] text-steel">Favorito</p>
            <p className="mt-2 text-lg text-ink">
              {match.home_win_prob >= match.away_win_prob ? match.home : match.away}
            </p>
            <p className="text-xs text-steel">
              {formatWholePercent(Math.max(match.home_win_prob, match.away_win_prob))}
            </p>
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <div>
            <h3 className="text-sm text-ink">Goles por equipo</h3>
            <div className="mt-3 grid gap-4 md:grid-cols-2">
              {[{ name: match.home, rows: homeGoals, tone: "bg-[#6797ff]" }, { name: match.away, rows: awayGoals, tone: "bg-coral" }].map((team) => (
                <div key={team.name} className="space-y-2">
                  <p className="text-xs text-ink">{team.name}</p>
                  {team.rows.map((row) => (
                    <div key={row.label} className="grid grid-cols-[24px_minmax(0,1fr)_48px] items-center gap-2 text-xs">
                      <span className="text-steel">{row.label}</span>
                      <div className="h-3 overflow-hidden rounded-full bg-white/[0.04]">
                        <div className={`h-full rounded-[6px] ${team.tone}`} style={{ width: `${Math.min(row.value, 100)}%` }} />
                      </div>
                      <span className="text-right text-ink">{formatWholePercent(row.value)}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-1">
            <div>
              <h3 className="text-sm text-ink">Over / under</h3>
              <div className="mt-3 grid gap-3">
                <div className="grid grid-cols-[90px_minmax(0,1fr)] items-center gap-3 text-sm">
                  <span className="text-ink">Over 1.5</span>
                  <PercentBar value={match.over_1_5_prob} />
                </div>
                <div className="grid grid-cols-[90px_minmax(0,1fr)] items-center gap-3 text-sm">
                  <span className="text-ink">Over 2.5</span>
                  <PercentBar value={match.over_2_5_prob} />
                </div>
                <div className="grid grid-cols-[90px_minmax(0,1fr)] items-center gap-3 text-sm">
                  <span className="text-ink">Over 3.5</span>
                  <PercentBar value={match.over_3_5_prob} />
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-sm text-ink">Otros mercados</h3>
              <div className="mt-3 grid gap-3">
                <div className="grid grid-cols-[minmax(120px,1fr)_minmax(0,1fr)] items-center gap-3 text-sm">
                  <span className="text-ink">Ambos anotan</span>
                  <PercentBar value={match.btts_prob} tone="bg-[#ffb52e]" />
                </div>
                <div className="grid grid-cols-[minmax(120px,1fr)_minmax(0,1fr)] items-center gap-3 text-sm">
                  <span className="text-ink">{match.home} clean sheet</span>
                  <PercentBar value={homeCleanSheet} tone="bg-[#ffb52e]" />
                </div>
                <div className="grid grid-cols-[minmax(120px,1fr)_minmax(0,1fr)] items-center gap-3 text-sm">
                  <span className="text-ink">{match.away} clean sheet</span>
                  <PercentBar value={awayCleanSheet} tone="bg-[#ffb52e]" />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div>
          <h3 className="text-sm text-ink">Probabilidades de marcador</h3>
          <div className="mt-3 overflow-x-auto">
            <div className="min-w-[680px]">
              <div className="mb-1 grid grid-cols-[48px_repeat(6,minmax(72px,1fr))] gap-1 text-center text-xs text-steel">
                <span className="text-left">{match.home} goles</span>
                <span className="col-span-6">{match.away} goles</span>
              </div>
              <div className="mb-2 grid grid-cols-[48px_repeat(6,minmax(72px,1fr))] gap-1 text-center text-xs text-steel">
                <span />
                {["0", "1", "2", "3", "4", "5+"].map((label) => (
                  <span key={label}>{label}</span>
                ))}
              </div>
              <div className="grid gap-1">
                {scorelineGrid.map((row, rowIndex) => (
                  <div key={rowIndex} className="grid grid-cols-[48px_repeat(6,minmax(72px,1fr))] gap-1">
                    <span className="flex items-center justify-center text-xs text-steel">{row[0].homeLabel}</span>
                    {row.map((cell) => {
                      const opacity = Math.max(0.08, Math.min(0.85, cell.value / topScorelineValue));
                      return (
                        <div
                          key={cell.key}
                          className="rounded-[6px] px-2 py-2 text-center text-xs text-ink"
                          style={{ backgroundColor: `rgba(63, 242, 138, ${opacity})` }}
                        >
                          {cell.value > 0 ? formatWholePercent(cell.value) : "-"}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
          <p className="mt-2 text-xs text-steel">Mas intenso = mas probable.</p>
        </div>

        <div>
          <h3 className="text-sm text-ink">Margen de victoria</h3>
          <div className="mt-3 space-y-2">
            {winMargins.map((row) => (
              <div key={row.label} className="grid grid-cols-[170px_minmax(0,1fr)_58px] items-center gap-3 text-xs">
                <span className="truncate text-right text-steel">{row.label}</span>
                <div className="h-3 overflow-hidden rounded-full bg-white/[0.05]">
                  <div className={`h-full rounded-[6px] ${row.tone}`} style={{ width: `${Math.min(row.value, 100)}%` }} />
                </div>
                <span className="text-right text-ink">{formatWholePercent(row.value)}</span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h3 className="text-sm text-ink">Cuotas implicitas sin margen</h3>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            {[
              { label: match.home, odds: match.implied_odds_home, probability: match.home_win_prob },
              { label: "Empate", odds: match.implied_odds_draw, probability: match.draw_prob },
              { label: match.away, odds: match.implied_odds_away, probability: match.away_win_prob },
            ].map((row) => (
              <div key={row.label} className="rounded-[10px] border border-white/[0.06] bg-white/[0.025] p-4 text-center">
                <p className="truncate text-sm text-steel">{row.label}</p>
                <p className="mt-2 text-xl font-semibold text-ink">{formatDecimal(row.odds)}</p>
                <p className="text-xs text-steel">{formatWholePercent(row.probability)}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </details>
  );
}

export function QuinielaPlusPageContent() {
  const [me, setMe] = useState<Me | null>(null);
  const [vipCompetitions, setVipCompetitions] = useState<VipCompetition[]>([]);
  const [oddsSneakPeek, setOddsSneakPeek] = useState<QuinielaPlusOddsSneakPeek | null>(null);
  const [userDistribution, setUserDistribution] = useState<QuinielaPlusUserDistribution | null>(null);
  const [advancedStats, setAdvancedStats] = useState<QuinielaPlusAdvancedStats | null>(null);
  const [valueLab, setValueLab] = useState<QuinielaPlusValueLab | null>(null);
  const [loading, setLoading] = useState(true);
  const [distributionRefreshing, setDistributionRefreshing] = useState(false);
  const [distributionUpdatedAt, setDistributionUpdatedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<QuinielaPlusTab>("probabilities");
  const [oddsScope, setOddsScope] = useState<OddsScope>("today");
  const [valueLabMode, setValueLabMode] = useState<ValueLabMode>("entries");
  const [valueMarketFilter, setValueMarketFilter] = useState<ValueMarketFilter>("all");
  const [valueTeamQuery, setValueTeamQuery] = useState("");
  const [selectedMatchdayId, setSelectedMatchdayId] = useState("");
  const [selectedDistributionContext, setSelectedDistributionContext] = useState("");

  const distributionContextOptions = useMemo<DistributionContextOption[]>(() => {
    const seasonOptions =
      me?.season_memberships
        .filter((membership) => membership.can_participate)
        .map((membership) => ({
          value: `season:${membership.season_id}`,
          label: `Torneo regular · ${membership.season_name}`,
        })) ?? [];
    const vipOptions = vipCompetitions
      .filter((vip) => vip.competition_kind === "matchday" && vip.my_membership?.status === "approved")
      .map((vip) => ({
        value: `vip:${vip.id}`,
        label: `VIP · ${vip.name}`,
      }));
    return [...seasonOptions, ...vipOptions];
  }, [me, vipCompetitions]);

  const refreshUserDistribution = useCallback(
    async ({ silent = false, contextValue }: { silent?: boolean; contextValue?: string } = {}) => {
      if (!silent) {
        setDistributionRefreshing(true);
      }
      try {
        const accessToken = await getBrowserAccessToken();
        const distributionResponse = await backendFetch<QuinielaPlusUserDistribution>(
          buildDistributionUrl(contextValue ?? selectedDistributionContext),
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
    [selectedDistributionContext],
  );

  useEffect(() => {
    async function loadInitialData() {
      try {
        const accessToken = await getBrowserAccessToken();
        const [meResponse, vipResponse, oddsResponse, advancedStatsResponse, valueLabResponse] = await Promise.all([
          backendFetch<Me>("/me", accessToken),
          backendFetch<VipCompetition[]>(VIP_SUMMARY_PATH, accessToken),
          backendFetch<QuinielaPlusOddsSneakPeek>("/quiniela-plus/odds-sneak-peek", accessToken),
          backendFetch<QuinielaPlusAdvancedStats>("/quiniela-plus/advanced-stats", accessToken),
          backendFetch<QuinielaPlusValueLab>("/quiniela-plus/value-lab", accessToken),
        ]);
        setMe(meResponse);
        setVipCompetitions(vipResponse);
        setOddsSneakPeek(oddsResponse);
        setAdvancedStats(advancedStatsResponse);
        setValueLab(valueLabResponse);
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
    setSelectedDistributionContext((current) => {
      if (distributionContextOptions.some((option) => option.value === current)) {
        return current;
      }
      return distributionContextOptions[0]?.value ?? "";
    });
  }, [distributionContextOptions]);

  useEffect(() => {
    if (loading || activeTab !== "user-distribution" || !selectedDistributionContext) {
      return;
    }
    void refreshUserDistribution({ silent: true, contextValue: selectedDistributionContext });
  }, [activeTab, loading, refreshUserDistribution, selectedDistributionContext]);

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

    if (selectedDistributionContext) {
      void refreshUserDistribution({ silent: true, contextValue: selectedDistributionContext });
    }
    scheduleNextRefresh();

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refreshUserDistribution({ silent: true, contextValue: selectedDistributionContext });
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
  }, [activeTab, oddsScope, refreshUserDistribution, selectedDistributionContext]);

  const matchdayOptions = useMemo(() => {
    const grouped = new Map<string, { id: string; label: string; number: number; kickoffAt: string }>();
    const sourceMatches: MatchdaySourceMatch[] =
      activeTab === "probabilities"
        ? oddsSneakPeek?.matches ?? []
        : activeTab === "user-distribution"
          ? userDistribution?.matches ?? []
          : [];
    for (const match of sourceMatches) {
      if (!grouped.has(match.matchday_id)) {
        grouped.set(match.matchday_id, {
          id: match.matchday_id,
          label: buildMatchdayLabel(match),
          number: match.matchday_number,
          kickoffAt: match.kickoff_at,
        });
      }
    }
    return [...grouped.values()].sort((left, right) => {
      const byKickoff = new Date(left.kickoffAt).getTime() - new Date(right.kickoffAt).getTime();
      return byKickoff === 0 ? left.number - right.number : byKickoff;
    });
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
      const todayKey = getRelativeMexicoCityDateKey(0);
      return matches.filter((match) => getMexicoCityDateKey(match.kickoff_at) === todayKey);
    }
    if (oddsScope === "tomorrow") {
      const tomorrowKey = getRelativeMexicoCityDateKey(1);
      return matches.filter((match) => getMexicoCityDateKey(match.kickoff_at) === tomorrowKey);
    }
    if (oddsScope === "locked") {
      return [];
    }
    return matches.filter((match) => match.matchday_id === selectedMatchdayId);
  }, [oddsScope, oddsSneakPeek?.matches, selectedMatchdayId]);

  const visibleDistributionMatches = useMemo(() => {
    const matches = userDistribution?.matches ?? [];
    if (oddsScope === "today") {
      const todayKey = getRelativeMexicoCityDateKey(0);
      return matches.filter((match) => getMexicoCityDateKey(match.kickoff_at) === todayKey);
    }
    if (oddsScope === "tomorrow") {
      const tomorrowKey = getRelativeMexicoCityDateKey(1);
      return matches.filter((match) => getMexicoCityDateKey(match.kickoff_at) === tomorrowKey);
    }
    if (oddsScope === "locked") {
      return matches.filter((match) => match.is_locked);
    }
    return matches.filter((match) => match.matchday_id === selectedMatchdayId);
  }, [oddsScope, selectedMatchdayId, userDistribution?.matches]);

  const visibleAdvancedStatsMatches = advancedStats?.matches ?? [];
  const valueRecommendations = valueLab?.recommendations ?? [];
  const valueTrackStats = valueLab?.track_stats ?? [];
  const normalizedValueTeamQuery = normalizeSearch(valueTeamQuery);
  const valueLabSummary = useMemo(() => {
    const settled = valueRecommendations.filter((item) => item.outcome_status === "settled" || item.outcome_status === "push");
    const hits = settled.filter((item) => item.is_hit).length;
    const trackedProfit = settled.reduce((total, item) => total + (item.profit_units ?? 0), 0);
    return {
      entries: valueRecommendations.filter((item) => item.outcome_status === "pending" && item.suggested_units > 0).length,
      entryUnits: valueRecommendations
        .filter((item) => item.outcome_status === "pending" && item.suggested_units > 0)
        .reduce((total, item) => total + item.suggested_units, 0),
      open: valueRecommendations.filter((item) => item.outcome_status === "pending").length,
      settled: settled.length,
      hits,
      trackedProfit,
      hitRate: settled.length > 0 ? hits / settled.length : null,
    };
  }, [valueRecommendations]);
  const modeValueRecommendations = useMemo(() => {
    if (valueLabMode === "entries") {
      return valueRecommendations.filter((item) => item.outcome_status === "pending" && item.suggested_units > 0);
    }
    if (valueLabMode === "open") {
      return valueRecommendations.filter((item) => item.outcome_status === "pending");
    }
    if (valueLabMode === "history") {
      return valueRecommendations.filter((item) => item.outcome_status === "settled" || item.outcome_status === "push");
    }
    return valueRecommendations;
  }, [valueLabMode, valueRecommendations]);
  const visibleValueRecommendations = useMemo(() => {
    return modeValueRecommendations.filter((item) => {
      if (!valueMarketMatches(valueMarketFilter, item.market_key, item.selection_key)) {
        return false;
      }
      if (!normalizedValueTeamQuery) {
        return true;
      }
      const home = normalizeSearch(item.home);
      const away = normalizeSearch(item.away);
      return home.includes(normalizedValueTeamQuery) || away.includes(normalizedValueTeamQuery);
    });
  }, [modeValueRecommendations, normalizedValueTeamQuery, valueMarketFilter]);

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
          {activeTab === "probabilities"
            ? "Probabilidades sin vig"
            : activeTab === "value-lab"
              ? "Value Lab"
              : activeTab === "advanced-stats"
                ? "Estadisticas avanzadas"
                : "Distribucion de usuarios"}
        </h1>
        <p className="max-w-3xl text-sm text-steel">
          {activeTab === "probabilities"
            ? "Probabilidad implicita justa por partido, normalizada para quitar el margen de la casa."
            : activeTab === "value-lab"
              ? "Recomendaciones paper: compara AI Quinielón contra mercado real para detectar edge antes de arriesgar dinero."
              : activeTab === "advanced-stats"
                ? "Modelo avanzado por partido: xG, marcador probable, goles esperados, over/under y mapa de marcadores."
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
        <button
          type="button"
          onClick={() => {
            setActiveTab("value-lab");
            setOddsScope("today");
          }}
          className={activeTab === "value-lab" ? "app-pill-active min-w-[10rem] px-3" : "app-pill min-w-[10rem] px-3"}
        >
          Value Lab
        </button>
        <button
          type="button"
          onClick={() => {
            setActiveTab("advanced-stats");
            setOddsScope("today");
          }}
          className={activeTab === "advanced-stats" ? "app-pill-active min-w-[12rem] px-3" : "app-pill min-w-[12rem] px-3"}
        >
          Estadisticas avanzadas
        </button>
      </section>

      {activeTab !== "advanced-stats" && activeTab !== "value-lab" ? (
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
            onClick={() => setOddsScope("tomorrow")}
            className={oddsScope === "tomorrow" ? "app-pill-active min-w-[10rem] px-3" : "app-pill min-w-[10rem] px-3"}
          >
            Mañana
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
          {activeTab === "user-distribution" && distributionContextOptions.length > 0 ? (
            <label className="w-full max-w-[360px] space-y-2 text-sm sm:w-auto">
              <span className="text-steel">Contexto</span>
              <select
                value={selectedDistributionContext}
                onChange={(event) => setSelectedDistributionContext(event.target.value)}
                className="field-control"
              >
                {distributionContextOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      </section>
      ) : null}

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
        <section className="grid gap-3">
          {visibleDistributionMatches.map((match) => {
            const distribution = match.selection_distribution;
            const percentages: [number, number, number] = [
              distribution.home_percentage,
              distribution.draw_percentage,
              distribution.away_percentage,
            ];
            const scoreTotal = match.score_distribution.reduce((total, score) => total + score.count, 0);
            return (
              <article
                key={match.match_id}
                className="rounded-[12px] border border-white/[0.06] bg-white/[0.025] p-3 transition hover:bg-white/[0.035] md:p-4"
              >
                <div className="grid gap-3 lg:grid-cols-[minmax(220px,1.1fr)_minmax(240px,0.9fr)_minmax(280px,1.15fr)] lg:items-start">
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.12em] text-steel">
                      <span>{buildMatchdayLabel(match)}</span>
                      <span className="h-1 w-1 rounded-full bg-steel/50" />
                      <span>{formatMexicoCityDateTime(match.kickoff_at)}</span>
                      <span
                        className={`rounded-full border px-2 py-0.5 font-semibold ${
                          match.is_locked
                            ? "border-[#3ff28a]/25 bg-[#3ff28a]/10 text-[#3ff28a]"
                            : "border-[#ffe45c]/25 bg-[#ffe45c]/10 text-[#ffe45c]"
                        }`}
                      >
                        {match.is_locked ? "Cerrado" : "Abierto"}
                      </span>
                    </div>
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
                  </div>

                  <div className="grid grid-cols-4 gap-1.5 text-center text-[11px] sm:gap-2">
                    {[
                      { label: "Local", value: distribution.home_percentage },
                      { label: "Empate", value: distribution.draw_percentage },
                      { label: "Visitante", value: distribution.away_percentage },
                    ].map((item) => (
                      <div key={item.label} className="rounded-[8px] border border-white/[0.06] bg-white/[0.025] px-2 py-2">
                        <p className="text-[9px] uppercase tracking-[0.12em] text-steel">{item.label}</p>
                        <p className={`mt-1 font-semibold ${getProbabilityTone(item.value, percentages)}`}>
                          {formatProbability(item.value)}
                        </p>
                      </div>
                    ))}
                    <div className="rounded-[8px] border border-white/[0.06] bg-white/[0.025] px-2 py-2">
                      <p className="text-[9px] uppercase tracking-[0.12em] text-steel">Picks</p>
                      <p className="mt-1 font-semibold text-ink">{match.total_picks}</p>
                    </div>
                  </div>

                  <div className="min-w-0">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-steel">Marcadores</p>
                      {scoreTotal > 0 ? (
                        <span className="text-[10px] text-steel">{scoreTotal} con marcador</span>
                      ) : null}
                    </div>
                    {match.score_distribution.length > 0 ? (
                      <div className="grid grid-cols-[repeat(auto-fit,minmax(96px,1fr))] gap-1.5">
                        {match.score_distribution.slice(0, 6).map((score, index) => (
                          <div
                            key={score.score_label}
                            className={`rounded-[7px] border px-2 py-1.5 ${
                              index === 0
                                ? "border-[#ffe45c]/25 bg-[#ffe45c]/10"
                                : "border-white/[0.06] bg-white/[0.025]"
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-semibold text-ink">{score.score_label}</span>
                              <span className="font-semibold text-[#ffe45c]">{formatProbability(score.percentage)}</span>
                            </div>
                            <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/[0.06]">
                              <div
                                className="h-full rounded-full bg-[#ffe45c]"
                                style={{ width: `${Math.min(Math.max(score.percentage * 100, 0), 100)}%` }}
                              />
                            </div>
                            <p className="mt-1 text-right text-[10px] text-steel">{score.count} picks</p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <span className="text-[10px] text-steel">Sin marcadores capturados</span>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </section>
      ) : null}

      {activeTab === "value-lab" && valueRecommendations.length > 0 ? (
        <section className="space-y-3">
          {valueTrackStats.length > 0 ? (
            <div className="grid gap-2 md:grid-cols-3">
              {valueTrackStats.map((stats) => (
                <div
                  key={stats.label}
                  className="rounded-[10px] border border-white/[0.06] bg-white/[0.025] px-3 py-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-steel">
                      {stats.label}
                    </p>
                    <p className={`text-xs font-semibold ${
                      stats.profit_units > 0
                        ? "text-[#3ff28a]"
                        : stats.profit_units < 0
                          ? "text-[#ff8a8a]"
                          : "text-steel"
                    }`}>
                      {formatProfitUnits(stats.profit_units)}
                    </p>
                  </div>
                  <div className="mt-3 grid grid-cols-4 gap-2 text-xs">
                    <div>
                      <p className="text-[9px] uppercase tracking-[0.12em] text-steel">W-L-P</p>
                      <p className="mt-1 font-semibold text-ink">
                        {stats.wins}-{stats.losses}-{stats.pushes}
                      </p>
                    </div>
                    <div>
                      <p className="text-[9px] uppercase tracking-[0.12em] text-steel">Open</p>
                      <p className="mt-1 font-semibold text-ink">{stats.open}</p>
                    </div>
                    <div>
                      <p className="text-[9px] uppercase tracking-[0.12em] text-steel">U</p>
                      <p className="mt-1 font-semibold text-ink">{formatStakeUnits(stats.staked_units)}</p>
                    </div>
                    <div>
                      <p className="text-[9px] uppercase tracking-[0.12em] text-steel">ROI</p>
                      <p className="mt-1 font-semibold text-ink">
                        {stats.roi === null ? "—" : formatSignedPercent(stats.roi)}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                {([
                  ["entries", `Entradas ${valueLabSummary.entries}`],
                  ["open", `Abiertas ${valueLabSummary.open}`],
                  ["history", `Historial ${valueLabSummary.settled}`],
                  ["all", `Todas ${valueRecommendations.length}`],
                ] as const).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setValueLabMode(mode)}
                    className={valueLabMode === mode ? "app-pill-active px-3 py-2 text-xs" : "app-pill px-3 py-2 text-xs"}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-steel">
                {valueLabMode === "history"
                  ? `${valueLabSummary.hits}/${valueLabSummary.settled} pegadas · ${valueLabSummary.hitRate === null ? "sin hit rate" : formatProbability(valueLabSummary.hitRate)} · ${formatProfitUnits(valueLabSummary.trackedProfit)}`
                  : valueLabMode === "entries"
                    ? `${visibleValueRecommendations.length} entradas · ${formatStakeUnits(valueLabSummary.entryUnits)} sugeridas`
                  : `${visibleValueRecommendations.length} recomendaciones paper`}
              </p>
            </div>
            <span className="text-xs text-steel">
              Generado {valueLab?.generated_at ? formatMexicoCityDateTime(valueLab.generated_at) : "sin fecha"}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {VALUE_MARKET_FILTERS.map((filter) => (
              <button
                key={filter.value}
                type="button"
                onClick={() => setValueMarketFilter(filter.value)}
                className={valueMarketFilter === filter.value ? "app-pill-active px-3 py-2 text-xs" : "app-pill px-3 py-2 text-xs"}
              >
                {filter.label}
              </button>
            ))}
            <input
              type="search"
              value={valueTeamQuery}
              onChange={(event) => setValueTeamQuery(event.target.value)}
              placeholder="País"
              className="min-h-[38px] min-w-[11rem] rounded-[10px] border border-white/[0.08] bg-white/[0.035] px-3 text-xs font-semibold text-ink outline-none transition placeholder:text-steel focus:border-[#3ff28a]/40"
            />
          </div>
          {visibleValueRecommendations.length > 0 ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {visibleValueRecommendations.map((item) => {
              const isValue = item.recommendation === "paper_value";
              const isModelOnly = item.recommendation === "model_only";
              const isSettled = item.outcome_status === "settled" || item.outcome_status === "push";
              const statusLabel =
                item.outcome_status === "push"
                  ? "Push"
                    : isSettled
                      ? item.is_hit
                        ? "Pegó"
                        : "Falló"
                    : item.entry_grade === "bet" && item.suggested_units > 0
                      ? "Entrar"
                    : item.entry_grade === "watch"
                      ? "Watch"
                    : isValue
                      ? "Value"
                      : isModelOnly
                        ? "Modelo"
                        : "Watch";
              return (
                <article
                  key={item.id}
                  className={`rounded-[12px] border p-4 ${
                    isSettled && item.is_hit
                      ? "border-[#3ff28a]/20 bg-[#3ff28a]/[0.045]"
                      : isSettled
                        ? "border-[#ff6b6b]/20 bg-[#ff6b6b]/[0.035]"
                        : isValue
                      ? "border-[#3ff28a]/20 bg-[#3ff28a]/[0.045]"
                      : isModelOnly
                        ? "border-[#ffe45c]/15 bg-[#ffe45c]/[0.035]"
                        : "border-white/[0.06] bg-white/[0.025]"
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[10px] uppercase tracking-[0.14em] text-steel">
                        {item.kickoff_at ? formatMexicoCityDateTime(item.kickoff_at) : "Sin fecha"}
                      </p>
                      <h3 className="mt-1 truncate text-sm font-semibold text-ink">
                        {item.home} vs {item.away}
                      </h3>
                    </div>
                    <span
                      className={`rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${
                        isSettled && item.is_hit
                          ? "border-[#3ff28a]/25 text-[#3ff28a]"
                          : isSettled
                            ? "border-[#ff6b6b]/25 text-[#ff8a8a]"
                            : item.entry_grade === "watch"
                              ? "border-[#ffe45c]/25 text-[#ffe45c]"
                            : isValue
                              ? "border-[#3ff28a]/25 text-[#3ff28a]"
                              : isModelOnly
                                ? "border-[#ffe45c]/25 text-[#ffe45c]"
                                : "border-white/[0.08] text-steel"
                      }`}
                    >
                      {statusLabel}
                    </span>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
                    <div className="rounded-[8px] border border-white/[0.06] bg-white/[0.025] px-2 py-2">
                      <p className="text-[9px] uppercase tracking-[0.12em] text-steel">Mercado</p>
                      <p className="mt-1 text-xs font-semibold text-ink">
                        {valueMarketLabel(item.market_key, item.selection_key, item.line_value)}
                      </p>
                    </div>
                    <div className="rounded-[8px] border border-white/[0.06] bg-white/[0.025] px-2 py-2">
                      <p className="text-[9px] uppercase tracking-[0.12em] text-steel">Modelo</p>
                      <p className="mt-1 text-xs font-semibold text-ink">
                        {item.model_probability === null ? "—" : formatProbability(item.model_probability)}
                      </p>
                    </div>
                    <div className="rounded-[8px] border border-white/[0.06] bg-white/[0.025] px-2 py-2">
                      <p className="text-[9px] uppercase tracking-[0.12em] text-steel">Mercado</p>
                      <p className="mt-1 text-xs font-semibold text-ink">
                        {item.market_probability === null ? "—" : formatProbability(item.market_probability)}
                      </p>
                    </div>
                    <div className="rounded-[8px] border border-white/[0.06] bg-white/[0.025] px-2 py-2">
                      <p className="text-[9px] uppercase tracking-[0.12em] text-steel">Odds</p>
                      <p className="mt-1 text-xs font-semibold text-ink">{formatOddsValue(item.market_odds)}</p>
                    </div>
                    <div className="rounded-[8px] border border-white/[0.06] bg-white/[0.025] px-2 py-2">
                      <p className="text-[9px] uppercase tracking-[0.12em] text-steel">Edge</p>
                      <p className={`mt-1 text-xs font-semibold ${Number(item.edge_probability) > 0 ? "text-[#3ff28a]" : "text-steel"}`}>
                        {formatSignedPercent(item.edge_probability)}
                      </p>
                    </div>
                    <div className="rounded-[8px] border border-white/[0.06] bg-white/[0.025] px-2 py-2">
                      <p className="text-[9px] uppercase tracking-[0.12em] text-steel">Stake</p>
                      <p className="mt-1 text-xs font-semibold text-ink">{formatStakeUnits(item.suggested_units)}</p>
                      <p className="mt-0.5 text-[10px] text-steel">{formatProbability(item.stake_bankroll_pct)}</p>
                    </div>
                    <div className="rounded-[8px] border border-white/[0.06] bg-white/[0.025] px-2 py-2">
                      <p className="text-[9px] uppercase tracking-[0.12em] text-steel">
                        {isSettled ? "Resultado" : "Rango"}
                      </p>
                      <p className="mt-1 text-xs font-semibold text-ink">
                        {isSettled ? item.result_label ?? "Pend." : item.odds_bucket ?? "—"}
                      </p>
                    </div>
                    <div className="rounded-[8px] border border-white/[0.06] bg-white/[0.025] px-2 py-2">
                      <p className="text-[9px] uppercase tracking-[0.12em] text-steel">P/L</p>
                      <p className={`mt-1 text-xs font-semibold ${
                        Number(item.profit_units) > 0
                          ? "text-[#3ff28a]"
                          : Number(item.profit_units) < 0
                            ? "text-[#ff8a8a]"
                            : "text-steel"
                      }`}>
                        {formatProfitUnits(item.profit_units)}
                      </p>
                    </div>
                  </div>
                  <p className="mt-3 text-xs text-steel">
                    <span className="font-semibold text-ink">{entryGradeLabel(item.entry_grade)}</span>
                    {item.market_segment || item.odds_bucket ? " · " : ""}
                    {item.market_segment ? `${item.market_segment}` : ""}
                    {item.market_segment && item.odds_bucket ? " · " : ""}
                    {item.odds_bucket ? `${item.odds_bucket}. ` : " "}
                    {item.stake_reason ? `${item.stake_reason} ` : ""}
                    {item.reason}
                  </p>
                </article>
              );
            })}
          </div>
          ) : (
            <section className="rounded-[12px] border border-white/[0.06] bg-white/[0.03] p-4">
              <p className="text-sm text-steel">No hay tarjetas para ese filtro.</p>
            </section>
          )}
        </section>
      ) : null}

      {activeTab === "advanced-stats" && visibleAdvancedStatsMatches.length > 0 ? (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-steel">
            <span>{visibleAdvancedStatsMatches.length} partidos con analitica avanzada</span>
            <span>
              Generado{" "}
              {advancedStats?.generated_at ? formatMexicoCityDateTime(advancedStats.generated_at) : "sin fecha"}
            </span>
          </div>
          {visibleAdvancedStatsMatches.map((match, index) => (
            <AdvancedStatsCard key={match.fixture_id} match={match} defaultOpen={index === 0} />
          ))}
        </section>
      ) : null}

      {((activeTab === "probabilities" && visibleMatches.length === 0) ||
        (activeTab === "value-lab" && valueRecommendations.length === 0) ||
        (activeTab === "advanced-stats" && visibleAdvancedStatsMatches.length === 0) ||
        (activeTab === "user-distribution" && visibleDistributionMatches.length === 0)) ? (
        <section className="rounded-[16px] border border-white/[0.06] bg-white/[0.03] p-4">
          <p className="text-sm text-steel">
            {activeTab === "probabilities"
              ? "No hay odds mundialistas sincronizados para este filtro. Baja odds con `THE_ODDS_API_SPORT=soccer_fifa_world_cup` y luego sincroniza el snapshot contra los partidos del Mundial."
              : activeTab === "value-lab"
                ? "No hay recomendaciones todavia. Actualiza AI Quinielón y odds para generar el Value Lab."
                : activeTab === "advanced-stats"
                  ? "No hay estadisticas avanzadas cargadas para Quiniela +."
                  : "No hay distribucion de usuarios para este filtro. Los datos aparecen cuando haya picks guardados."}
          </p>
        </section>
      ) : null}
    </div>
  );
}
