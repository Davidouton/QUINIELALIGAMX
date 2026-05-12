"use client";

import { useEffect, useMemo, useState } from "react";

import { backendFetch } from "@/lib/api/backend";
import { filterSeasonsByCompetition, resolveSeasonForContext, useDashboardSeasonParam } from "@/lib/dashboard-season";
import type { Competition, Season } from "@/types/api";

function readSettledValue<T>(result: PromiseSettledResult<T>, fallback: T) {
  return result.status === "fulfilled" ? result.value : fallback;
}

function getCompetitionBadge(competition: Competition) {
  const normalized = competition.name.trim().toLowerCase();
  if (normalized.includes("liga mx")) {
    return "Liga MX";
  }
  if (normalized.includes("nfl")) {
    return "NFL";
  }
  if (normalized.includes("fifa") || normalized.includes("world cup") || normalized.includes("mund")) {
    return "FIFA WC";
  }
  return competition.name;
}

function buildCompetitionsFromSeasons(seasons: Season[]) {
  const seen = new Set<string>();
  return seasons
    .filter((season) => season.competition_id && season.competition_name)
    .map((season, index) => ({
      id: season.competition_id as string,
      sport_name: season.competition_sport_name ?? "",
      name: season.competition_name as string,
      slug:
        season.competition_name
          ?.trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "") ?? `competition-${index + 1}`,
      provider_league_id: null,
      is_active: true,
      sort_order: (index + 1) * 100,
      created_at: "",
      updated_at: "",
    }))
    .filter((competition) => {
      if (seen.has(competition.id)) {
        return false;
      }
      seen.add(competition.id);
      return true;
    });
}

export function DashboardSeasonSwitcher() {
  const { competitionId, seasonId, setSeasonId } = useDashboardSeasonParam();
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isCompetitionMenuOpen, setIsCompetitionMenuOpen] = useState(false);

  useEffect(() => {
    async function loadSwitcherData() {
      try {
        const [competitionResult, seasonResult] = await Promise.allSettled([
          backendFetch<Competition[]>("/competitions"),
          backendFetch<Season[]>("/seasons"),
        ]);
        const seasonRows = readSettledValue(seasonResult, []);
        const competitionRows = readSettledValue(competitionResult, []);
        const inferredCompetitions = competitionRows.length > 0 ? competitionRows : buildCompetitionsFromSeasons(seasonRows);

        setCompetitions(inferredCompetitions);
        setSeasons(seasonRows);

        if (inferredCompetitions.length > 0 || seasonRows.length > 0) {
          setError(null);
        } else if (competitionResult.status === "rejected") {
          setError(competitionResult.reason instanceof Error ? competitionResult.reason.message : "No se pudieron cargar las quinielas");
        } else if (seasonResult.status === "rejected") {
          setError(seasonResult.reason instanceof Error ? seasonResult.reason.message : "No se pudieron cargar las quinielas");
        } else {
          setError("No se pudieron cargar las quinielas");
        }
      } catch {
        setCompetitions([]);
        setSeasons([]);
        setError("No se pudieron cargar las quinielas");
      } finally {
        setLoading(false);
      }
    }

    void loadSwitcherData();
  }, []);

  const activeCompetition = useMemo(() => {
    if (competitionId) {
      return competitions.find((competition) => competition.id === competitionId) ?? null;
    }
    const competitionFromSeason = seasons.find((season) => season.id === seasonId)?.competition_id ?? null;
    if (competitionFromSeason) {
      return competitions.find((competition) => competition.id === competitionFromSeason) ?? null;
    }
    return competitions[0] ?? null;
  }, [competitionId, competitions, seasonId, seasons]);

  const visibleSeasons = useMemo(() => {
    return filterSeasonsByCompetition(seasons, activeCompetition?.id ?? "");
  }, [activeCompetition?.id, seasons]);

  const selectedSeason = useMemo(() => {
    return resolveSeasonForContext(seasons, seasonId, activeCompetition?.id ?? competitionId);
  }, [activeCompetition?.id, competitionId, seasonId, seasons]);
  useEffect(() => {
    if (selectedSeason) {
      const nextCompetitionId = activeCompetition?.id ?? selectedSeason.competition_id ?? "";
      if (seasonId !== selectedSeason.id || competitionId !== nextCompetitionId) {
        setSeasonId(selectedSeason.id, nextCompetitionId);
      }
      return;
    }

    if (competitionId && seasonId) {
      setSeasonId("", competitionId);
    }
  }, [activeCompetition?.id, competitionId, seasonId, selectedSeason, setSeasonId]);

  if (loading) {
    return (
      <section className="rounded-[18px] border border-white/[0.05] bg-white/[0.02] px-3 py-3 sm:px-4">
        <button
          type="button"
          disabled
          className="app-pill-ghost flex h-9 min-w-[132px] items-center justify-between gap-2 px-3 text-[11px] uppercase tracking-[0.16em] opacity-70"
        >
          <span>Contexto</span>
          <span className="text-steel">▼</span>
        </button>
      </section>
    );
  }

  function handleCompetitionChange(nextCompetitionId: string) {
    const nextCompetition = competitions.find((competition) => competition.id === nextCompetitionId) ?? null;
    const nextSeasons = nextCompetition
      ? seasons.filter((season) => season.competition_id === nextCompetition.id)
      : seasons;
    const nextSeason =
      nextSeasons.find((season) => season.is_active) ??
      nextSeasons[0] ??
      null;
    setSeasonId(nextSeason?.id ?? "", nextCompetitionId);
    setIsCompetitionMenuOpen(false);
  }

  function handleToggleMenu() {
    setIsCompetitionMenuOpen((current) => !current);
  }

  return (
    <section className="rounded-[18px] border border-white/[0.05] bg-white/[0.02] px-3 py-3 sm:px-4">
      <div className="space-y-2">
        <div className="relative min-w-0">
          <button
            type="button"
            onClick={handleToggleMenu}
            className="app-pill-ghost flex h-9 min-w-[132px] items-center justify-between gap-2 px-3 text-[11px] uppercase tracking-[0.16em]"
            aria-haspopup="menu"
            aria-expanded={isCompetitionMenuOpen}
          >
            <span className="truncate">{activeCompetition ? getCompetitionBadge(activeCompetition) : "Contexto"}</span>
            <span className="text-steel">{isCompetitionMenuOpen ? "▲" : "▼"}</span>
          </button>

          {isCompetitionMenuOpen ? (
            <div className="absolute left-0 top-[calc(100%+0.45rem)] z-30 min-w-[180px] rounded-[16px] border border-white/[0.08] bg-night/95 p-2 shadow-2xl backdrop-blur-xl">
              <div className="space-y-1">
                {competitions.map((competition) => {
                  const isActive = competition.id === activeCompetition?.id;
                  return (
                    <button
                      key={competition.id}
                      type="button"
                      onClick={() => handleCompetitionChange(competition.id)}
                      className={
                        isActive
                          ? "app-pill-active flex h-9 w-full items-center justify-between px-3 text-left text-[11px] uppercase tracking-[0.16em] text-ink"
                          : "app-pill-ghost flex h-9 w-full items-center justify-between px-3 text-left text-[11px] uppercase tracking-[0.16em]"
                      }
                    >
                      <span>{getCompetitionBadge(competition)}</span>
                      {isActive ? <span>•</span> : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>

      </div>

      {error ? <p className="mt-2 text-xs text-coral">{error}</p> : null}
    </section>
  );
}
