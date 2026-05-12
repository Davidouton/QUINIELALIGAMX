"use client";

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import type { Matchday, Season } from "@/types/api";

const DASHBOARD_SEASON_PARAM = "season";
const DASHBOARD_COMPETITION_PARAM = "competition";

const FALLBACK_SEASONS: Season[] = [
  {
    id: "ac81643e-0bd5-4215-8f1c-2624b0b0690b",
    name: "Liguilla Clausura 2026",
    slug: "lcl26",
    competition_id: "5a04efc8-9d75-49e9-b3ab-513e7627e5ad",
    competition_name: "Liga MX",
    competition_sport_name: "Futbol",
    tournament_format: "standard",
    is_active: true,
    start_matchday_id: null,
    end_matchday_id: null,
    participants_lock_at: null,
    created_at: "",
    updated_at: "",
  },
  {
    id: "ed43cce6-962c-4dd3-95d0-c4f9785cf8fb",
    name: "Copa del Mundo de la fifa Mock 01",
    slug: "fwcmk",
    competition_id: "b37f2ce6-e27f-4310-a1c9-979f977863ae",
    competition_name: "FIFAWC2026",
    competition_sport_name: "FIFA",
    tournament_format: "world_cup",
    is_active: false,
    start_matchday_id: null,
    end_matchday_id: null,
    participants_lock_at: null,
    created_at: "",
    updated_at: "",
  },
];

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
  const explicitFallbackSeason = FALLBACK_SEASONS.find((season) => season.id === seasonId) ?? null;
  const fallbackSeasonForCompetition = competitionId
    ? FALLBACK_SEASONS.find((season) => season.competition_id === competitionId) ?? null
    : null;

  if (explicitSeason && (!competitionId || explicitSeason.competition_id === competitionId)) {
    return explicitSeason;
  }

  if (explicitFallbackSeason && (!competitionId || explicitFallbackSeason.competition_id === competitionId)) {
    return explicitFallbackSeason;
  }

  if (competitionId) {
    return (
      visibleSeasons.find((season) => season.is_active) ??
      visibleSeasons[0] ??
      fallbackSeasonForCompetition ??
      null
    );
  }

  return (
    explicitSeason ??
    explicitFallbackSeason ??
    seasons.find((season) => season.is_active) ??
    FALLBACK_SEASONS.find((season) => season.is_active) ??
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
