"use client";

import { useEffect, useState } from "react";

import { backendFetch } from "@/lib/api/backend";
import { formatMexicoCityDateTime } from "@/lib/datetime/mexico-city";
import { getBrowserAccessToken } from "@/lib/supabase/session";
import type { AdminNflSpreadRow, Matchday, Season } from "@/types/api";

export function AdminNflSpreadsPanel() {
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [matchdays, setMatchdays] = useState<Matchday[]>([]);
  const [seasonId, setSeasonId] = useState("");
  const [matchdayId, setMatchdayId] = useState("");
  const [rows, setRows] = useState<AdminNflSpreadRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function loadRows(selectedSeasonId: string, selectedMatchdayId?: string) {
    const token = await getBrowserAccessToken();
    const query = new URLSearchParams({ season_id: selectedSeasonId });
    if (selectedMatchdayId) query.set("matchday_id", selectedMatchdayId);
    const nextRows = await backendFetch<AdminNflSpreadRow[]>(`/admin/nfl-spreads?${query}`, token);
    setRows(nextRows);
    setDrafts(Object.fromEntries(nextRows.map((row) => [row.match_id, row.spread_home_line ?? ""])));
  }

  useEffect(() => {
    async function loadCatalog() {
      try {
        const token = await getBrowserAccessToken();
        const [seasonRows, matchdayRows] = await Promise.all([
          backendFetch<Season[]>("/seasons", token),
          backendFetch<Matchday[]>("/matchdays", token),
        ]);
        const nflSeasons = seasonRows.filter((season) => {
          const label = `${season.competition_sport_name ?? ""} ${season.competition_name ?? ""}`.toLowerCase();
          return label.includes("nfl") || label.includes("football");
        });
        setSeasons(nflSeasons);
        setMatchdays(matchdayRows);
        setSeasonId(nflSeasons[0]?.id ?? "");
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "No se pudo cargar NFL");
      } finally {
        setLoading(false);
      }
    }
    void loadCatalog();
  }, []);

  useEffect(() => {
    if (!seasonId) {
      setRows([]);
      return;
    }
    setLoading(true);
    loadRows(seasonId, matchdayId || undefined)
      .catch((caught) => setError(caught instanceof Error ? caught.message : "No se cargaron los partidos NFL"))
      .finally(() => setLoading(false));
  }, [seasonId, matchdayId]);

  function awayLine(homeLine: string) {
    const normalized = homeLine.trim().toUpperCase();
    if (!normalized) return "Sin publicar";
    if (normalized === "PK") return "0";
    const value = Number(normalized);
    if (!Number.isFinite(value)) return "—";
    return -value > 0 ? `+${-value}` : String(-value);
  }

  async function save(row: AdminNflSpreadRow) {
    const force = row.is_frozen;
    if (force && !window.confirm(`Ya existen ${row.pick_count} picks. La correccion actualizara la linea guardada en ellos. Continuar?`)) return;
    setSavingId(row.match_id);
    setError(null);
    setMessage(null);
    try {
      const token = await getBrowserAccessToken();
      await backendFetch(`/admin/nfl-spreads/${row.match_id}`, token, {
        method: "PUT",
        body: JSON.stringify({ home_line: drafts[row.match_id]?.trim() || null, force }),
      });
      await loadRows(seasonId, matchdayId || undefined);
      setMessage(force ? "Spread corregido y picks recalculados." : "Spread publicado.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo guardar el spread");
    } finally {
      setSavingId("");
    }
  }

  const seasonMatchdays = matchdays.filter((row) => row.season_id === seasonId).sort((a, b) => a.number - b.number);

  return (
    <section className="space-y-5 border-t border-white/[0.08] pt-7">
      <div>
        <h3 className="text-lg font-semibold text-ink">Definición NFL · Spreads</h3>
        <p className="mt-1 text-sm text-steel">Define la línea del partido junto con sus horarios y equipos.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <select value={seasonId} onChange={(event) => { setSeasonId(event.target.value); setMatchdayId(""); }} className="field-control">
          <option value="">Temporada NFL</option>
          {seasons.map((season) => <option key={season.id} value={season.id}>{season.name}</option>)}
        </select>
        <select value={matchdayId} onChange={(event) => setMatchdayId(event.target.value)} className="field-control" disabled={!seasonId}>
          <option value="">Todas las semanas</option>
          {seasonMatchdays.map((row) => <option key={row.id} value={row.id}>Semana {row.number} · {row.name}</option>)}
        </select>
      </div>
      {message ? <p className="text-sm text-moss">{message}</p> : null}
      {error ? <p className="text-sm text-coral">{error}</p> : null}
      {!loading && seasons.length === 0 ? <p className="text-sm text-steel">No existe todavía una competencia NFL.</p> : null}
      {loading ? <p className="text-sm text-steel">Cargando...</p> : rows.length ? (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="app-table-head"><tr><th className="px-3 py-3">Semana</th><th className="px-3 py-3">Partido</th><th className="px-3 py-3">Inicio</th><th className="px-3 py-3">Local</th><th className="px-3 py-3">Visitante</th><th className="px-3 py-3">Estado</th><th /></tr></thead>
            <tbody>{rows.map((row) => (
              <tr key={row.match_id} className="app-table-row border-b last:border-b-0">
                <td className="px-3 py-3 text-steel">{row.matchday_number}</td>
                <td className="px-3 py-3 font-semibold text-ink">{row.home_team_name} vs {row.away_team_name}</td>
                <td className="px-3 py-3 text-steel">{formatMexicoCityDateTime(row.kickoff_at)}</td>
                <td className="px-3 py-3"><input value={drafts[row.match_id] ?? ""} onChange={(event) => setDrafts((current) => ({ ...current, [row.match_id]: event.target.value }))} placeholder="-3.5 / PK" className="field-control min-w-28" /></td>
                <td className="px-3 py-3 font-semibold text-ink">{awayLine(drafts[row.match_id] ?? "")}</td>
                <td className="px-3 py-3 text-steel">{row.is_frozen ? `Congelado · ${row.pick_count} picks` : row.spread_home_line ? "Publicado" : "Sin publicar"}</td>
                <td className="px-3 py-3"><button type="button" onClick={() => void save(row)} disabled={savingId === row.match_id} className="app-pill px-2 disabled:opacity-50">{savingId === row.match_id ? "Guardando" : row.is_frozen ? "Corregir" : "Publicar"}</button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : seasonId ? <p className="text-sm text-steel">No hay partidos en esta selección.</p> : null}
    </section>
  );
}
