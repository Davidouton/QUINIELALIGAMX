"use client";

import { useEffect, useMemo, useState } from "react";

import { DashboardLivePanel } from "@/components/dashboard/dashboard-live-panel";
import { backendFetch, CATALOG_CACHE_TTL_MS } from "@/lib/api/backend";
import { VIP_SUMMARY_PATH } from "@/lib/api/vip";
import { getLiveSeasons, resolveSeasonForContext, useDashboardSeasonParam } from "@/lib/dashboard-season";
import { getBrowserAccessToken } from "@/lib/supabase/session";
import type { Season, VipCompetition } from "@/types/api";

function sortSeasons(seasons: Season[]) {
  return seasons.slice().sort((left, right) => {
    if (left.is_active !== right.is_active) {
      return left.is_active ? -1 : 1;
    }
    return left.name.localeCompare(right.name, "es-MX");
  });
}

export function LivePageContent() {
  const { seasonId: seasonIdParam, competitionId, setSeasonId } = useDashboardSeasonParam();
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [vips, setVips] = useState<VipCompetition[]>([]);
  const [selectedBoardId, setSelectedBoardId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadSeasons() {
      try {
        setLoading(true);
        const accessToken = await getBrowserAccessToken();
        const [rows, vipRows] = await Promise.all([
          backendFetch<Season[]>("/seasons", accessToken, { cacheTtlMs: CATALOG_CACHE_TTL_MS }),
          backendFetch<VipCompetition[]>(VIP_SUMMARY_PATH, accessToken, { cacheTtlMs: CATALOG_CACHE_TTL_MS }),
        ]);
        const nextSeasons = Array.isArray(rows) ? rows : [];
        const nextVips = Array.isArray(vipRows) ? vipRows : [];
        setSeasons(nextSeasons);
        setVips(nextVips);
        setError(null);
      } catch (caughtError) {
        setSeasons([]);
        setVips([]);
        setError(caughtError instanceof Error ? caughtError.message : "No se pudieron cargar las temporadas");
      } finally {
        setLoading(false);
      }
    }

    void loadSeasons();
  }, []);

  const liveEnabledSeasons = useMemo(
    () => sortSeasons(getLiveSeasons(seasons).filter((season) => season.live_dashboard_enabled)),
    [seasons],
  );
  const selectedSeason = useMemo(() => {
    const scoped = resolveSeasonForContext(liveEnabledSeasons, seasonIdParam, competitionId);
    return scoped ?? liveEnabledSeasons[0] ?? null;
  }, [competitionId, liveEnabledSeasons, seasonIdParam]);
  const liveVipOptions = useMemo(
    () =>
      vips
        .filter(
          (vip) =>
            vip.is_active &&
            vip.competition_kind === "matchday" &&
            vip.my_membership?.status === "approved" &&
            liveEnabledSeasons.some((season) => season.id === vip.season_id),
        )
        .sort((left, right) => left.name.localeCompare(right.name, "es-MX")),
    [liveEnabledSeasons, vips],
  );
  const boardOptions = useMemo(
    () => [
      ...liveEnabledSeasons.map((season) => ({
        value: `season:${season.id}`,
        label: `Torneo regular · ${season.name}`,
      })),
      ...liveVipOptions.map((vip) => ({
        value: `vip:${vip.id}`,
        label: `VIP · ${vip.name}`,
      })),
    ],
    [liveEnabledSeasons, liveVipOptions],
  );
  const selectedVip = useMemo(
    () => (selectedBoardId.startsWith("vip:") ? liveVipOptions.find((vip) => vip.id === selectedBoardId.slice(4)) ?? null : null),
    [liveVipOptions, selectedBoardId],
  );

  useEffect(() => {
    if (!selectedSeason) {
      return;
    }
    if (selectedSeason.id !== seasonIdParam || (selectedSeason.competition_id ?? "") !== competitionId) {
      setSeasonId(selectedSeason.id, selectedSeason.competition_id ?? "");
    }
  }, [competitionId, seasonIdParam, selectedSeason, setSeasonId]);
  useEffect(() => {
    if (boardOptions.length === 0) {
      setSelectedBoardId("");
      return;
    }
    const seasonBoardId = selectedSeason ? `season:${selectedSeason.id}` : "";
    setSelectedBoardId((current) => {
      if (current && boardOptions.some((option) => option.value === current)) {
        return current;
      }
      if (seasonBoardId && boardOptions.some((option) => option.value === seasonBoardId)) {
        return seasonBoardId;
      }
      return boardOptions[0]?.value ?? "";
    });
  }, [boardOptions, selectedSeason]);

  if (loading) {
    return <p className="text-sm text-steel">Cargando vista live...</p>;
  }

  if (error && liveEnabledSeasons.length === 0) {
    return <p className="text-sm text-coral">{error}</p>;
  }

  if (liveEnabledSeasons.length === 0) {
    return (
      <section className="py-2">
        <h1 className="text-xl font-semibold text-ink">Live</h1>
        <p className="mt-2 text-sm text-steel">No hay torneos Live disponibles.</p>
      </section>
    );
  }

  return (
    <section className="space-y-5">
      <header className="page-header">
        <h1 className="page-title">Live</h1>
        <label className="page-context-label">
          <span className="text-xs text-steel">Torneo</span>
          <select
            value={selectedBoardId}
            onChange={(event) => {
              const nextValue = event.target.value;
              setSelectedBoardId(nextValue);
              if (nextValue.startsWith("season:")) {
                const nextSeason = liveEnabledSeasons.find((season) => season.id === nextValue.slice(7)) ?? null;
                if (!nextSeason) {
                  return;
                }
                setSeasonId(nextSeason.id, nextSeason.competition_id ?? "");
              } else if (nextValue.startsWith("vip:")) {
                const nextVip = liveVipOptions.find((vip) => vip.id === nextValue.slice(4)) ?? null;
                if (!nextVip) {
                  return;
                }
                setSeasonId(nextVip.season_id, "");
              }
            }}
            className="page-context-select"
          >
            {boardOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </header>

      <DashboardLivePanel season={selectedSeason} vipId={selectedVip?.id ?? null} />
    </section>
  );
}
