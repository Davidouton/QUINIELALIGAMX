"use client";

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import type { Matchday, Season } from "@/types/api";

const DASHBOARD_SEASON_PARAM = "season";
const DASHBOARD_COMPETITION_PARAM = "competition";

function asSeasonArray(seasons: Season[] | null | undefined) {
  return Array.isArray(seasons) ? seasons : [];
}

function asMatchdayArray(matchdays: Matchday[] | null | undefined) {
  return Array.isArray(matchdays) ? matchdays : [];
}

export function isSeasonLive(season: Season) {
  return season.visibility_status === "live";
}

export function isSeasonArchived(season: Season) {
  return season.visibility_status === "archived";
}

export function getLiveSeasons(seasons: Season[]) {
  return asSeasonArray(seasons).filter((season) => isSeasonLive(season));
}

export function filterSeasonsByCompetition(seasons: Season[], competitionId: string) {
  return asSeasonArray(seasons).filter((season) => {
    if (isSeasonArchived(season)) {
      return false;
    }
    if (!competitionId) {
      return true;
    }
    return season.competition_id === competitionId;
  });
}

export function resolveSeasonForContext(
  seasons: Season[],
  seasonId: string,
  competitionId: string,
) {
  const safeSeasons = asSeasonArray(seasons);
  const explicitSeason = seasonId ? safeSeasons.find((season) => season.id === seasonId) ?? null : null;
  if (explicitSeason && (!competitionId || explicitSeason.competition_id === competitionId)) {
    return explicitSeason;
  }
  const scopedSeasons = filterSeasonsByCompetition(safeSeasons, competitionId);
  const liveSeasons = scopedSeasons.filter(isSeasonLive);
  const currentSeasons = scopedSeasons.filter((season) => !isSeasonArchived(season));
  return (
    liveSeasons.find((season) => season.is_active) ??
    liveSeasons[0] ??
    currentSeasons.find((season) => season.is_active) ??
    currentSeasons[0] ??
    explicitSeason ??
    safeSeasons[0] ??
    null
  );
}

export function resolveLiveSeason(
  seasons: Season[],
  seasonId: string,
) {
  const safeSeasons = asSeasonArray(seasons);
  const liveSeasons = getLiveSeasons(safeSeasons);
  const explicitLiveSeason = seasonId ? liveSeasons.find((season) => season.id === seasonId) ?? null : null;
  const explicitSeason = seasonId ? safeSeasons.find((season) => season.id === seasonId) ?? null : null;
  const currentSeasons = safeSeasons.filter((season) => !isSeasonArchived(season));

  return (
    explicitLiveSeason ??
    liveSeasons.find((season) => season.is_active) ??
    liveSeasons[0] ??
    explicitSeason ??
    currentSeasons.find((season) => season.is_active) ??
    currentSeasons[0] ??
    safeSeasons[0] ??
    null
  );
}

export function filterMatchdaysBySeason(matchdays: Matchday[], seasonId: string | null | undefined) {
  if (!seasonId) {
    return [];
  }
  return asMatchdayArray(matchdays).filter((matchday) => matchday.season_id === seasonId);
}

export function useDashboardSeasonParam() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const seasonId = searchParams.get(DASHBOARD_SEASON_PARAM) ?? "";
  const competitionId = searchParams.get(DASHBOARD_COMPETITION_PARAM) ?? "";

  const buildHrefWithSeason = useCallback((
    href: string,
    seasonOverride?: string,
    competitionOverride?: string,
  ) => {
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
  }, [competitionId, seasonId]);

  const setSeasonId = useCallback((nextSeasonId: string, nextCompetitionId?: string) => {
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
    const href = query ? `${pathname}?${query}` : pathname;
    const currentHref = searchParams.toString() ? `${pathname}?${searchParams.toString()}` : pathname;
    if (href !== currentHref) {
      router.replace(href, { scroll: false });
    }
  }, [pathname, router, searchParams]);

  const setCompetitionId = useCallback(
    (nextCompetitionId: string) => setSeasonId(seasonId, nextCompetitionId),
    [seasonId, setSeasonId],
  );

  return {
    seasonId,
    competitionId,
    setSeasonId,
    setCompetitionId,
    buildHrefWithSeason,
  };
}
