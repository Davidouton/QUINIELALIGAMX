"use client";

import { useEffect, useRef, useState } from "react";

import { VipWeeklyRanking } from "@/components/vip/vip-weekly-ranking";
import { backendFetch } from "@/lib/api/backend";
import { formatMexicoCityDateTime, fromMexicoCityInputValue, toMexicoCityInputValue } from "@/lib/datetime/mexico-city";
import { getBrowserAccessToken } from "@/lib/supabase/session";
import { WEEKLY_MATCH_COUNT, weeklyGoalValue } from "@/lib/vip-weekly";
import type { AdminVipCompetition, VipWeeklyMatch } from "@/types/api";

type MatchDraft = { id?: string; home: string; away: string; kickoff: string; isTiebreaker: boolean };
type ResultDraft = { home: string; away: string };

function matchDrafts(matches: VipWeeklyMatch[]): MatchDraft[] {
  return Array.from({ length: WEEKLY_MATCH_COUNT }, (_, index) => {
    const match = matches[index];
    return {
      id: match?.id,
      home: match?.home_team ?? "",
      away: match?.away_team ?? "",
      kickoff: match ? toMexicoCityInputValue(match.kickoff_at) : "",
      isTiebreaker: match?.is_tiebreaker ?? (matches.length === 0 && index === 0),
    };
  });
}

const fieldClass = "field-control min-w-0 rounded-[6px] px-3 text-sm";
const labelClass = "text-[10px] font-semibold uppercase tracking-[0.15em] text-steel";

export function AdminVipWeeklyPanel({ vip, onRefresh }: { vip: AdminVipCompetition; onRefresh: () => Promise<unknown> }) {
  const matches = vip.weekly_matches ?? [];
  const matchSignature = JSON.stringify(matches.map(({ id, home_team, away_team, kickoff_at, is_tiebreaker }) => (
    { id, home_team, away_team, kickoff_at, is_tiebreaker }
  )));
  const [drafts, setDrafts] = useState(() => matchDrafts(matches));
  const [configDirty, setConfigDirty] = useState(false);
  const [resultDrafts, setResultDrafts] = useState<Record<string, ResultDraft>>({});
  const [saving, setSaving] = useState<"matches" | "results" | null>(null);
  const savingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const active = vip.lifecycle_status === "active";
  const editable = active && !saving;
  const tieIndex = drafts.findIndex((match) => match.isTiebreaker);

  useEffect(() => {
    if (!configDirty) setDrafts(matchDrafts(vip.weekly_matches ?? []));
  }, [matchSignature, configDirty]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  function updateMatch(index: number, key: "home" | "away" | "kickoff", value: string) {
    setConfigDirty(true);
    setDrafts((current) => current.map((match, row) => row === index ? { ...match, [key]: value } : match));
    setMessage(null);
  }

  function resultValue(match: VipWeeklyMatch): ResultDraft {
    return resultDrafts[match.id] ?? {
      home: match.home_score === null ? "" : String(match.home_score),
      away: match.away_score === null ? "" : String(match.away_score),
    };
  }

  function updateResult(match: VipWeeklyMatch, side: keyof ResultDraft, value: string) {
    setResultDrafts((current) => ({
      ...current,
      [match.id]: { ...resultValue(match), [side]: value },
    }));
    setMessage(null);
  }

  async function refreshAfterSave(success: string) {
    setMessage(success);
    try {
      await onRefresh();
      return true;
    } catch {
      setMessage(`${success} No se pudo actualizar la vista; recarga para consultar lo guardado.`);
      return false;
    }
  }

  async function saveMatches() {
    if (savingRef.current || !active) return;
    setError(null);
    setMessage(null);
    const payload = drafts.map((draft) => ({
      ...(draft.id ? { id: draft.id } : {}),
      home_team: draft.home.trim(),
      away_team: draft.away.trim(),
      kickoff_at: fromMexicoCityInputValue(draft.kickoff),
      is_tiebreaker: draft.isTiebreaker,
    }));
    const invalid = payload.findIndex((row) => !row.home_team || !row.away_team || !row.kickoff_at || row.home_team.toLocaleLowerCase() === row.away_team.toLocaleLowerCase());
    if (invalid >= 0) {
      setError(`Completa local, visitante y fecha válida del juego ${invalid + 1}. Los equipos deben ser distintos.`);
      return;
    }
    if (payload.filter((row) => row.is_tiebreaker).length !== 1) {
      setError("Selecciona un partido de desempate.");
      return;
    }
    savingRef.current = true;
    setSaving("matches");
    try {
      const token = await getBrowserAccessToken();
      await backendFetch(`/admin/vip/${vip.id}/weekly/matches`, token, {
        method: "PUT",
        body: JSON.stringify({ matches: payload }),
      });
      if (await refreshAfterSave("Los 10 juegos y el partido de desempate quedaron guardados.")) setConfigDirty(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudieron guardar los juegos.");
    } finally {
      savingRef.current = false;
      setSaving(null);
    }
  }

  async function saveResults() {
    if (savingRef.current || !active) return;
    setError(null);
    setMessage(null);
    const results: { match_id: string; home_score: number; away_score: number }[] = [];
    for (const match of matches) {
      const draft = resultDrafts[match.id];
      if (!draft) continue;
      if (draft.home === String(match.home_score ?? "") && draft.away === String(match.away_score ?? "")) continue;
      const home = weeklyGoalValue(draft.home);
      const away = weeklyGoalValue(draft.away);
      if (home === null || away === null) {
        setError(`Completa ambos marcadores de ${match.home_team} vs ${match.away_team}, entre 0 y 99.`);
        return;
      }
      if (Date.now() < Date.parse(match.kickoff_at)) {
        setError(`El juego ${match.home_team} vs ${match.away_team} todavía no comienza.`);
        return;
      }
      results.push({ match_id: match.id, home_score: home, away_score: away });
    }
    if (results.length === 0) {
      setMessage("No hay resultados nuevos por guardar.");
      return;
    }
    savingRef.current = true;
    setSaving("results");
    try {
      const token = await getBrowserAccessToken();
      await backendFetch(`/admin/vip/${vip.id}/weekly/results`, token, { method: "PUT", body: JSON.stringify({ results }) });
      if (await refreshAfterSave("Resultados guardados. El ranking se actualiza automáticamente.")) {
        setResultDrafts((current) => Object.fromEntries(Object.entries(current).filter(([id]) => !results.some((row) => row.match_id === id))));
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudieron guardar los resultados.");
    } finally {
      savingRef.current = false;
      setSaving(null);
    }
  }

  return (
    <section className="space-y-6 border-t border-white/[0.08] pt-5">
      <div>
        <h3 className="text-lg font-semibold text-ink">Quinielón Semanal</h3>
        <p className="mt-1 text-sm text-steel">10 juegos, un punto por acierto y un partido de desempate por total de goles.</p>
        <p className="mt-2 text-xs text-steel">Horarios de Ciudad de México. Cada pronóstico cierra 10 minutos antes de su partido.</p>
      </div>
      {error ? <p role="alert" className="text-sm text-coral">{error}</p> : null}
      {message ? <p role="status" className="text-sm text-mint">{message}</p> : null}
      {!vip.weekly_ready ? <p className="rounded-[8px] border border-gold/25 bg-gold/5 px-4 py-3 text-sm text-gold">Configuración pendiente. El registro se habilita al guardar los 10 juegos.</p> : null}
      <fieldset disabled={!editable} className="space-y-3 disabled:opacity-70">
        <legend className="mb-3 text-sm font-semibold text-ink">Partidos</legend>
        {drafts.map((draft, index) => (
          <div key={draft.id ?? index} className="grid gap-3 rounded-[8px] border border-white/[0.08] p-3 sm:grid-cols-[24px_1fr_1fr] xl:grid-cols-[24px_1fr_1fr_190px]">
            <span className="self-center text-xs font-semibold text-steel">{index + 1}</span>
            <label className="grid min-w-0 gap-1"><span className={labelClass}>Local</span><input aria-label={`Juego ${index + 1}: local`} className={fieldClass} value={draft.home} maxLength={120} onChange={(event) => updateMatch(index, "home", event.target.value)} /></label>
            <label className="grid min-w-0 gap-1"><span className={labelClass}>Visitante</span><input aria-label={`Juego ${index + 1}: visitante`} className={fieldClass} value={draft.away} maxLength={120} onChange={(event) => updateMatch(index, "away", event.target.value)} /></label>
            <label className="grid min-w-0 gap-1 sm:col-start-2 sm:col-span-2 xl:col-auto"><span className={labelClass}>Día y hora · CDMX</span><input aria-label={`Juego ${index + 1}: día y hora de Ciudad de México`} type="datetime-local" className={fieldClass} value={draft.kickoff} onChange={(event) => updateMatch(index, "kickoff", event.target.value)} /></label>
          </div>
        ))}
        <label className="grid gap-1">
          <span className={labelClass}>Partido de desempate</span>
          <select className={fieldClass} value={tieIndex < 0 ? "" : tieIndex} onChange={(event) => {
            const index = Number(event.target.value);
            setConfigDirty(true);
            setDrafts((current) => current.map((draft, row) => ({ ...draft, isTiebreaker: row === index })));
          }}>
            <option value="" disabled>Selecciona un partido</option>
            {drafts.map((draft, index) => <option key={index} value={index}>{index + 1}. {draft.home || "Local"} vs {draft.away || "Visitante"}</option>)}
          </select>
        </label>
        <p className="text-xs text-steel">Todos estiman el total de goles de ese partido. La configuración deja de poder cambiar cuando haya pronósticos registrados.</p>
        <button type="button" onClick={() => void saveMatches()} className="app-pill px-4 disabled:opacity-50" disabled={!editable || (!configDirty && Boolean(vip.weekly_ready))}>{saving === "matches" ? "Guardando…" : "Guardar 10 juegos"}</button>
      </fieldset>

      {matches.length > 0 ? (
        <fieldset disabled={!editable} className="space-y-3 border-t border-white/[0.08] pt-5">
          <legend className="pt-3 text-sm font-semibold text-ink">Resultados finales</legend>
          <p className="text-xs text-steel">Carga el marcador al terminar cada juego. Puedes guardar uno o varios resultados.</p>
          {matches.map((match, index) => {
            const result = resultValue(match);
            const started = now >= Date.parse(match.kickoff_at);
            return (
              <div key={match.id} className="flex flex-col justify-between gap-3 border-b border-white/[0.06] py-3 sm:flex-row sm:items-center">
                <div>
                  <p className="text-sm font-medium text-ink">{index + 1}. {match.home_team} vs {match.away_team}{match.is_tiebreaker ? <span className="ml-2 text-xs text-gold">Desempate</span> : null}</p>
                  <p className="mt-1 text-xs text-steel">{formatMexicoCityDateTime(match.kickoff_at)}{!started ? " · Aún no comienza" : ""}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <input type="number" min={0} max={99} step={1} inputMode="numeric" aria-label={`Goles de ${match.home_team}, juego ${index + 1}`} className={`${fieldClass} w-[72px] text-center`} value={result.home} disabled={!started || !editable} placeholder="—" onChange={(event) => updateResult(match, "home", event.target.value)} />
                  <span className="text-steel">–</span>
                  <input type="number" min={0} max={99} step={1} inputMode="numeric" aria-label={`Goles de ${match.away_team}, juego ${index + 1}`} className={`${fieldClass} w-[72px] text-center`} value={result.away} disabled={!started || !editable} placeholder="—" onChange={(event) => updateResult(match, "away", event.target.value)} />
                </div>
              </div>
            );
          })}
          <button type="button" className="app-pill px-4 disabled:opacity-50" disabled={!editable || Object.keys(resultDrafts).length === 0} onClick={() => void saveResults()}>{saving === "results" ? "Guardando…" : "Guardar resultados"}</button>
        </fieldset>
      ) : null}
      <VipWeeklyRanking entries={vip.leaderboard} />
    </section>
  );
}
