"use client";

import { useEffect, useState } from "react";

import { PickResultsTable } from "@/components/dashboard/pick-results-table";
import { Card } from "@/components/ui/card";
import { backendFetch } from "@/lib/api/backend";
import { filterMatchdaysBySeason, resolveSeasonForContext, useDashboardSeasonParam } from "@/lib/dashboard-season";
import { getBrowserAccessToken } from "@/lib/supabase/session";
import type { Match, Matchday, PickResultRow, Season } from "@/types/api";

type MatchdayCenterState = {
  seasons: Season[];
  matchdays: Matchday[];
  selectedMatchday: Matchday | null;
  selectedSeason: Season | null;
  matches: Match[];
  pickResults: PickResultRow[];
  error: string | null;
};

const initialState: MatchdayCenterState = {
  seasons: [],
  matchdays: [],
  selectedMatchday: null,
  selectedSeason: null,
  matches: [],
  pickResults: [],
  error: null,
};

function getSeasonTag(season: Season | null) {
  if (!season) {
    return "SIN TORNEO";
  }
  return season.slug?.toUpperCase() || season.name.toUpperCase();
}

export function MatchdayCenter() {
  const [state, setState] = useState<MatchdayCenterState>(initialState);
  const [loading, setLoading] = useState(true);
  const { seasonId: seasonIdParam, competitionId, setSeasonId } = useDashboardSeasonParam();

  useEffect(() => {
    async function loadMatchdayCenter() {
      try {
        const accessToken = await getBrowserAccessToken();
        const [activeMatchdays, seasons, matchdays] = await Promise.all([
          backendFetch<Matchday[]>("/matchdays?status=active", accessToken),
          backendFetch<Season[]>("/seasons", accessToken),
          backendFetch<Matchday[]>("/matchdays", accessToken),
        ]);
        const preferredSeason = resolveSeasonForContext(seasons, seasonIdParam, competitionId);
        const activeMatchday = preferredSeason
          ? activeMatchdays.find((matchday) => matchday.season_id === preferredSeason.id) ?? null
          : null;
        const selectedMatchday =
          activeMatchday ??
          filterMatchdaysBySeason(matchdays, preferredSeason?.id)
            .slice()
            .sort((left, right) => right.number - left.number)[0] ??
          null;
        const selectedSeason =
          preferredSeason ??
          seasons.find((season) => season.id === selectedMatchday?.season_id) ??
          null;

        if (selectedSeason) {
          const nextCompetitionId = selectedSeason.competition_id ?? "";
          if (selectedSeason.id !== seasonIdParam || competitionId !== nextCompetitionId) {
            setSeasonId(selectedSeason.id, nextCompetitionId);
          }
        }

        if (!selectedMatchday) {
          setState((current) => ({
            ...current,
            seasons,
            matchdays,
            selectedMatchday: null,
            selectedSeason,
            error: null,
          }));
          return;
        }

        const [matches, pickResults] = await Promise.all([
          backendFetch<Match[]>(`/matches?matchday_id=${selectedMatchday.id}`, accessToken),
          backendFetch<PickResultRow[]>(`/my-pick-results?matchday_id=${selectedMatchday.id}`, accessToken),
        ]);

        setState({
          seasons,
          matchdays,
          selectedMatchday,
          selectedSeason,
          matches,
          pickResults,
          error: null,
        });
      } catch (error) {
        setState((current) => ({
          ...current,
          error: error instanceof Error ? error.message : "No se pudo cargar la jornada",
        }));
      } finally {
        setLoading(false);
      }
    }

    void loadMatchdayCenter();
  }, [competitionId, seasonIdParam, setSeasonId]);

  async function handleSeasonChange(seasonId: string) {
    const selectedSeason = state.seasons.find((season) => season.id === seasonId) ?? null;
    setSeasonId(seasonId, selectedSeason?.competition_id ?? competitionId);

    const seasonMatchdays = filterMatchdaysBySeason(state.matchdays, seasonId)
      .sort((left, right) => left.number - right.number);
    const nextMatchday = seasonMatchdays[0] ?? null;

    if (!nextMatchday) {
      setState((current) => ({
        ...current,
        selectedSeason,
        selectedMatchday: null,
        matches: [],
        pickResults: [],
        error: null,
      }));
      return;
    }

    await loadSelectedMatchday(nextMatchday.id);
  }

  async function loadSelectedMatchday(matchdayId: string) {
    try {
      setLoading(true);
      const accessToken = await getBrowserAccessToken();
      const selectedMatchday = state.matchdays.find((matchday) => matchday.id === matchdayId) ?? null;

      if (!selectedMatchday) {
        setState((current) => ({
          ...current,
          selectedMatchday: null,
          selectedSeason: current.selectedSeason,
          matches: [],
          pickResults: [],
          error: null,
        }));
        return;
      }

      const seasons = await backendFetch<Season[]>("/seasons", accessToken);
      const selectedSeason =
        seasons.find((season) => season.id === selectedMatchday.season_id) ??
        resolveSeasonForContext(seasons, seasonIdParam, competitionId);

      const [matches, pickResults] = await Promise.all([
        backendFetch<Match[]>(`/matches?matchday_id=${selectedMatchday.id}`, accessToken),
        backendFetch<PickResultRow[]>(`/my-pick-results?matchday_id=${selectedMatchday.id}`, accessToken),
      ]);

      setState((current) => ({
        ...current,
        seasons,
        selectedMatchday,
        selectedSeason,
        matches,
        pickResults,
        error: null,
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : "No se pudo cargar la jornada seleccionada",
      }));
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-steel">Cargando jornada...</p>;
  }

  if (state.error) {
    return <p className="text-sm text-coral">{state.error}</p>;
  }

  const seasonTag = getSeasonTag(state.selectedSeason);
  const matchdayHeader = state.selectedMatchday
    ? `Jornada ${state.selectedMatchday.number} - ${seasonTag}`
    : "Sin jornada seleccionada";
  const seasonMatchdays = state.selectedSeason
    ? state.matchdays
        .filter((matchday) => matchday.season_id === state.selectedSeason?.id)
        .sort((left, right) => left.number - right.number)
    : state.matchdays.slice().sort((left, right) => left.number - right.number);
  const selectedIndex = seasonMatchdays.findIndex((matchday) => matchday.id === state.selectedMatchday?.id);
  const previousMatchday = selectedIndex > 0 ? seasonMatchdays[selectedIndex - 1] : null;
  const nextMatchday =
    selectedIndex >= 0 && selectedIndex < seasonMatchdays.length - 1 ? seasonMatchdays[selectedIndex + 1] : null;

  return (
    <div className="space-y-8">
      <section className="surface-card-strong px-7 py-7">
        <p className="eyebrow">Matchday Center</p>
        <h1 className="mt-3 text-4xl font-semibold text-ink">{matchdayHeader}</h1>
        {state.selectedSeason ? (
          <p className="mt-2 text-sm text-steel">Torneo activo: {state.selectedSeason.name}</p>
        ) : null}
        <p className="mt-3 max-w-2xl text-sm text-steel">
          Revisa horarios, cierres, tus picks cargados y si ya se publicó marcador oficial.
        </p>
        <div className="mt-6 grid gap-3 lg:grid-cols-[minmax(0,280px)_minmax(0,1fr)_auto] lg:items-end">
          <label className="space-y-2 text-sm">
            <span className="text-steel">Temporada</span>
            <select
              value={state.selectedSeason?.id ?? ""}
              onChange={(event) => void handleSeasonChange(event.target.value)}
              className="field-control"
            >
              <option value="">Selecciona temporada</option>
              {state.seasons.map((season) => (
                <option key={season.id} value={season.id}>
                  {season.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-2 text-sm">
            <span className="text-steel">Navegar jornada</span>
            <select
              value={state.selectedMatchday?.id ?? ""}
              onChange={(event) => void loadSelectedMatchday(event.target.value)}
              className="field-control"
            >
              <option value="">Selecciona jornada</option>
              {seasonMatchdays.map((matchday) => (
                <option key={matchday.id} value={matchday.id}>
                  Jornada {matchday.number} · {state.selectedSeason?.slug?.toUpperCase() ?? state.selectedSeason?.name ?? "Torneo"}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => previousMatchday && void loadSelectedMatchday(previousMatchday.id)}
              disabled={!previousMatchday}
              className="secondary-button disabled:cursor-not-allowed disabled:opacity-50"
            >
              Jornada anterior
            </button>
            <button
              type="button"
              onClick={() => nextMatchday && void loadSelectedMatchday(nextMatchday.id)}
              disabled={!nextMatchday}
              className="secondary-button disabled:cursor-not-allowed disabled:opacity-50"
            >
              Jornada siguiente
            </button>
          </div>
        </div>
      </section>

      {state.matches.length === 0 ? (
        <Card>
          <p className="text-sm text-steel">No hay partidos programados para la jornada seleccionada.</p>
        </Card>
      ) : null}

      <PickResultsTable
        rows={state.pickResults}
        title={state.selectedMatchday ? `${state.selectedMatchday.name} · Tabla de resultados` : "Tabla de resultados"}
        subtitle="Consulta por juego tu pick, el marcador real y el puntaje que te dio esa seleccion."
        emptyMessage="No hay partidos programados para la jornada seleccionada."
        useWorldCupBubbles={state.selectedSeason?.tournament_format === "world_cup"}
      />
    </div>
  );
}
