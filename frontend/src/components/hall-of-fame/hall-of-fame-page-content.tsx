"use client";

import { useEffect, useMemo, useState } from "react";

import { backendFetch } from "@/lib/api/backend";
import { getBrowserAccessToken } from "@/lib/supabase/session";
import type { HallOfFameEntry, HallOfFameResponse } from "@/types/api";

type HallTab = "tournaments" | "consolidated";
type ConsolidatedTab = "champions" | "points" | "weekly_wins" | "exact_scores";

const TAB_LABELS: Record<HallTab, string> = {
  tournaments: "Torneos",
  consolidated: "Récords",
};

const CONSOLIDATED_TAB_LABELS: Record<ConsolidatedTab, string> = {
  champions: "Campeones",
  points: "Puntos",
  weekly_wins: "Jornadas Ganadas",
  exact_scores: "Exactos",
};

const VALUE_LABELS: Record<ConsolidatedTab, string> = {
  champions: "Titulos",
  points: "Puntos",
  weekly_wins: "Jornadas",
  exact_scores: "Exactos",
};

const initialState: HallOfFameResponse = {
  podium_tournament_name: null,
  podium: [],
  podium_tournaments: [],
  podiums_by_tournament: [],
  champions: [],
  points: [],
  weekly_wins: [],
  exact_scores: [],
};

export function HallOfFamePageContent() {
  const [state, setState] = useState<HallOfFameResponse>(initialState);
  const [activeTab, setActiveTab] = useState<HallTab>("tournaments");
  const [activeConsolidatedTab, setActiveConsolidatedTab] = useState<ConsolidatedTab>("champions");
  const [selectedTournament, setSelectedTournament] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const accessToken = await getBrowserAccessToken();
        const response = await backendFetch<HallOfFameResponse>("/leaderboard/hall-of-fame", accessToken);
        setState(response);
        setSelectedTournament(response.podium_tournament_name ?? response.podium_tournaments[0] ?? "");
        setError(null);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "No se pudo cargar el Salon de la Fama");
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, []);

  const rows = useMemo(() => state[activeConsolidatedTab] ?? [], [activeConsolidatedTab, state]);
  const selectedPodium = useMemo(
    () =>
      state.podiums_by_tournament.find((podium) => podium.tournament_name === selectedTournament) ??
      state.podiums_by_tournament[0] ??
      null,
    [selectedTournament, state.podiums_by_tournament],
  );

  if (loading) {
    return <p className="text-sm text-ink/60">Cargando Salon de la Fama...</p>;
  }

  if (error) {
    return <p className="text-sm text-coral">{error}</p>;
  }

  const leader = rows[0] ?? null;

  return (
    <div className="space-y-10">
      <header className="page-header">
        <h1 className="page-title">Salón de la Fama</h1>
      </header>

      <section>
        <div className="tab-list">
          {(Object.keys(TAB_LABELS) as HallTab[]).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={
                activeTab === tab
                  ? "tab-control tab-control-active"
                  : "tab-control"
              }
            >
              {TAB_LABELS[tab]}
            </button>
          ))}
        </div>
      </section>

      {activeTab === "tournaments" && selectedPodium ? (
        <section className="space-y-10">
          <label className="page-context-label max-w-[680px]">
            <span>Torneo</span>
            <select
              value={selectedTournament}
              onChange={(event) => setSelectedTournament(event.target.value)}
              className="page-context-select"
            >
              {state.podium_tournaments.map((tournament) => (
                <option key={tournament} value={tournament}>
                  {tournament}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap justify-center gap-x-16 gap-y-10 border-t border-white/10 pt-8">
            {selectedPodium.entries.map((entry) => (
              <div
                key={`${entry.profile_id}-${entry.place_label}`}
                className="w-full max-w-[240px] space-y-3 text-center"
              >
                <p className="text-[10px] uppercase tracking-[0.24em] text-steel">
                  {entry.place_label === "Campeon" ? "1er Lugar" : entry.place_label}
                </p>
                <div className="flex justify-center">
                  {entry.image_url ? (
                    <div className="flex h-28 w-28 items-center justify-center sm:h-36 sm:w-36">
                      <img
                        src={entry.image_url}
                        alt={entry.display_name}
                        className="h-full w-full object-contain"
                      />
                    </div>
                  ) : (
                    <div className="flex h-28 w-28 items-center justify-center text-xs text-steel sm:h-36 sm:w-36">
                      Sin imagen
                    </div>
                  )}
                </div>
                <p className="text-base font-semibold text-ink">{entry.display_name}</p>
                <p className="text-sm text-steel">{entry.value} pts</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {activeTab === "consolidated" ? (
        <>
          <section>
            <div className="tab-list">
              {(Object.keys(CONSOLIDATED_TAB_LABELS) as ConsolidatedTab[]).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveConsolidatedTab(tab)}
                  className={
                    activeConsolidatedTab === tab
                      ? "tab-control tab-control-active"
                      : "tab-control"
                  }
                >
                  {CONSOLIDATED_TAB_LABELS[tab]}
                </button>
              ))}
            </div>
          </section>

          <div className="grid gap-6 border-y border-white/10 py-5 sm:grid-cols-2">
            <div>
              <p className="text-[10px] uppercase tracking-[0.22em] text-steel">
                {CONSOLIDATED_TAB_LABELS[activeConsolidatedTab]}
              </p>
              <p className="mt-2 text-lg font-semibold text-ink">{leader?.display_name ?? "Sin datos"}</p>
              <p className="mt-1 text-sm text-steel">
                {leader ? `${leader.value} ${VALUE_LABELS[activeConsolidatedTab].toLowerCase()}` : "Sin datos"}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.22em] text-steel">Registros</p>
              <p className="mt-2 text-lg font-semibold text-ink">{rows.length}</p>
            </div>
          </div>

          <section className="space-y-3">
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm font-semibold uppercase tracking-[0.22em] text-steel">
                {CONSOLIDATED_TAB_LABELS[activeConsolidatedTab]}
              </p>
            </div>

            {rows.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="min-w-full border-y border-white/10 text-sm text-ink">
                  <thead>
                    <tr className="border-b border-white/10 text-left text-xs uppercase tracking-[0.18em] text-steel">
                      <th className="py-4">Pos</th>
                      <th className="py-4">Jugador</th>
                      <th className="py-4 text-center">{VALUE_LABELS[activeConsolidatedTab]}</th>
                      <th className="py-4">Detalle</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((entry, index) => (
                      <tr key={`${activeConsolidatedTab}-${entry.profile_id}`} className="border-t border-white/10">
                        <td className="py-4 font-semibold text-[#4f7df3]">#{index + 1}</td>
                        <td className="py-4 font-medium">{entry.display_name}</td>
                        <td className="py-4 text-center">{entry.value}</td>
                        <td className="py-4 text-steel">{entry.detail ?? "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="border-y border-white/10 py-5 text-sm text-steel">No hay datos históricos para esta categoría.</p>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
