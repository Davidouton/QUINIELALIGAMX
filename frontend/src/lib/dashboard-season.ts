"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

const DASHBOARD_SEASON_PARAM = "season";
const DASHBOARD_COMPETITION_PARAM = "competition";

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
