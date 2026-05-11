"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import type { Matchday, Season } from "@/types/api";

const DASHBOARD_SEASON_PARAM = "season";
const DASHBOARD_COMPETITION_PARAM = "competition";

export function filterSeasonsByCompetition(seasons: Season[], competitionId: string) {
  if (!competitionId) {
    return seasons;
  }
  return seasons.filter((season) => season.competition_id === competitionId);
}

export function resolveSeasonForContext(
  seasons: Season[],
  seasonId: string,
  competitionId: string,
) {
  const visibleSeasons = filterSeasonsByCompetition(seasons, competitionId);
  const explicitSeason = seasons.find((season) => season.id === seasonId) ?? null;

  if (explicitSeason && (!competitionId || explicitSeason.competition_id === competitionId)) {
    return explicitSeason;
  }

  if (competitionId) {
    return (
      visibleSeasons.find((season) => season.is_active) ??
      visibleSeasons[0] ??
      null
    );
  }

  return (
    explicitSeason ??
    seasons.find((season) => season.is_active) ??
    seasons[0] ??
    null
  );
}

export function filterMatchdaysBySeason(matchdays: Matchday[], seasonId: string | null | undefined) {
  if (!seasonId) {
    return [];
  }
  return matchdays.filter((matchday) => matchday.season_id === seasonId);
}

export function useDashboardSeasonParam() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const seasonId = searchParams.get(DASHBOARD_SEASON_PARAM) ?? "";
  const competitionId = searchParams.get(DASHBOARD_COMPETITION_PARAM) ?? "";

  function buildHrefWithSeason(
    href: string,
    seasonOverride?: string,
    competitionOverride?: string,
  ) {
    const params = new URLSearchParams();
    const nextSeasonId = seasonOverride ?? seasonId;
    const nextCompetitionId = competitionOverride ?? competitionId;
    if (nextCompetitionId) {
      params.set(DASHBOARD_COMPETITION_PARAM, nextCompetitionId);
    }
    if (nextSeasonId) {
      params.set(DASHBOARD_SEASON_PARAM, nextSeasonId);
    }
    const query = params.toString();
    return query ? `${href}?${query}` : href;
  }

  function setSeasonId(nextSeasonId: string, nextCompetitionId?: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (typeof nextCompetitionId === "string") {
      if (nextCompetitionId) {
        params.set(DASHBOARD_COMPETITION_PARAM, nextCompetitionId);
      } else {
        params.delete(DASHBOARD_COMPETITION_PARAM);
      }
    }
    if (nextSeasonId) {
      params.set(DASHBOARD_SEASON_PARAM, nextSeasonId);
    } else {
      params.delete(DASHBOARD_SEASON_PARAM);
    }
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  return {
    seasonId,
    competitionId,
    setSeasonId,
    setCompetitionId: (nextCompetitionId: string) => setSeasonId(seasonId, nextCompetitionId),
    buildHrefWithSeason,
  };
}
