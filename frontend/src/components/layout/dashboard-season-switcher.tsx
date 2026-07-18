"use client";

import { useEffect, useMemo, useState } from "react";

import { backendFetch, CATALOG_CACHE_TTL_MS } from "@/lib/api/backend";
import { resolveSeasonForContext, useDashboardSeasonParam } from "@/lib/dashboard-season";
import { getBrowserAccessToken } from "@/lib/supabase/session";
import type { Season } from "@/types/api";

type CompetitionContext = {
  id: string;
  label: string;
  seasons: Season[];
};

const LAST_DASHBOARD_SEASON_STORAGE_KEY = "qm-last-dashboard-season";

function buildContextId(season: Season) {
  return season.tournament_format === "world_cup" ? "world_cup" : "standard";
}

function buildContextLabel(season: Season) {
  if (season.tournament_format === "world_cup") {
    return "WC";
  }
  if (season.competition_name?.trim()) {
    return season.competition_name;
  }
  return "Liga MX";
}

function buildCompetitionContexts(seasons: Season[]) {
  const standardSeasons = seasons.filter((season) => season.tournament_format !== "world_cup");
  const worldCupSeasons = seasons.filter((season) => season.tournament_format === "world_cup");
  const contexts: CompetitionContext[] = [];

  if (standardSeasons.length > 0) {
    contexts.push({
      id: "standard",
      label: buildContextLabel(standardSeasons[0]),
      seasons: standardSeasons,
    });
  }

  if (worldCupSeasons.length > 0) {
    contexts.push({
      id: "world_cup",
      label: buildContextLabel(worldCupSeasons[0]),
      seasons: worldCupSeasons,
    });
  }

  return contexts;
}

function readStoredDashboardSeason() {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const rawValue = window.localStorage.getItem(LAST_DASHBOARD_SEASON_STORAGE_KEY);
    if (!rawValue) {
      return null;
    }
    const parsed = JSON.parse(rawValue) as { seasonId?: string; competitionId?: string };
    return {
      seasonId: parsed.seasonId ?? "",
      competitionId: parsed.competitionId ?? "",
    };
  } catch {
    return null;
  }
}

function writeStoredDashboardSeason(seasonId: string, competitionId: string) {
  if (typeof window === "undefined" || !seasonId) {
    return;
  }
  try {
    window.localStorage.setItem(
      LAST_DASHBOARD_SEASON_STORAGE_KEY,
      JSON.stringify({ seasonId, competitionId }),
    );
  } catch {
    // Ignore browser storage failures.
  }
}

export function DashboardSeasonSwitcher() {
  const { competitionId, seasonId, setSeasonId } = useDashboardSeasonParam();
  const [seasons, setSeasons] = useState<Season[]>([]);

  useEffect(() => {
    async function load() {
      try {
        const accessToken = await getBrowserAccessToken();
        const rows = await backendFetch<Season[]>("/seasons", accessToken, { cacheTtlMs: CATALOG_CACHE_TTL_MS });
        setSeasons(Array.isArray(rows) ? rows : []);
      } catch {
        setSeasons([]);
      }
    }

    void load();
  }, []);

  const contexts = useMemo(() => buildCompetitionContexts(seasons), [seasons]);
  const activeContext =
    contexts.find((context) =>
      context.seasons.some(
        (season) => season.id === seasonId || (competitionId ? season.competition_id === competitionId : false),
      ),
    ) ??
    contexts[0] ??
    null;
  const activeSeason = activeContext
    ? resolveSeasonForContext(activeContext.seasons, seasonId, competitionId)
    : null;

  useEffect(() => {
    if (seasonId || competitionId || seasons.length === 0) {
      return;
    }
    const storedSeason = readStoredDashboardSeason();
    if (!storedSeason?.seasonId) {
      return;
    }
    const matchedSeason = seasons.find((season) => season.id === storedSeason.seasonId);
    if (!matchedSeason) {
      return;
    }
    setSeasonId(matchedSeason.id, matchedSeason.competition_id ?? storedSeason.competitionId ?? "");
  }, [competitionId, seasonId, seasons, setSeasonId]);

  useEffect(() => {
    if (!activeContext || !activeSeason) {
      return;
    }
    if (!seasonId && !competitionId) {
      const storedSeason = readStoredDashboardSeason();
      if (storedSeason?.seasonId && storedSeason.seasonId !== activeSeason.id) {
        return;
      }
    }
    const nextCompetitionId = activeSeason.competition_id ?? "";
    writeStoredDashboardSeason(activeSeason.id, nextCompetitionId);
    if (activeSeason.id !== seasonId || nextCompetitionId !== competitionId) {
      setSeasonId(activeSeason.id, nextCompetitionId);
    }
  }, [activeContext, activeSeason, competitionId, seasonId, setSeasonId]);

  return (
    <section className="rounded-[18px] border border-white/[0.05] bg-white/[0.02] px-3 py-3 sm:px-4">
      <div className="flex flex-wrap gap-2">
        {contexts.map((context) => {
          const isActive = context.id === activeContext?.id;
          return (
            <button
              key={context.id}
              type="button"
              onClick={() => {
                const nextSeason = resolveSeasonForContext(context.seasons, "", "") ?? context.seasons[0];
                if (nextSeason) {
                  setSeasonId(nextSeason.id, nextSeason.competition_id ?? "");
                }
              }}
              className={isActive ? "app-pill-active px-3 text-[11px] uppercase tracking-[0.16em] text-ink" : "app-pill px-3 text-[11px] uppercase tracking-[0.16em]"}
            >
              {context.label}
            </button>
          );
        })}
      </div>
    </section>
  );
}
