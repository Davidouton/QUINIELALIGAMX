"use client";

import { useEffect, useMemo, useState } from "react";
import { backendFetch } from "@/lib/api/backend";
import { getBrowserAccessToken } from "@/lib/supabase/session";
import type { AdminSurvivorPick, AdminUser, Match, Matchday, Season } from "@/types/api";

type ResultOverride = "" | "pending" | "won" | "lost" | "draw";

export function AdminSurvivorPanel() {
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [matchdays, setMatchdays] = useState<Matchday[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [rows, setRows] = useState<AdminSurvivorPick[]>([]);
  const [seasonId, setSeasonId] = useState("");
  const [matchdayId, setMatchdayId] = useState("");
  const [profileId, setProfileId] = useState("");
  const [teamId, setTeamId] = useState("");
  const [resultOverride, setResultOverride] = useState<ResultOverride>("");
  const [lifeOverride, setLifeOverride] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const seasonMatchdays = useMemo(() => matchdays.filter((row) => row.season_id === seasonId)
    .sort((a, b) => a.number - b.number), [matchdays, seasonId]);
  const survivorUsers = useMemo(() => users.filter((user) => user.selected_survivor_membership?.is_active), [users]);
  const teamOptions = useMemo(() => matches.flatMap((match) => [
    match.home_team_id ? { id: match.home_team_id, name: match.home_team_name, opponent: match.away_team_name } : null,
    match.away_team_id ? { id: match.away_team_id, name: match.away_team_name, opponent: match.home_team_name } : null,
  ]).filter((row): row is { id: string; name: string; opponent: string } => Boolean(row)), [matches]);

  async function loadSeason(nextSeasonId: string, token?: string) {
    if (!nextSeasonId) return;
    const accessToken = token ?? await getBrowserAccessToken();
    const [userRows, pickRows] = await Promise.all([
      backendFetch<AdminUser[]>(`/admin/users?season_id=${encodeURIComponent(nextSeasonId)}`, accessToken),
      backendFetch<AdminSurvivorPick[]>(`/admin/survivor/picks?season_id=${encodeURIComponent(nextSeasonId)}`, accessToken),
    ]);
    setUsers(userRows); setRows(pickRows);
  }

  async function loadMatches(nextMatchdayId: string, token?: string) {
    if (!nextMatchdayId) { setMatches([]); return; }
    const accessToken = token ?? await getBrowserAccessToken();
    setMatches(await backendFetch<Match[]>(`/matches?matchday_id=${encodeURIComponent(nextMatchdayId)}`, accessToken));
  }

  useEffect(() => { void (async () => {
    try {
      const token = await getBrowserAccessToken();
      const [seasonRows, matchdayRows] = await Promise.all([
        backendFetch<Season[]>("/seasons", token), backendFetch<Matchday[]>("/matchdays", token),
      ]);
      const preferred = seasonRows.find((row) => row.is_active && (row.tournament_format === "standard" || row.survivor_enabled))
        ?? seasonRows.find((row) => row.tournament_format === "standard" || row.survivor_enabled) ?? null;
      setSeasons(seasonRows); setMatchdays(matchdayRows); setSeasonId(preferred?.id ?? "");
      if (preferred) await loadSeason(preferred.id, token);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "No se pudo cargar Survivor"); }
    finally { setLoading(false); }
  })(); }, []);

  async function changeSeason(next: string) {
    setSeasonId(next); setMatchdayId(""); setMatches([]); setTeamId(""); setProfileId("");
    try { await loadSeason(next); } catch (caught) { setError(caught instanceof Error ? caught.message : "No se pudo cargar la temporada"); }
  }

  async function changeMatchday(next: string) {
    setMatchdayId(next); setTeamId("");
    try { await loadMatches(next); } catch (caught) { setError(caught instanceof Error ? caught.message : "No se pudieron cargar los partidos"); }
  }

  async function saveOverride() {
    if (!profileId || !matchdayId || !teamId || !note.trim()) { setError("Selecciona usuario, jornada, equipo y escribe el motivo."); return; }
    setSaving(true); setError(null); setMessage(null);
    try {
      const token = await getBrowserAccessToken();
      await backendFetch<AdminSurvivorPick>("/admin/survivor/picks/override", token, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        season_id: seasonId, profile_id: profileId, matchday_id: matchdayId, team_id: teamId,
        result_override: resultOverride || null,
        consumes_life_override: lifeOverride === "consume" ? true : lifeOverride === "forgive" ? false : null,
        admin_override_note: note.trim(),
      }) });
      await loadSeason(seasonId, token); setMessage("Override de Survivor guardado."); setNote("");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "No se pudo guardar el override"); }
    finally { setSaving(false); }
  }

  async function clearOverride(pickId: string) {
    setSaving(true); setError(null);
    try { const token = await getBrowserAccessToken(); await backendFetch(`/admin/survivor/picks/${pickId}/override`, token, { method: "DELETE" }); await loadSeason(seasonId, token); setMessage("Cálculo automático restaurado; la auditoría del cambio se conserva."); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "No se pudo restaurar"); }
    finally { setSaving(false); }
  }

  if (loading) return <p className="text-sm text-steel">Cargando Survivor admin...</p>;
  return <section className="space-y-6">
    <div><p className="app-kicker">Control administrativo</p><h1 className="mt-2 text-2xl font-semibold text-ink">Overrides de Survivor</h1><p className="mt-2 text-sm text-steel">Captura o corrige picks cerrados sin modificar el resultado oficial.</p></div>
    {error ? <p className="text-sm text-red-300">{error}</p> : null}{message ? <p className="text-sm text-mint">{message}</p> : null}
    <div className="grid gap-4 border-y border-white/10 py-5 md:grid-cols-3">
      <label className="text-xs text-steel">Temporada<select className="app-input mt-2 w-full" value={seasonId} onChange={(e) => void changeSeason(e.target.value)}>{seasons.filter((s) => s.tournament_format === "standard" || s.survivor_enabled).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <label className="text-xs text-steel">Usuario<select className="app-input mt-2 w-full" value={profileId} onChange={(e) => setProfileId(e.target.value)}><option value="">Selecciona</option>{survivorUsers.map((u) => <option key={u.id} value={u.id}>{u.display_name}</option>)}</select></label>
      <label className="text-xs text-steel">Jornada<select className="app-input mt-2 w-full" value={matchdayId} onChange={(e) => void changeMatchday(e.target.value)}><option value="">Selecciona</option>{seasonMatchdays.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
      <label className="text-xs text-steel">Equipo<select className="app-input mt-2 w-full" value={teamId} onChange={(e) => setTeamId(e.target.value)}><option value="">Selecciona</option>{teamOptions.map((t) => <option key={t.id} value={t.id}>{t.name} vs {t.opponent}</option>)}</select></label>
      <label className="text-xs text-steel">Resultado aplicado<select className="app-input mt-2 w-full" value={resultOverride} onChange={(e) => setResultOverride(e.target.value as ResultOverride)}><option value="">Automático</option><option value="pending">Pendiente</option><option value="won">Ganó</option><option value="lost">Perdió</option><option value="draw">Empate</option></select></label>
      <label className="text-xs text-steel">Consumo de vida<select className="app-input mt-2 w-full" value={lifeOverride} onChange={(e) => setLifeOverride(e.target.value)}><option value="">Automático</option><option value="forgive">No consume</option><option value="consume">Sí consume</option></select></label>
      <label className="text-xs text-steel md:col-span-2">Motivo obligatorio<input className="app-input mt-2 w-full" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej. Pick recibido antes del cierre por soporte" /></label>
      <button className="app-pill app-pill-active self-end" disabled={saving} onClick={() => void saveOverride()}>{saving ? "Guardando..." : "Guardar override"}</button>
    </div>
    <div className="overflow-x-auto"><table className="w-full min-w-[850px] text-left text-sm"><thead className="text-xs uppercase tracking-wider text-steel"><tr><th className="py-3">Usuario</th><th>Jornada</th><th>Pick</th><th>Estado</th><th>Vida</th><th>Auditoría</th><th></th></tr></thead><tbody>{rows.map((row) => <tr key={row.id} className="border-t border-white/10"><td className="py-3 font-medium text-ink">{row.profile_display_name}</td><td>{row.matchday_name}</td><td>{row.team_name} vs {row.opponent_team_name}</td><td>{row.result_status}</td><td>{row.consumed_life ? "Consume" : "No consume"}</td><td className="max-w-[260px] text-xs text-steel">{row.is_admin_override ? `${row.admin_override_note} · ${row.overridden_by_display_name ?? "Admin"}` : "Automático"}</td><td>{row.is_admin_override ? <button className="app-pill-ghost px-3" disabled={saving} onClick={() => void clearOverride(row.id)}>Restaurar</button> : null}</td></tr>)}</tbody></table></div>
  </section>;
}
