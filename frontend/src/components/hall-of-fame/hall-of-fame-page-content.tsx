"use client";

import { useEffect, useMemo, useState } from "react";

import { backendFetch } from "@/lib/api/backend";
import { getBrowserAccessToken } from "@/lib/supabase/session";
import type { HallOfFameEntry, HallOfFameResponse } from "@/types/api";

type HallTab = "tournaments" | "consolidated";
type ConsolidatedTab = "champions" | "points" | "weekly_wins" | "exact_scores";

const TAB_LABELS: Record<HallTab, string> = {
  tournaments: "Torneos",
  consolidated: "Consolidados",
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
    <div className="space-y-6">
      <section>
        <h1 className="text-xl font-semibold text-ink">Salon de la Fama</h1>
      </section>

      <section className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-3">
          {(Object.keys(TAB_LABELS) as HallTab[]).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={
                activeTab === tab
                  ? "app-pill-active h-9 px-3 text-[11px] uppercase tracking-[0.18em]"
                  : "app-pill-ghost h-9 px-3 text-[11px] uppercase tracking-[0.18em]"
              }
            >
              {TAB_LABELS[tab]}
            </button>
          ))}
        </div>
      </section>

      {activeTab === "tournaments" && selectedPodium ? (
        <section className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-steel">
              {selectedPodium.tournament_name}
            </p>
            <select
              value={selectedTournament}
              onChange={(event) => setSelectedTournament(event.target.value)}
              className="field-control min-w-[220px] max-w-[260px]"
            >
              {state.podium_tournaments.map((tournament) => (
                <option key={tournament} value={tournament}>
                  {tournament}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {selectedPodium.entries.map((entry) => (
              <div
                key={`${entry.profile_id}-${entry.place_label}`}
                className="space-y-3 px-1 py-2 text-center md:px-4"
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
                    <div className="flex h-28 w-28 items-center justify-center border border-white/8 text-xs text-steel sm:h-36 sm:w-36">
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
          <section className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap items-center gap-2">
              {(Object.keys(CONSOLIDATED_TAB_LABELS) as ConsolidatedTab[]).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveConsolidatedTab(tab)}
                  className={
                    activeConsolidatedTab === tab
                      ? "app-pill-active h-9 px-3 text-[11px] uppercase tracking-[0.18em]"
                      : "app-pill-ghost h-9 px-3 text-[11px] uppercase tracking-[0.18em]"
                  }
                >
                  {CONSOLIDATED_TAB_LABELS[tab]}
                </button>
              ))}
            </div>
          </section>

          <div className="grid gap-3 md:grid-cols-3">
            <div className="px-3 py-2">
              <p className="text-[10px] uppercase tracking-[0.22em] text-steel">
                {CONSOLIDATED_TAB_LABELS[activeConsolidatedTab]}
              </p>
              <p className="mt-2 text-lg font-semibold text-ink">{leader?.display_name ?? "Sin datos"}</p>
              <p className="mt-1 text-sm text-steel">
                {leader
                  ? `${leader.value} ${VALUE_LABELS[activeConsolidatedTab].toLowerCase()}`
                  : "Aun no hay historico suficiente"}
              </p>
            </div>
            <div className="px-3 py-2">
              <p className="text-[10px] uppercase tracking-[0.22em] text-steel">Registros</p>
              <p className="mt-2 text-lg font-semibold text-ink">{rows.length}</p>
              <p className="mt-1 text-sm text-steel">Participantes con historico</p>
            </div>
            <div className="px-3 py-2">
              <p className="text-[10px] uppercase tracking-[0.22em] text-steel">Categoria</p>
              <p className="mt-2 text-lg font-semibold text-ink">{CONSOLIDATED_TAB_LABELS[activeConsolidatedTab]}</p>
              <p className="mt-1 text-sm text-steel">Vista historica ordenada</p>
            </div>
          </div>

          <section className="space-y-3">
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm font-semibold uppercase tracking-[0.22em] text-steel">
                {CONSOLIDATED_TAB_LABELS[activeConsolidatedTab]}
              </p>
              <p className="text-xs text-steel">{rows.length} registros</p>
            </div>

            {rows.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm text-ink">
                  <thead>
                    <tr className="border-b border-white/8 text-left text-[10px] uppercase tracking-[0.22em] text-steel">
                      <th className="px-3 py-3">Pos</th>
                      <th className="px-3 py-3">Jugador</th>
                      <th className="px-3 py-3 text-center">{VALUE_LABELS[activeConsolidatedTab]}</th>
                      <th className="px-3 py-3">Detalle</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((entry, index) => (
                      <tr key={`${activeConsolidatedTab}-${entry.profile_id}`} className="border-t border-white/8">
                        <td className="px-3 py-3 font-semibold text-coral">#{index + 1}</td>
                        <td className="px-3 py-3 font-medium">{entry.display_name}</td>
                        <td className="px-3 py-3 text-center">{entry.value}</td>
                        <td className="px-3 py-3 text-steel">{entry.detail ?? "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-steel">Todavia no hay datos historicos para esta categoria.</p>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
