"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { backendFetch, CATALOG_CACHE_TTL_MS, MATCHDAY_CACHE_TTL_MS } from "@/lib/api/backend";
import { VIP_SUMMARY_PATH, buildVipDetailPath } from "@/lib/api/vip";
import { filterMatchdaysBySeason, resolveSeasonForContext, useDashboardSeasonParam } from "@/lib/dashboard-season";
import { getBrowserAccessToken } from "@/lib/supabase/session";
import type { AppBootstrap, LeaderboardEntry, Matchday, Me, Season, VipCompetition } from "@/types/api";

type RankingEntry = Pick<
  LeaderboardEntry,
  "profile_id" | "display_name" | "total_points" | "correct_results" | "exact_scores" | "rank_position"
>;

type RankingBoardOption = {
  value: string;
  label: string;
  helper: string;
};

type LeaderboardState = {
  me: Me | null;
  activeMatchday: Matchday | null;
  selectedSeason: Season | null;
  overall: LeaderboardEntry[];
  vipCompetitions: VipCompetition[];
  error: string | null;
};

const initialState: LeaderboardState = {
  me: null,
  activeMatchday: null,
  selectedSeason: null,
  overall: [],
  vipCompetitions: [],
  error: null,
};

const LEADERBOARD_VISIBILITY_REFRESH_STALE_MS = 60_000;

export function LeaderboardPageContent() {
  const [state, setState] = useState<LeaderboardState>(initialState);
  const [selectedBoardId, setSelectedBoardId] = useState("regular");
  const [loading, setLoading] = useState(true);
  const [loadingVipBoardId, setLoadingVipBoardId] = useState("");
  const [loadedVipDetailIds, setLoadedVipDetailIds] = useState<string[]>([]);
  const lastLoadedAtRef = useRef(0);
  const { seasonId: seasonIdParam, competitionId, setSeasonId } = useDashboardSeasonParam();

  const loadLeaderboard = useCallback(async () => {
    setLoading(true);
    try {
      const accessToken = await getBrowserAccessToken();

      const [bootstrap, vipCompetitions] = await Promise.all([
        backendFetch<AppBootstrap>("/bootstrap", accessToken, {
          cacheTtlMs: MATCHDAY_CACHE_TTL_MS,
        }),
        backendFetch<VipCompetition[]>(VIP_SUMMARY_PATH, accessToken, {
          cacheTtlMs: CATALOG_CACHE_TTL_MS,
        }),
      ]);
      const {
        me,
        active_matchdays: activeMatchdays,
        seasons,
      } = bootstrap;
      const selectedSeason = resolveSeasonForContext(seasons, seasonIdParam, competitionId);
      const selectedSeasonMembership =
        selectedSeason
          ? me.season_memberships.find((membership) => membership.season_id === selectedSeason.id) ?? null
          : null;
      const canViewRegularBoard = Boolean(selectedSeasonMembership?.can_participate);
      const overall = selectedSeason && canViewRegularBoard
        ? await backendFetch<LeaderboardEntry[]>(
            `/leaderboard/overall?season_id=${selectedSeason.id}`,
            accessToken,
            { cacheTtlMs: MATCHDAY_CACHE_TTL_MS },
          )
        : [];
      const activeMatchday =
        (selectedSeason
          ? activeMatchdays.find((matchday) => matchday.season_id === selectedSeason.id) ??
            filterMatchdaysBySeason(activeMatchdays, selectedSeason.id)[0] ??
            null
          : null);

      if (selectedSeason && selectedSeason.id !== seasonIdParam) {
        setSeasonId(selectedSeason.id, selectedSeason.competition_id ?? "");
      }

      setState({
        me,
        activeMatchday,
        selectedSeason,
        overall,
        vipCompetitions,
        error: null,
      });
      lastLoadedAtRef.current = Date.now();
    } catch (error) {
      setState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : "No se pudo cargar la tabla general",
      }));
    } finally {
      setLoading(false);
    }
  }, [competitionId, seasonIdParam, setSeasonId]);

  useEffect(() => {
    void loadLeaderboard();
  }, [loadLeaderboard]);

  useEffect(() => {
    if (!selectedBoardId.startsWith("vip:")) {
      return;
    }

    const vipId = selectedBoardId.slice(4);
    if (!vipId || loadedVipDetailIds.includes(vipId)) {
      return;
    }

    let cancelled = false;
    async function loadVipBoard() {
      try {
        setLoadingVipBoardId(vipId);
        const accessToken = await getBrowserAccessToken();
        const rows = await backendFetch<VipCompetition[]>(buildVipDetailPath(vipId), accessToken, {
          cacheTtlMs: MATCHDAY_CACHE_TTL_MS,
        });
        const detail = rows[0];
        if (!detail || cancelled) {
          return;
        }
        setState((current) => ({
          ...current,
          vipCompetitions: current.vipCompetitions.map((vip) => (vip.id === detail.id ? detail : vip)),
        }));
        setLoadedVipDetailIds((current) => (current.includes(vipId) ? current : [...current, vipId]));
      } catch {
        return;
      } finally {
        if (!cancelled) {
          setLoadingVipBoardId((current) => (current === vipId ? "" : current));
        }
      }
    }

    void loadVipBoard();
    return () => {
      cancelled = true;
    };
  }, [loadedVipDetailIds, selectedBoardId]);

  const approvedVipCompetitions = useMemo(
    () => state.vipCompetitions.filter((vip) => vip.my_membership?.status === "approved"),
    [state.vipCompetitions],
  );
  const regularMembership = useMemo(
    () =>
      state.selectedSeason
        ? state.me?.season_memberships.find((membership) => membership.season_id === state.selectedSeason?.id) ?? null
        : null,
    [state.me, state.selectedSeason],
  );
  const canViewRegularBoard = Boolean(state.selectedSeason && regularMembership?.can_participate);
  const boardOptions = useMemo<RankingBoardOption[]>(() => {
    const options: RankingBoardOption[] = [];

    if (canViewRegularBoard && state.selectedSeason) {
      options.push({
        value: "regular",
        label: `Torneo regular · ${state.selectedSeason.name}`,
        helper: "Ranking general de la temporada",
      });
    }

    options.push(
      ...approvedVipCompetitions.map((vip) => ({
        value: `vip:${vip.id}`,
        label: vip.name,
        helper: `VIP · ${vip.season_name}`,
      })),
    );

    return options;
  }, [approvedVipCompetitions, canViewRegularBoard, state.selectedSeason]);
  const selectedVipCompetition = useMemo(
    () =>
      selectedBoardId.startsWith("vip:")
        ? approvedVipCompetitions.find((vip) => vip.id === selectedBoardId.slice(4)) ?? null
        : null,
    [approvedVipCompetitions, selectedBoardId],
  );
  const activeEntries = useMemo<RankingEntry[]>(
    () => (selectedVipCompetition ? selectedVipCompetition.leaderboard : state.overall),
    [selectedVipCompetition, state.overall],
  );
  const activeTitle = selectedVipCompetition ? selectedVipCompetition.name : "Torneo regular";
  const activeSubtitle = selectedVipCompetition
    ? `Ranking VIP de ${selectedVipCompetition.season_name}`
    : state.selectedSeason
      ? `Tabla general de ${state.selectedSeason.name}`
      : "Tabla general del torneo";
  const activeSectionLabel = selectedVipCompetition ? "Tabla VIP" : "Tabla general";
  const activeParticipantsCount = selectedVipCompetition ? selectedVipCompetition.approved_members_count : activeEntries.length;
  const isLoadingActiveVipBoard = Boolean(selectedVipCompetition && loadingVipBoardId === selectedVipCompetition.id);

  useEffect(() => {
    if (boardOptions.length === 0) {
      if (selectedBoardId !== "") {
        setSelectedBoardId("");
      }
      return;
    }

    const currentStillExists = boardOptions.some((option) => option.value === selectedBoardId);
    if (!currentStillExists) {
      setSelectedBoardId(boardOptions[0].value);
    }
  }, [boardOptions, selectedBoardId]);

  useEffect(() => {
    function refreshWhenVisible() {
      if (
        document.visibilityState === "visible" &&
        Date.now() - lastLoadedAtRef.current >= LEADERBOARD_VISIBILITY_REFRESH_STALE_MS
      ) {
        void loadLeaderboard();
      }
    }

    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [loadLeaderboard]);

  if (loading) {
    return <p className="text-sm text-ink/60">Cargando tabla general...</p>;
  }

  if (state.error) {
    return <p className="text-sm text-coral">{state.error}</p>;
  }

  if (boardOptions.length === 0) {
    return (
      <div className="space-y-3">
        <h1 className="text-xl font-semibold text-ink">Ranking</h1>
        <p className="text-sm text-steel">
          Todavia no tienes torneos activos con ranking disponible. Cuando admin te active en una temporada o VIP,
          aparecera aqui.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="space-y-5">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px] xl:items-end">
          <div className="min-w-0 max-w-3xl">
            <h1 className="text-xl font-semibold text-ink">Ranking</h1>
            <p className="mt-1 text-sm text-steel">{activeSubtitle}</p>
          </div>
          <div className="flex w-full flex-col gap-3 xl:justify-self-end">
            <label className="space-y-1">
              <span className="text-[10px] font-semibold uppercase tracking-[0.24em] text-steel">Torneo</span>
              <select
                value={selectedBoardId}
                onChange={(event) => setSelectedBoardId(event.target.value)}
                className="field-control h-10 rounded-[8px] border-white/[0.08] bg-transparent px-3 text-sm"
              >
                {boardOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => void loadLeaderboard()}
              disabled={loading}
              className="app-pill h-10 px-4 text-xs font-semibold disabled:opacity-60 xl:hidden"
            >
              {loading ? "Actualizando..." : "Actualizar tabla"}
            </button>
          </div>
        </div>

        {isLoadingActiveVipBoard ? (
          <p className="text-sm text-steel">Cargando tabla VIP...</p>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-3 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,0.8fr)_minmax(0,0.8fr)]">
          <div className="space-y-1">
            <p className="text-[10px] uppercase tracking-[0.24em] text-steel">Lider</p>
            <p className="mt-2 text-sm font-semibold text-ink">
              {activeEntries[0]?.display_name ?? "Sin clasificacion"}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-[10px] uppercase tracking-[0.24em] text-steel">Puntos</p>
            <p className="mt-2 text-sm font-semibold text-ink">
              {activeEntries[0] ? `${activeEntries[0].total_points} pts` : "Pendiente"}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-[10px] uppercase tracking-[0.24em] text-steel">Jugadores</p>
            <p className="mt-2 text-sm font-semibold text-ink">{activeParticipantsCount}</p>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-steel">{activeSectionLabel}</p>
            <p className="mt-1 text-xs text-steel">
              {boardOptions.find((option) => option.value === selectedBoardId)?.helper ?? activeTitle}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <p className="text-xs text-steel">{activeParticipantsCount} participantes</p>
            <button
              type="button"
              onClick={() => void loadLeaderboard()}
              disabled={loading}
              className="app-pill hidden h-9 px-4 text-xs font-semibold disabled:opacity-60 xl:inline-flex"
            >
              {loading ? "Actualizando..." : "Actualizar tabla"}
            </button>
          </div>
        </div>

        <div className="overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <table className="min-w-[720px] w-full table-fixed text-left text-[11px] text-ink sm:text-sm">
            <colgroup>
              <col className="w-[72px]" />
              <col className="w-[44%]" />
              <col className="w-[128px]" />
              <col className="w-[128px]" />
              <col className="w-[128px]" />
            </colgroup>
            <thead className="app-table-head">
              <tr>
                <th className="px-3 py-3">Pos</th>
                <th className="px-3 py-3">Jugador</th>
                <th className="px-3 py-3 text-center">Puntos</th>
                <th className="px-3 py-3 text-center">Aciertos</th>
                <th className="px-3 py-3 text-center">Exactos</th>
              </tr>
            </thead>
            <tbody>
              {activeEntries.map((entry) => (
                <tr key={entry.profile_id} className="app-table-row border-b last:border-b-0">
                  <td className="px-3 py-3 font-semibold text-ink">{entry.rank_position}</td>
                  <td className="px-3 py-3 font-medium">
                    <span className="block truncate">{entry.display_name}</span>
                  </td>
                  <td className="px-3 py-3 text-center">{entry.total_points}</td>
                  <td className="px-3 py-3 text-center">{entry.correct_results}</td>
                  <td className="px-3 py-3 text-center">{entry.exact_scores}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {activeEntries.length === 0 ? (
            <p className="py-6 text-sm text-steel">Aun no hay posiciones calculadas.</p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
