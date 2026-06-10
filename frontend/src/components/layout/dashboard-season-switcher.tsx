"use client";

import { useEffect } from "react";

import { FIFA_WC_COMPETITION_ID, FIFA_WC_DEFAULT_SEASON_ID, useDashboardSeasonParam } from "@/lib/dashboard-season";

export function DashboardSeasonSwitcher() {
  const { competitionId, seasonId, setSeasonId } = useDashboardSeasonParam();

  useEffect(() => {
    if (competitionId !== FIFA_WC_COMPETITION_ID || seasonId !== FIFA_WC_DEFAULT_SEASON_ID) {
      setSeasonId(FIFA_WC_DEFAULT_SEASON_ID, FIFA_WC_COMPETITION_ID);
    }
  }, [competitionId, seasonId, setSeasonId]);

  return (
    <section className="rounded-[18px] border border-white/[0.05] bg-white/[0.02] px-3 py-3 sm:px-4">
      <div className="relative min-w-0">
        <div className="app-pill-active flex h-9 min-w-[132px] items-center justify-center px-3 text-[11px] uppercase tracking-[0.16em] text-ink">
          FIFA WC
        </div>
      </div>
    </section>
  );
}
