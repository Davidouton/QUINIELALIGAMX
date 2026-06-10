"use client";

import { useEffect } from "react";

import { FIFA_WC_COMPETITION_ID, FIFA_WC_DEFAULT_SEASON_ID, useDashboardSeasonParam } from "@/lib/dashboard-season";

const STATIC_COMPETITION_CONTEXTS = [
  {
    id: "5a04efc8-9d75-49e9-b3ab-513e7627e5ad",
    label: "Liga MX",
    defaultSeasonId: "ac81643e-0bd5-4215-8f1c-2624b0b0690b",
    visible: false,
  },
  {
    id: FIFA_WC_COMPETITION_ID,
    label: "FIFA WC",
    defaultSeasonId: FIFA_WC_DEFAULT_SEASON_ID,
    visible: true,
  },
  {
    id: "bc1bb4fd-f098-43ec-982a-840dc104fd19",
    label: "NFL",
    defaultSeasonId: "",
    visible: false,
  },
] as const;

export function DashboardSeasonSwitcher() {
  const { competitionId, seasonId, setSeasonId } = useDashboardSeasonParam();
  const visibleCompetition =
    STATIC_COMPETITION_CONTEXTS.find((competition) => competition.visible) ?? STATIC_COMPETITION_CONTEXTS[1];

  useEffect(() => {
    if (competitionId !== visibleCompetition.id || !seasonId) {
      setSeasonId(seasonId || visibleCompetition.defaultSeasonId, visibleCompetition.id);
    }
  }, [competitionId, seasonId, setSeasonId, visibleCompetition.defaultSeasonId, visibleCompetition.id]);

  return (
    <section className="rounded-[18px] border border-white/[0.05] bg-white/[0.02] px-3 py-3 sm:px-4">
      <div className="relative min-w-0">
        <div className="app-pill-active flex h-9 min-w-[132px] items-center justify-center px-3 text-[11px] uppercase tracking-[0.16em] text-ink">
          {visibleCompetition.label}
        </div>
      </div>
    </section>
  );
}
