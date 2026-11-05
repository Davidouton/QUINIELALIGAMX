import type { VipWeeklyMatch, VipWeeklySelection } from "@/types/api";

export const WEEKLY_MATCH_COUNT = 10;
export const WEEKLY_SELECTIONS: { value: VipWeeklySelection; label: string; short: string }[] = [
  { value: "home", label: "Local", short: "L" },
  { value: "draw", label: "Empate", short: "E" },
  { value: "away", label: "Visitante", short: "V" },
];

export function weeklyMatchIsLocked(match: VipWeeklyMatch, now = Date.now()) {
  const lockAt = Date.parse(match.lock_at);
  return match.is_locked || !Number.isFinite(lockAt) || now >= lockAt;
}

export function weeklyMatchResult(match: VipWeeklyMatch): VipWeeklySelection | null {
  if (match.home_score === null || match.away_score === null) return null;
  if (match.home_score === match.away_score) return "draw";
  return match.home_score > match.away_score ? "home" : "away";
}

export function weeklyGoalValue(value: string): number | null {
  if (!/^\d{1,2}$/.test(value)) return null;
  return Number(value);
}
