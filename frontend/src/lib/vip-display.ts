import type { VipCompetitionKind, VipLifecycleStatus } from "@/types/api";

type VipDisplay = {
  competition_kind: VipCompetitionKind;
  lifecycle_status: VipLifecycleStatus;
  season_name?: string | null;
  season_visibility_status?: string | null;
  is_archived?: boolean;
  archived_at?: string | null;
};

export function isVipArchived(vip: VipDisplay) {
  return Boolean(vip.is_archived || vip.archived_at || vip.lifecycle_status === "archived" || (
    vip.competition_kind !== "weekly_pool" && vip.season_visibility_status === "archived"
  ));
}

export function vipModeName(kind: VipCompetitionKind) {
  if (kind === "weekly_pool") return "Quinielón Semanal";
  if (kind === "question_pool") return "Preguntas / trivia";
  if (kind === "team_winner") return "Equipo ganador";
  return "VIP por jornadas";
}

export function vipContextLabel(vip: VipDisplay) {
  return vip.competition_kind === "weekly_pool" ? "Independiente · 10 juegos" : (vip.season_name || "Sin temporada");
}

export function normalizedVipSearch(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().trim();
}
