"use client";

import { useMemo, useState } from "react";

import { useDashboardSeasonParam } from "@/lib/dashboard-season";

type StaticCompetitionContext = {
  id: string;
  label: string;
};

const STATIC_COMPETITION_CONTEXTS: StaticCompetitionContext[] = [
  {
    id: "5a04efc8-9d75-49e9-b3ab-513e7627e5ad",
    label: "Liga MX",
  },
  {
    id: "b37f2ce6-e27f-4310-a1c9-979f977863ae",
    label: "FIFA WC",
  },
  {
    id: "bc1bb4fd-f098-43ec-982a-840dc104fd19",
    label: "NFL",
  },
];

export function DashboardSeasonSwitcher() {
  const { competitionId, setSeasonId } = useDashboardSeasonParam();
  const [isCompetitionMenuOpen, setIsCompetitionMenuOpen] = useState(false);

  const activeCompetition = useMemo(() => {
    return (
      STATIC_COMPETITION_CONTEXTS.find((competition) => competition.id === competitionId) ??
      STATIC_COMPETITION_CONTEXTS[0]
    );
  }, [competitionId]);

  function handleCompetitionChange(nextCompetitionId: string) {
    setSeasonId("", nextCompetitionId);
    setIsCompetitionMenuOpen(false);
  }

  function handleToggleMenu() {
    setIsCompetitionMenuOpen((current) => !current);
  }

  return (
    <section className="rounded-[18px] border border-white/[0.05] bg-white/[0.02] px-3 py-3 sm:px-4">
      <div className="relative min-w-0">
        <button
          type="button"
          onClick={handleToggleMenu}
          className="app-pill-ghost flex h-9 min-w-[132px] items-center justify-between gap-2 px-3 text-[11px] uppercase tracking-[0.16em]"
          aria-haspopup="menu"
          aria-expanded={isCompetitionMenuOpen}
        >
          <span className="truncate">{activeCompetition.label}</span>
          <span className="text-steel">{isCompetitionMenuOpen ? "▲" : "▼"}</span>
        </button>

        {isCompetitionMenuOpen ? (
          <div className="absolute left-0 top-[calc(100%+0.45rem)] z-30 min-w-[180px] rounded-[16px] border border-white/[0.08] bg-night/95 p-2 shadow-2xl backdrop-blur-xl">
            <div className="space-y-1">
              {STATIC_COMPETITION_CONTEXTS.map((competition) => {
                const isActive = competition.id === activeCompetition.id;
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
                    <span>{competition.label}</span>
                    {isActive ? <span>•</span> : null}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
