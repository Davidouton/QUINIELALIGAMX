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

export function isSeasonCurrentForUser(season: Season) {
  return season.visibility_status === "live" || season.visibility_status === "testing";
}

export function isSeasonArchived(season: Season) {
  return season.visibility_status === "archived";
}

export function hasGroupStage(season: Season | null | undefined) {
  return season?.structure_format === "groups_playoff" || season?.tournament_format === "world_cup";
}

export function hasPlayoffStage(season: Season | null | undefined) {
  return Boolean(
    season &&
      (season.tournament_format === "world_cup" ||
        ["league_playoff", "groups_playoff", "conferences_playoff", "knockout"].includes(
          season.structure_format,
        )),
  );
}

export function getLiveSeasons(seasons: Season[]) {
  // Testing seasons have already been authorization-filtered by the backend.
  // Treat the assigned ones as current everywhere except public enrollment.
  return asSeasonArray(seasons).filter((season) => isSeasonCurrentForUser(season));
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
    liveSeasons[0] ??
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
    liveSeasons[0] ??
    explicitSeason ??
    currentSeasons[0] ??
    safeSeasons[0] ??
    null
  );
}

export function isSurvivorAvailableForSeason(season: Season | null | undefined) {
  return season?.tournament_format === "standard" || Boolean(season?.survivor_enabled);
}

export function resolveSurvivorSeason(
  seasons: Season[],
  seasonId: string,
  competitionId: string,
) {
  const safeSeasons = asSeasonArray(seasons);
  const explicitSeason = seasonId ? safeSeasons.find((season) => season.id === seasonId) ?? null : null;
  if (explicitSeason && isSurvivorAvailableForSeason(explicitSeason) && (!competitionId || explicitSeason.competition_id === competitionId)) {
    return explicitSeason;
  }

  const pickPreferredSeason = (rows: Season[]) => {
    const liveRows = rows.filter(isSeasonLive);
    const currentRows = rows.filter((season) => !isSeasonArchived(season));
    return (
      liveRows[0] ??
      currentRows[0] ??
      rows[0] ??
      null
    );
  };

  const scopedSurvivorSeasons = filterSeasonsByCompetition(safeSeasons, competitionId).filter((season) =>
    isSurvivorAvailableForSeason(season),
  );
  const globalSurvivorSeasons = safeSeasons.filter((season) =>
    !isSeasonArchived(season) && isSurvivorAvailableForSeason(season),
  );

  return pickPreferredSeason(scopedSurvivorSeasons) ?? pickPreferredSeason(globalSurvivorSeasons) ?? explicitSeason ?? null;
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
