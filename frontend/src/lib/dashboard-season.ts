"use client";

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import type { Matchday, Season } from "@/types/api";

const DASHBOARD_SEASON_PARAM = "season";
const DASHBOARD_COMPETITION_PARAM = "competition";
export const FIFA_WC_COMPETITION_ID = "b37f2ce6-e27f-4310-a1c9-979f977863ae";
export const FIFA_WC_DEFAULT_SEASON_ID = "ed43cce6-962c-4dd3-95d0-c4f9785cf8fb";

const FALLBACK_SEASONS: Season[] = [
  {
    id: FIFA_WC_DEFAULT_SEASON_ID,
    name: "Copa del Mundo de la fifa Mock 01",
    slug: "fwcmk",
    competition_id: FIFA_WC_COMPETITION_ID,
    competition_name: "FIFAWC2026",
    competition_sport_name: "FIFA",
    tournament_format: "world_cup",
    is_active: true,
    start_matchday_id: null,
    end_matchday_id: null,
    participants_lock_at: null,
    created_at: "",
    updated_at: "",
  },
];

export function filterSeasonsByCompetition(seasons: Season[], competitionId: string) {
  const effectiveCompetitionId =
    competitionId === FIFA_WC_COMPETITION_ID ? competitionId : FIFA_WC_COMPETITION_ID;
  return seasons.filter((season) => season.competition_id === effectiveCompetitionId);
}

export function resolveSeasonForContext(
  seasons: Season[],
  seasonId: string,
  competitionId: string,
) {
  const effectiveCompetitionId =
    competitionId === FIFA_WC_COMPETITION_ID ? competitionId : FIFA_WC_COMPETITION_ID;
  const visibleSeasons = filterSeasonsByCompetition(seasons, effectiveCompetitionId);
  const explicitSeason = seasons.find((season) => season.id === seasonId) ?? null;
  const explicitFallbackSeason = FALLBACK_SEASONS.find((season) => season.id === seasonId) ?? null;
  const fallbackSeasonForCompetition =
    FALLBACK_SEASONS.find((season) => season.competition_id === effectiveCompetitionId) ?? null;

  if (explicitSeason && explicitSeason.competition_id === effectiveCompetitionId) {
    return explicitSeason;
  }

  if (explicitFallbackSeason && explicitFallbackSeason.competition_id === effectiveCompetitionId) {
    return explicitFallbackSeason;
  }

  return (
    visibleSeasons.find((season) => season.is_active) ??
    visibleSeasons[0] ??
    fallbackSeasonForCompetition ??
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
  const rawSeasonId = searchParams.get(DASHBOARD_SEASON_PARAM);
  const rawCompetitionId = searchParams.get(DASHBOARD_COMPETITION_PARAM);
  const competitionId = FIFA_WC_COMPETITION_ID;
  const seasonId =
    rawCompetitionId === FIFA_WC_COMPETITION_ID && rawSeasonId
      ? rawSeasonId
      : FIFA_WC_DEFAULT_SEASON_ID;

  const buildHrefWithSeason = useCallback((
    href: string,
    seasonOverride?: string,
    competitionOverride?: string,
  ) => {
    const params = new URLSearchParams();
    const nextSeasonId = seasonOverride ?? seasonId ?? FIFA_WC_DEFAULT_SEASON_ID;
    const nextCompetitionId = competitionOverride ?? competitionId ?? FIFA_WC_COMPETITION_ID;
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
