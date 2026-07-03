"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

import { useDashboardSeasonParam } from "@/lib/dashboard-season";
import { getDashboardScreenName, trackAnalyticsEvent } from "@/lib/analytics/track";

export function DashboardAnalyticsTracker() {
  const pathname = usePathname();
  const { seasonId, competitionId } = useDashboardSeasonParam();

  useEffect(() => {
    if (!pathname?.startsWith("/dashboard")) {
      return;
    }

    void trackAnalyticsEvent({
      category: "screen",
      event_name: "screen_viewed",
      route_path: pathname,
      screen_name: getDashboardScreenName(pathname),
      season_id: seasonId || null,
      competition_id: competitionId || null,
      success: true,
    });
  }, [competitionId, pathname, seasonId]);

  return null;
}
