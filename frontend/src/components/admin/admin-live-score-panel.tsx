"use client";

import { useEffect, useMemo, useState } from "react";

import { backendFetch } from "@/lib/api/backend";
import { formatMexicoCityDateTime } from "@/lib/datetime/mexico-city";
import { getBrowserAccessToken } from "@/lib/supabase/session";
import type { AdminLiveScoreRow, Matchday, Season } from "@/types/api";

type ScoreDraft = { home: string; away: string };

export function AdminLiveScorePanel() {
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [matchdays, setMatchdays] = useState<Matchday[]>([]);
  const [seasonId, setSeasonId] = useState("");
  const [matchdayId, setMatchdayId] = useState("");
  const [rows, setRows] = useState<AdminLiveScoreRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, ScoreDraft>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const seasonMatchdays = useMemo(
    () => matchdays.filter((row) => row.season_id === seasonId),
    [matchdays, seasonId],
  );

  async function loadScores(nextMatchdayId: string, token?: string) {
    if (!nextMatchdayId) {
      setRows([]);
      setDrafts({});
      return;
    }
    const accessToken = token ?? await getBrowserAccessToken();
    const nextRows = await backendFetch<AdminLiveScoreRow[]>(
      `/admin/live-scores?matchday_id=${encodeURIComponent(nextMatchdayId)}`,
      accessToken,
    );
    setRows(nextRows);
    setDrafts(Object.fromEntries(nextRows.map((row) => [row.match_id, {
      home: row.live_home_score === null ? "" : String(row.live_home_score),
      away: row.live_away_score === null ? "" : String(row.live_away_score),
    }])));
  }

  useEffect(() => {
    async function load() {
      try {
        const accessToken = await getBrowserAccessToken();
        const [seasonRows, matchdayRows] = await Promise.all([
          backendFetch<Season[]>("/seasons", accessToken),
          backendFetch<Matchday[]>("/matchdays", accessToken),
        ]);
        const initialSeasonId = seasonRows.find((row) => row.is_active)?.id ?? seasonRows[0]?.id ?? "";
        const initialMatchdayId =
          matchdayRows.find((row) => row.season_id === initialSeasonId && row.status === "active")?.id ??
          matchdayRows.find((row) => row.season_id === initialSeasonId)?.id ?? "";
        setSeasons(seasonRows);
        setMatchdays(matchdayRows);
        setSeasonId(initialSeasonId);
        setMatchdayId(initialMatchdayId);
        await loadScores(initialMatchdayId, accessToken);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "No se pudo cargar Live Score");
      }
    }
    void load();
  }, []);

  async function save(row: AdminLiveScoreRow) {
    const draft = drafts[row.match_id];
    if (!draft || draft.home === "" || draft.away === "") return;
    setSaving(row.match_id);
    setError(null);
    try {
      const accessToken = await getBrowserAccessToken();
      await backendFetch(`/admin/live-scores/${row.match_id}`, accessToken, {
        method: "PUT",
        body: JSON.stringify({ home_score: Number(draft.home), away_score: Number(draft.away) }),
      });
      await loadScores(matchdayId, accessToken);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo guardar el marcador Live");
    } finally {
      setSaving(null);
    }
  }

  async function clear(row: AdminLiveScoreRow) {
    setSaving(row.match_id);
    setError(null);
    try {
      const accessToken = await getBrowserAccessToken();
      await backendFetch(`/admin/live-scores/${row.match_id}`, accessToken, { method: "DELETE" });
      await loadScores(matchdayId, accessToken);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo borrar el marcador Live");
    } finally {
      setSaving(null);
    }
  }

  return (
    <section className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-ink">Live Score</h1>
        <p className="mt-1 text-sm text-steel">Marcadores provisionales para calcular el tablero Live sin modificar resultados oficiales.</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <select value={seasonId} onChange={(event) => {
          const nextSeasonId = event.target.value;
          const nextMatchdayId = matchdays.find((row) => row.season_id === nextSeasonId && row.status === "active")?.id ?? matchdays.find((row) => row.season_id === nextSeasonId)?.id ?? "";
          setSeasonId(nextSeasonId); setMatchdayId(nextMatchdayId); void loadScores(nextMatchdayId);
        }} className="field-control">
          {seasons.map((season) => <option key={season.id} value={season.id}>{season.name}</option>)}
        </select>
        <select value={matchdayId} onChange={(event) => { setMatchdayId(event.target.value); void loadScores(event.target.value); }} className="field-control">
          {seasonMatchdays.map((matchday) => <option key={matchday.id} value={matchday.id}>{matchday.name}</option>)}
        </select>
      </div>
      {error ? <p className="text-sm text-coral">{error}</p> : null}
      <div className="divide-y divide-white/10 border-y border-white/10">
        {rows.map((row) => {
          const draft = drafts[row.match_id] ?? { home: "", away: "" };
          return (
            <div key={row.match_id} className="grid gap-3 py-4 md:grid-cols-[1fr_110px_110px_auto] md:items-center">
              <div>
                <p className="font-semibold text-ink">{row.home_team_name} vs {row.away_team_name}</p>
                <p className="text-xs text-steel">{formatMexicoCityDateTime(row.kickoff_at)} · Oficial: {row.official_home_score ?? "-"}-{row.official_away_score ?? "-"}</p>
              </div>
              <input type="number" min={0} value={draft.home} onChange={(event) => setDrafts((current) => ({ ...current, [row.match_id]: { ...draft, home: event.target.value } }))} className="field-control text-center" placeholder="Local" />
              <input type="number" min={0} value={draft.away} onChange={(event) => setDrafts((current) => ({ ...current, [row.match_id]: { ...draft, away: event.target.value } }))} className="field-control text-center" placeholder="Visita" />
              <div className="flex gap-2">
                <button type="button" onClick={() => void save(row)} disabled={saving === row.match_id || draft.home === "" || draft.away === ""} className="secondary-button disabled:opacity-50">Guardar</button>
                {row.live_home_score !== null ? <button type="button" onClick={() => void clear(row)} disabled={saving === row.match_id} className="app-pill text-coral">Borrar</button> : null}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
