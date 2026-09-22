"use client";

import { useEffect, useState } from "react";
import { backendFetch } from "@/lib/api/backend";
import { getBrowserAccessToken } from "@/lib/supabase/session";
import type { LeaderboardEntry, Matchday } from "@/types/api";

export function MatchdayRanking({ seasonId, isNfl }: { seasonId: string; isNfl: boolean }) {
  const [matchdays, setMatchdays] = useState<Matchday[]>([]);
  const [matchdayId, setMatchdayId] = useState("");
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const token = await getBrowserAccessToken();
        const rows = await backendFetch<Matchday[]>("/matchdays", token);
        if (cancelled) return;
        const scoped = rows.filter((row) => row.season_id === seasonId).sort((a, b) => a.number - b.number);
        setMatchdays(scoped);
        setMatchdayId((scoped.find((row) => row.status === "active") ?? scoped[scoped.length - 1])?.id ?? "");
        if (!scoped.length) setLoading(false);
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "No se pudieron cargar las jornadas.");
          setLoading(false);
        }
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [seasonId]);

  useEffect(() => {
    if (!matchdayId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setEntries([]);
    async function load() {
      try {
        const token = await getBrowserAccessToken();
        const rows = await backendFetch<LeaderboardEntry[]>(`/leaderboard/matchday/${matchdayId}`, token);
        if (!cancelled) setEntries(rows);
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "No se pudo cargar la clasificación.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [matchdayId]);

  const closed = matchdays.find((row) => row.id === matchdayId)?.status === "closed";
  const leaders = entries.filter((entry) => entry.rank_position === 1);
  return <div className="space-y-4">
    <label className="block space-y-2 text-sm">
      <span>{isNfl ? "Semana" : "Jornada"}</span>
      <select className="field-control" value={matchdayId} onChange={(event) => setMatchdayId(event.target.value)}>
        {matchdays.map((row) => <option key={row.id} value={row.id}>{row.number} · {row.name}</option>)}
      </select>
    </label>
    <p className="text-xs text-steel">{closed ? "Clasificación de la jornada cerrada." : "Clasificación provisional con los resultados oficiales registrados. Puede cambiar hasta cerrar la jornada."} {isNfl ? "Cada acierto ATS vale uno; el Tie Break solo desempata." : ""}</p>
    {error ? <p role="alert" className="text-sm text-coral">{error}</p> : loading ? <p className="text-sm text-steel">Cargando clasificación...</p> : entries.length ? <>
      <p className="text-sm font-semibold text-ink">{closed ? "Ganadores" : "Primer lugar provisional"}: {leaders.map((entry) => entry.display_name).join(", ")}</p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="app-table-head"><tr><th className="px-3 py-3">Pos</th><th className="px-3 py-3">Jugador</th><th className="px-3 py-3">{isNfl ? "Aciertos ATS" : "Puntos"}</th>{!isNfl ? <th className="px-3 py-3">Exactos</th> : null}</tr></thead>
          <tbody>{entries.map((entry) => <tr key={entry.profile_id} className="app-table-row border-b"><td className="px-3 py-3">{entry.rank_position}</td><td className="px-3 py-3">{entry.display_name}</td><td className="px-3 py-3">{entry.total_points}</td>{!isNfl ? <td className="px-3 py-3">{entry.exact_scores}</td> : null}</tr>)}</tbody>
        </table>
      </div>
    </> : <p className="text-sm text-steel">Todavía no hay una clasificación calculada para esta jornada.</p>}
  </div>;
}
