export type MatchdayStatus = "draft" | "active" | "closed" | "published";
export type MatchStatus = "scheduled" | "final" | "postponed" | "cancelled";
export type PickSelection = "home" | "draw" | "away";
export type ThemePreference = "standard" | "favorite_team";
export type PaymentModality = "pre_pago" | "aval";

export interface Matchday {
  id: string;
  season_id: string;
  number: number;
  name: string;
  default_lock_offset_minutes: number;
  picks_reopened_override: boolean;
  status: MatchdayStatus;
  starts_at: string;
  ends_at: string;
}

export interface Match {
  id: string;
  matchday_id: string;
  external_id: string | null;
  match_key: string;
  home_team_id: string;
  away_team_id: string;
  home_team_name: string;
  away_team_name: string;
  kickoff_at: string;
  picks_lock_at: string;
  status: MatchStatus;
  venue: string | null;
  is_locked: boolean;
  odds_provider_name: string | null;
  home_win_probability: number | null;
  draw_probability: number | null;
  away_win_probability: number | null;
}

export interface Pick {
  id: string;
  profile_id: string;
  match_id: string;
  matchday_id: string;
  selection: PickSelection;
  predicted_home_score: number;
  predicted_away_score: number;
  home_team_name: string;
  away_team_name: string;
  kickoff_at: string;
  is_locked: boolean;
  created_at: string;
  updated_at: string;
}

export interface PickResultRow {
  match_id: string;
  matchday_id: string;
  home_team_name: string;
  home_team_crest_url: string | null;
  away_team_name: string;
  away_team_crest_url: string | null;
  kickoff_at: string;
  match_status: string;
  has_pick: boolean;
  selection: PickSelection | null;
  predicted_home_score: number | null;
  predicted_away_score: number | null;
  home_score: number | null;
  away_score: number | null;
  is_official: boolean;
  result_points: number;
  exact_score_points: number;
  total_points: number;
}

export interface GlobalPickPlayer {
  profile_id: string;
  display_name: string;
}

export interface GlobalPickMatch {
  match_id: string;
  home_team_name: string;
  home_team_crest_url: string | null;
  away_team_name: string;
  away_team_crest_url: string | null;
  kickoff_at: string;
  is_locked: boolean;
}

export interface GlobalPickCell {
  profile_id: string;
  match_id: string;
  has_pick: boolean;
  is_revealed: boolean;
  selection: PickSelection | null;
  predicted_home_score: number | null;
  predicted_away_score: number | null;
}

export interface GlobalPickBoard {
  matchday_id: string;
  players: GlobalPickPlayer[];
  matches: GlobalPickMatch[];
  cells: GlobalPickCell[];
}

export interface LeaderboardEntry {
  profile_id: string;
  display_name: string;
  role_code: string;
  total_points: number;
  correct_results: number;
  exact_scores: number;
  rank_position: number;
}

export interface MyMatchdayPointsEntry {
  matchday_id: string;
  season_id: string;
  matchday_number: number;
  matchday_name: string;
  total_points: number;
  correct_results: number;
  exact_scores: number;
  rank_position: number | null;
  cumulative_points: number;
  weekly_prize_amount: number;
}

export interface PublishedResult {
  match_id: string;
  matchday_id: string;
  home_team_name: string;
  away_team_name: string;
  home_score: number;
  away_score: number;
  is_official: boolean;
  published_at: string;
}

export interface Result {
  match_id: string;
  matchday_id: string;
  home_team_name: string;
  away_team_name: string;
  home_score: number;
  away_score: number;
  is_official: boolean;
}

export interface Me {
  id: string;
  email: string | null;
  display_name: string;
  favorite_team_id: string | null;
  contact_phone: string | null;
  bank_name: string | null;
  deposit_account: string | null;
  modality: PaymentModality;
  aval_profile_id: string | null;
  theme_preference: ThemePreference;
  role_code: string;
  is_active: boolean;
  active_season_id: string | null;
  active_season_name: string | null;
  can_participate_active_season: boolean;
  is_paid_active_season: boolean;
}

export interface RegisteredUserOption {
  id: string;
  display_name: string;
}

export interface PrizeSummary {
  season_id: string | null;
  season_name: string | null;
  confirmed_participants: number;
  entry_fee_amount: number;
  gross_pool_amount: number;
  admin_commission_pct: number;
  admin_commission_amount: number;
  reserve_pct: number;
  reserve_amount: number;
  income_after_commission_amount: number;
  net_income_amount: number;
  weekly_first_place_amount: number;
  weekly_second_place_amount: number;
  weekly_third_place_amount: number;
  weekly_total_prize_amount: number;
  tournament_matchdays_count: number;
  total_weekly_prizes_amount: number;
  distributable_prize_pool_amount: number;
  first_place_pct: number;
  first_place_amount: number;
  second_place_pct: number;
  second_place_amount: number;
  third_place_pct: number;
  third_place_amount: number;
}

export interface DashboardSummary {
  season_id: string | null;
  season_name: string | null;
  total_points: number;
  overall_rank: number | null;
  weekly_prizes_count: number;
  average_points_per_matchday: number;
  projected_total_points: number;
  projected_rank: number | null;
  tournament_matchdays: number;
  completed_matchdays: number;
  remaining_matchdays: number;
}

export interface AdvancedStats {
  season_id: string | null;
  season_name: string | null;
  graded_picks: number;
  best_matchday_name: string | null;
  best_matchday_points: number;
  home_bets: number;
  draw_bets: number;
  away_bets: number;
  max_hit_points: number;
  result_hit_points: number;
  exact_hits: number;
  result_hits: number;
  overall_effectiveness_pct: number;
  home_effectiveness_pct: number;
  draw_effectiveness_pct: number;
  away_effectiveness_pct: number;
  home_points: number;
  draw_points: number;
  away_points: number;
}

export interface PerformanceRacePoint {
  matchday_id: string;
  matchday_number: number;
  matchday_name: string;
  user_cumulative_points: number;
  leader_cumulative_points: number;
  first_place_cumulative_points: number;
  third_place_cumulative_points: number;
}

export interface PerformanceRace {
  season_id: string | null;
  season_name: string | null;
  leader_profile_id: string | null;
  leader_name: string | null;
  tournament_matchdays: number;
  completed_matchdays: number;
  projected_user_total: number;
  projected_leader_total: number;
  projected_first_place_total: number;
  projected_third_place_total: number;
  points: PerformanceRacePoint[];
}

export interface HallOfFameEntry {
  profile_id: string;
  display_name: string;
  value: number;
  detail: string | null;
  place_label: string | null;
  image_url: string | null;
}

export interface HallOfFameTournamentPodium {
  tournament_name: string;
  entries: HallOfFameEntry[];
}

export interface HallOfFameResponse {
  podium_tournament_name: string | null;
  podium: HallOfFameEntry[];
  podium_tournaments: string[];
  podiums_by_tournament: HallOfFameTournamentPodium[];
  champions: HallOfFameEntry[];
  points: HallOfFameEntry[];
  weekly_wins: HallOfFameEntry[];
  exact_scores: HallOfFameEntry[];
}

export interface HistoricalChampionRecord {
  id: string;
  tournament_name: string;
  user_name: string;
  awarded_profile_id: string | null;
  place_label: string;
  trophy_asset_id: string | null;
  trophy_name: string | null;
  image_url: string | null;
  total_points: number;
  created_at: string;
  updated_at: string;
}

export interface TrophyAssetRecord {
  id: string;
  name: string;
  category: string;
  asset_code: string | null;
  season_id: string | null;
  matchday_number: number | null;
  award_place_label: string | null;
  image_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface PersonalTrophyRecord {
  id: string;
  tournament_name: string;
  place_label: string;
  recognition_type: "trophy" | "award";
  trophy_name: string | null;
  image_url: string | null;
  total_points: number;
}

export interface RulePage {
  id: string;
  slug: string;
  title: string;
  content_markdown: string;
  version_label: string | null;
  created_at: string;
  updated_at: string;
}

export interface Season {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  start_matchday_id: string | null;
  end_matchday_id: string | null;
  participants_lock_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Team {
  id: string;
  external_id: string | null;
  name: string;
  short_name: string;
  slug: string;
  crest_url: string | null;
  home_venue: string | null;
  primary_color: string | null;
  secondary_color: string | null;
  accent_color: string | null;
  created_at: string;
  updated_at: string;
}

export interface OddsPreviewRow {
  match_date: string;
  home_team: string;
  away_team: string;
  ml_home: string | null;
  ml_draw: string | null;
  ml_away: string | null;
}

export interface OddsSnapshotOption {
  snapshot_date: string;
  raw_rows_processed: number;
}

export interface OddsPullResult {
  status: string;
  snapshot_date: string | null;
  raw_rows_processed: number | null;
  matched: number | null;
  unmatched: number | null;
  preview_rows: OddsPreviewRow[];
  pull_output: string;
  sync_output: string;
}

export interface AdminSettings {
  active_season_id: string | null;
  start_matchday_id: string | null;
  end_matchday_id: string | null;
  participants_lock_at: string | null;
  participants_locked: boolean;
  eligible_participants: number;
  confirmed_participants: number;
  entry_fee_amount: number;
  weekly_first_place_amount: number;
  weekly_second_place_amount: number;
  weekly_third_place_amount: number;
  weekly_total_prize_amount: number;
  tournament_matchdays_count: number;
  admin_commission_pct: number;
  reserve_pct: number;
  first_place_pct: number;
  second_place_pct: number;
  third_place_pct: number;
  gross_pool_amount: number;
  admin_commission_amount: number;
  income_after_commission_amount: number;
  total_weekly_prizes_amount: number;
  reserve_amount: number;
  distributable_prize_pool_amount: number;
  first_place_amount: number;
  second_place_amount: number;
  third_place_amount: number;
  result_correct_points: number;
  exact_score_points: number;
  evaluated_picks: number | null;
  weekly_leaders: number | null;
}

export interface AdminUserSeasonMembership {
  season_id: string;
  season_name: string;
  is_active: boolean;
  is_paid: boolean;
  eligible_for_scoring: boolean;
  eligible_locked_at: string | null;
  activated_at: string | null;
  notes: string | null;
}

export interface AdminUser {
  id: string;
  auth_user_id: string;
  email: string | null;
  display_name: string;
  favorite_team_name: string | null;
  contact_phone: string | null;
  bank_name: string | null;
  deposit_account: string | null;
  modality: string;
  aval_profile_id: string | null;
  aval_display_name: string | null;
  theme_preference: ThemePreference;
  role_code: string;
  is_active: boolean;
  created_at: string;
  selected_season_membership: AdminUserSeasonMembership | null;
}

export interface AdminResultRow {
  match_id: string;
  matchday_id: string;
  home_team_name: string;
  away_team_name: string;
  kickoff_at: string;
  match_status: MatchStatus;
  home_score: number | null;
  away_score: number | null;
  is_official: boolean;
  is_published: boolean;
  source_provider_name: string | null;
  is_manual_override: boolean;
}
