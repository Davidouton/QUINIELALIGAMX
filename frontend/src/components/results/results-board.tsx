"use client";

import { useEffect, useState } from "react";

import { Card } from "@/components/ui/card";
import { backendFetch } from "@/lib/api/backend";
import { filterMatchdaysBySeason, resolveSeasonForContext, useDashboardSeasonParam } from "@/lib/dashboard-season";
import { formatMexicoCityDateTime } from "@/lib/datetime/mexico-city";
import { getBrowserAccessToken } from "@/lib/supabase/session";
import type { Matchday, PublishedResult, Result, Season } from "@/types/api";

type ResultsBoardState = {
  selectedSeason: Season | null;
  selectedMatchday: Matchday | null;
  results: Result[];
  publishedResults: PublishedResult[];
  error: string | null;
};

const initialState: ResultsBoardState = {
  selectedSeason: null,
  selectedMatchday: null,
  results: [],
  publishedResults: [],
  error: null,
};

export function ResultsBoard() {
  const [state, setState] = useState<ResultsBoardState>(initialState);
  const [loading, setLoading] = useState(true);
  const { seasonId: seasonIdParam, competitionId } = useDashboardSeasonParam();

  useEffect(() => {
    async function loadResultsBoard() {
      try {
        const accessToken = await getBrowserAccessToken();
        const [activeMatchdays, seasons, matchdays] = await Promise.all([
          backendFetch<Matchday[]>("/matchdays?status=active", accessToken),
          backendFetch<Season[]>("/seasons", accessToken),
          backendFetch<Matchday[]>("/matchdays", accessToken),
        ]);
        const selectedSeason = resolveSeasonForContext(seasons, seasonIdParam, competitionId);
        const seasonMatchdays = selectedSeason ? filterMatchdaysBySeason(matchdays, selectedSeason.id) : [];
        const selectedMatchday =
          (selectedSeason
            ? activeMatchdays.find((matchday) => matchday.season_id === selectedSeason.id) ?? null
            : null) ??
          seasonMatchdays
            .slice()
            .sort((left, right) => right.number - left.number)[0] ??
          null;

        const suffix = selectedMatchday ? `?matchday_id=${selectedMatchday.id}` : "";
        const [results, publishedResults] = await Promise.all([
          backendFetch<Result[]>(`/results${suffix}`, accessToken),
          backendFetch<PublishedResult[]>(`/published-results${suffix}`, accessToken),
        ]);

        setState({
          selectedSeason,
          selectedMatchday,
          results,
          publishedResults,
          error: null,
        });
      } catch (error) {
        setState((current) => ({
          ...current,
          error: error instanceof Error ? error.message : "No se pudieron cargar los resultados",
        }));
      } finally {
        setLoading(false);
      }
    }

    void loadResultsBoard();
  }, [competitionId, seasonIdParam]);

  if (loading) {
    return <p className="text-sm text-steel">Cargando resultados...</p>;
  }

  if (state.error) {
    return <p className="text-sm text-coral">{state.error}</p>;
  }

  const pendingPublication = state.results.filter(
    (result) => !state.publishedResults.some((published) => published.match_id === result.match_id),
  );

  return (
    <div className="space-y-8">
      <section className="surface-card-strong px-7 py-7">
        <p className="eyebrow">Results Desk</p>
        <h1 className="mt-3 text-4xl font-semibold text-ink">Resultados</h1>
        <p className="mt-3 max-w-2xl text-sm text-steel">
          {state.selectedMatchday
            ? `Seguimiento de ${state.selectedMatchday.name}${state.selectedSeason ? ` · ${state.selectedSeason.name}` : ""}.`
            : "Consulta marcadores recientes y lo que ya se publicó oficialmente."}
        </p>
      </section>

      <Card>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-steel">Publicados</p>
            <h2 className="mt-2 text-2xl font-semibold text-ink">Marcadores oficiales</h2>
          </div>
          <p className="text-sm text-steel">{state.publishedResults.length} partidos</p>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {state.publishedResults.map((result) => (
            <div key={result.match_id} className="rounded-2xl border border-white/10 bg-night/35 px-4 py-4">
              <p className="text-sm uppercase tracking-[0.2em] text-steel">Oficial</p>
              <p className="mt-3 text-lg font-semibold text-ink">
                {result.home_team_name} {result.home_score} - {result.away_score}{" "}
                {result.away_team_name}
              </p>
              <p className="mt-2 text-sm text-steel">
                Publicado: {formatMexicoCityDateTime(result.published_at)}
              </p>
            </div>
          ))}
        </div>

        {state.publishedResults.length === 0 ? (
          <p className="mt-6 text-sm text-steel">Todavia no hay resultados oficiales publicados.</p>
        ) : null}
      </Card>

      <Card>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-steel">Pendientes</p>
            <h2 className="mt-2 text-2xl font-semibold text-ink">Resultados aun sin publicar</h2>
          </div>
          <p className="text-sm text-steel">{pendingPublication.length} partidos</p>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {pendingPublication.map((result) => (
            <div key={result.match_id} className="rounded-2xl border border-white/10 bg-night/25 px-4 py-4">
              <p className="text-sm uppercase tracking-[0.2em] text-steel">En revision</p>
              <p className="mt-3 text-lg font-semibold text-ink">
                {result.home_team_name} {result.home_score} - {result.away_score}{" "}
                {result.away_team_name}
              </p>
            </div>
          ))}
        </div>

        {pendingPublication.length === 0 ? (
          <p className="mt-6 text-sm text-steel">No hay resultados pendientes de publicar.</p>
        ) : null}
      </Card>
    </div>
  );
}
