"use client";

import { useEffect, useRef, useState } from "react";

import { VipWeeklyRanking } from "@/components/vip/vip-weekly-ranking";
import { backendFetch } from "@/lib/api/backend";
import { formatMexicoCityDateTime } from "@/lib/datetime/mexico-city";
import { getBrowserAccessToken } from "@/lib/supabase/session";
import { WEEKLY_SELECTIONS, weeklyGoalValue, weeklyMatchIsLocked, weeklyMatchResult } from "@/lib/vip-weekly";
import type { VipCompetition, VipWeeklyMatch, VipWeeklySelection } from "@/types/api";

type PickDraft = { selection: VipWeeklySelection | null; goals: string };

export function VipWeeklyBoard({ vip, onRefresh }: { vip: VipCompetition; onRefresh: () => Promise<unknown> }) {
  const matches = vip.weekly_matches ?? [];
  const [drafts, setDrafts] = useState<Record<string, PickDraft>>({});
  const [savedLocally, setSavedLocally] = useState<Record<string, PickDraft>>({});
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const serverSignature = JSON.stringify(matches.map((match) => [match.id, match.my_selection, match.my_total_goals]));
  const canParticipate = vip.my_membership?.status === "approved" && vip.lifecycle_status === "active" && vip.season_visibility_status !== "archived" && Boolean(vip.weekly_ready);

  useEffect(() => {
    const refreshTime = () => setNow(Date.now());
    const timer = window.setInterval(refreshTime, 1000);
    window.addEventListener("focus", refreshTime);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshTime);
    };
  }, []);

  useEffect(() => {
    setSavedLocally({});
  }, [serverSignature]);

  function savedValue(match: VipWeeklyMatch): PickDraft {
    return savedLocally[match.id] ?? {
      selection: match.my_selection,
      goals: match.my_total_goals === null ? "" : String(match.my_total_goals),
    };
  }

  function hasChanges(match: VipWeeklyMatch) {
    const draft = drafts[match.id];
    if (!draft) return false;
    const saved = savedValue(match);
    return draft.selection !== saved.selection || (match.is_tiebreaker && draft.goals !== saved.goals);
  }

  function updateDraft(match: VipWeeklyMatch, change: Partial<PickDraft>) {
    if (!canParticipate || savingRef.current || weeklyMatchIsLocked(match)) return;
    setDrafts((current) => ({ ...current, [match.id]: { ...(current[match.id] ?? savedValue(match)), ...change } }));
    setMessage(null);
    setError(null);
  }

  const editableChanges = matches.filter((match) => hasChanges(match) && !weeklyMatchIsLocked(match, now));
  const expiredChanges = matches.filter((match) => hasChanges(match) && weeklyMatchIsLocked(match, now));
  const savedCount = matches.filter((match) => Boolean(savedValue(match).selection)).length;

  async function savePicks() {
    if (savingRef.current || !canParticipate) return;
    setError(null);
    setMessage(null);
    const openChanges = matches.filter((match) => hasChanges(match) && !weeklyMatchIsLocked(match));
    if (openChanges.length === 0) {
      setError("No hay cambios abiertos por guardar. Los juegos cerrados conservan el último pronóstico guardado.");
      return;
    }
    const picks: { match_id: string; selection: VipWeeklySelection; total_goals?: number }[] = [];
    const confirmed: Record<string, PickDraft> = {};
    for (const match of openChanges) {
      const draft = drafts[match.id];
      if (!draft?.selection) {
        setError(`Elige local, empate o visitante en ${match.home_team} vs ${match.away_team}.`);
        return;
      }
      const goals = match.is_tiebreaker ? weeklyGoalValue(draft.goals) : null;
      if (match.is_tiebreaker && goals === null) {
        setError("Completa el total de goles del partido de desempate con un número entero de 0 a 99.");
        return;
      }
      picks.push({ match_id: match.id, selection: draft.selection, ...(goals !== null ? { total_goals: goals } : {}) });
      confirmed[match.id] = { selection: draft.selection, goals: goals === null ? "" : String(goals) };
    }
    savingRef.current = true;
    setSaving(true);
    try {
      const token = await getBrowserAccessToken();
      await backendFetch(`/vip/${vip.id}/weekly/picks`, token, { method: "PUT", body: JSON.stringify({ picks }) });
      setSavedLocally((current) => ({ ...current, ...confirmed }));
      setDrafts((current) => Object.fromEntries(Object.entries(current).filter(([id]) => !confirmed[id])));
      setMessage(picks.length === 1 ? "Pronóstico guardado." : `${picks.length} pronósticos guardados.`);
      try {
        await onRefresh();
      } catch {
        setMessage("Pronósticos guardados. No se pudo actualizar el ranking; recarga para consultarlo.");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudieron guardar los pronósticos.");
      // Refresh authoritative deadlines and membership after a rejected write; keep the drafts.
      await onRefresh().catch(() => undefined);
    } finally {
      setNow(Date.now());
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <section className="space-y-5 border-y border-white/[0.08] py-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-ink">Quinielón Semanal</h3>
          <p className="mt-1 text-sm text-steel">Local, empate o visitante. Cada juego cierra 10 minutos antes de comenzar.</p>
          <p className="mt-1 text-xs text-steel">Horarios de Ciudad de México · Un punto por acierto</p>
        </div>
        {vip.my_membership?.status === "approved" ? <p className="text-sm font-semibold text-ink">{savedCount}/{matches.length || 10} guardados</p> : null}
      </div>
      {!vip.weekly_ready ? <p className="rounded-[8px] border border-white/[0.08] px-4 py-3 text-sm text-steel">El administrador está preparando los 10 juegos. El registro aún no está abierto.</p> : null}
      {vip.weekly_ready && vip.my_membership?.status !== "approved" ? <p className="text-sm text-steel">Necesitas acceso aprobado a esta VIP para guardar tus pronósticos.</p> : null}
      {error ? <p role="alert" className="text-sm text-coral">{error}</p> : null}
      {message ? <p role="status" className="text-sm text-mint">{message}</p> : null}
      {expiredChanges.length > 0 ? <p role="status" className="text-sm text-gold">{expiredChanges.length === 1 ? "Un juego cerró" : `${expiredChanges.length} juegos cerraron`} con cambios sin guardar. Se conserva lo que habías guardado antes del cierre.</p> : null}
      <div className="space-y-3">
        {matches.map((match, index) => {
          const locked = weeklyMatchIsLocked(match, now);
          const saved = savedValue(match);
          const draft = locked ? saved : (drafts[match.id] ?? saved);
          const changed = hasChanges(match);
          const result = weeklyMatchResult(match);
          const correct = result !== null && saved.selection === result;
          const disabled = locked || !canParticipate || saving;
          return (
            <article key={match.id} className={`space-y-3 rounded-[10px] border p-4 ${match.is_tiebreaker ? "border-gold/25" : "border-white/[0.08]"}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-ink">{index + 1}. {match.home_team} <span className="font-normal text-steel">vs</span> {match.away_team}</p>
                  <p className="mt-1 text-xs text-steel">{formatMexicoCityDateTime(match.kickoff_at)}</p>
                </div>
                <span className={`text-xs font-semibold ${locked ? "text-steel" : "text-mint"}`}>{locked ? "Cerrado" : "Abierto"}</span>
              </div>
              <div className="grid grid-cols-3 gap-2" role="group" aria-label={`Pronóstico de ${match.home_team} vs ${match.away_team}`}>
                {WEEKLY_SELECTIONS.map((option) => (
                  <button key={option.value} type="button" disabled={disabled} aria-pressed={draft.selection === option.value} onClick={() => updateDraft(match, { selection: option.value })} className={`rounded-[7px] border px-2 py-3 text-sm font-semibold transition disabled:cursor-default ${draft.selection === option.value ? "border-mint/50 bg-mint/10 text-mint" : "border-white/[0.1] text-steel enabled:hover:border-white/30"}`}>
                    <span className="block">{option.label}</span>
                    <span className="mt-0.5 block truncate text-[10px] font-normal opacity-75">{option.value === "home" ? match.home_team : option.value === "away" ? match.away_team : "Igualados"}</span>
                  </button>
                ))}
              </div>
              {match.is_tiebreaker ? (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-[7px] bg-gold/5 p-3">
                  <div className="max-w-[360px]">
                    <p className="text-xs font-semibold text-gold">Desempate · Total de goles</p>
                    <p className="mt-1 text-xs text-steel">Suma de goles de ambos equipos. Si empatas en aciertos, cuenta qué tan cerca quedaste.</p>
                  </div>
                  <input aria-label="Total de goles del partido de desempate" type="number" inputMode="numeric" min={0} max={99} step={1} value={draft.goals} disabled={disabled} onChange={(event) => updateDraft(match, { goals: event.target.value })} placeholder="0" className="field-control w-20 rounded-[6px] px-3 text-center disabled:opacity-70" />
                </div>
              ) : null}
              <div className="flex flex-wrap justify-between gap-2 text-xs">
                <span className="text-steel">{locked ? "Cerró" : "Cierra"}: {formatMexicoCityDateTime(match.lock_at)}</span>
                <span className={changed && !locked ? "text-gold" : "text-steel"}>{changed && !locked ? "Sin guardar" : saved.selection ? "Guardado" : locked ? "Sin pronóstico" : "Por elegir"}</span>
              </div>
              {result !== null ? <p className={`text-sm ${saved.selection ? correct ? "text-mint" : "text-coral" : "text-steel"}`}>Resultado: {match.home_score}–{match.away_score}{saved.selection ? correct ? " · Acierto" : " · Sin acierto" : ""}</p> : null}
            </article>
          );
        })}
      </div>
      {canParticipate ? (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" disabled={saving || editableChanges.length === 0} onClick={() => void savePicks()} className="app-pill px-5 disabled:opacity-50">{saving ? "Guardando…" : "Guardar pronósticos"}</button>
          <span className="text-xs text-steel">{editableChanges.length > 0 ? `${editableChanges.length} cambios por guardar` : "Sin cambios pendientes en juegos abiertos"}</span>
        </div>
      ) : null}
      <VipWeeklyRanking entries={vip.leaderboard} />
    </section>
  );
}
