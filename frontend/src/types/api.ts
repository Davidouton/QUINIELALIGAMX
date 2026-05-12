export type MatchdayStatus = "draft" | "active" | "closed" | "published";
export type MatchStatus = "scheduled" | "final" | "postponed" | "cancelled";
export type TournamentFormat = "standard" | "world_cup";
export type MatchStageType =
  | "regular"
  | "group"
  | "round_of_32"
  | "round_of_16"
  | "quarterfinal"
  | "semifinal"
  | "third_place"
  | "final";
export type PickSelection = "home" | "draw" | "away";
export type ThemePreference = "standard" | "auto" | "night" | "day_blue" | "favorite_team";
export type PaymentModality = "pre_pago" | "aval";
export type PaymentScopeType = "season" | "vip" | "quiniela_plus";
export type PaymentStatus =
  | "pending_checkout"
  | "checkout_created"
  | "paid"
  | "expired"
  | "cancelled"
  | "failed";
export type VipMembershipStatus = "pending" | "approved" | "rejected";
export type PickReminderHoursBefore = 1 | 3;
export type QuinielaPlusBillingPeriod = "weekly" | "monthly" | "quarterly" | "semiannual" | "annual";
export type QuinielaPlusMembershipStatus = "active" | "expired" | "cancelled";

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
  home_team_id: string | null;
  away_team_id: string | null;
  stage_type: MatchStageType;
  group_label: string | null;
  bracket_slot: string | null;
  home_placeholder: string | null;
  away_placeholder: string | null;
  home_team_name: string;
  away_team_name: string;
  kickoff_at: string;
  picks_lock_at: string;
  status: MatchStatus;
  venue: string | null;
  is_locked: boolean;
  is_ready_for_picks: boolean;
  odds_provider_name: string | null;
  spread_home_line: string | null;
  spread_away_line: string | null;
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
  spread_selection: PickSelection | null;
  spread_line_value: string | null;
  predicted_home_score: number;
  predicted_away_score: number;
  advancing_team_id: string | null;
  home_team_name: string;
  away_team_name: string;
  stage_type: MatchStageType;
  group_label: string | null;
  bracket_slot: string | null;
  home_placeholder: string | null;
  away_placeholder: string | null;
  kickoff_at: string;
  is_locked: boolean;
  is_ready_for_picks: boolean;
  is_admin_override: boolean;
  admin_override_note: string | null;
  overridden_by_profile_id: string | null;
  overridden_by_display_name: string | null;
  overridden_at: string | null;
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
  advancing_team_id: string | null;
  spread_selection: PickSelection | null;
  spread_line_value: string | null;
  home_score: number | null;
  away_score: number | null;
  official_advancing_team_id: string | null;
  is_official: boolean;
  is_admin_override: boolean;
  admin_override_note: string | null;
  overridden_by_display_name: string | null;
  overridden_at: string | null;
  result_points: number;
  exact_score_points: number;
  advancing_team_points: number;
  spread_points: number;
  total_points: number;
}

export interface AdminPickRow {
  pick_id: string | null;
  profile_id: string;
  profile_display_name: string;
  match_id: string;
  matchday_id: string;
  home_team_id: string | null;
  home_placeholder: string | null;
  home_team_name: string;
  away_team_id: string | null;
  away_placeholder: string | null;
  away_team_name: string;
  stage_type: MatchStageType;
  group_label: string | null;
  bracket_slot: string | null;
  kickoff_at: string;
  picks_lock_at: string;
  match_status: MatchStatus;
  has_pick: boolean;
  is_locked: boolean;
  is_ready_for_picks: boolean;
  selection: PickSelection | null;
  spread_selection: PickSelection | null;
  spread_line_value: string | null;
  predicted_home_score: number | null;
  predicted_away_score: number | null;
  advancing_team_id: string | null;
  is_admin_override: boolean;
  admin_override_note: string | null;
  overridden_by_profile_id: string | null;
  overridden_by_display_name: string | null;
  overridden_at: string | null;
  updated_at: string | null;
}

export interface GlobalPickPlayer {
  profile_id: string;
  display_name: string;
}

export interface GlobalPickMatch {
  match_id: string;
  home_team_id: string | null;
  home_placeholder: string | null;
  home_team_name: string;
  home_team_crest_url: string | null;
  away_team_id: string | null;
  away_placeholder: string | null;
  away_team_name: string;
  away_team_crest_url: string | null;
  stage_type: MatchStageType;
  group_label: string | null;
  bracket_slot: string | null;
  kickoff_at: string;
  is_locked: boolean;
  is_ready_for_picks: boolean;
  spread_home_line: string | null;
  spread_away_line: string | null;
}

export interface GlobalPickCell {
  profile_id: string;
  match_id: string;
  has_pick: boolean;
  is_revealed: boolean;
  selection: PickSelection | null;
  predicted_home_score: number | null;
  predicted_away_score: number | null;
  advancing_team_id: string | null;
  spread_selection: PickSelection | null;
  spread_line_value: string | null;
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

export interface VipMatchday {
  id: string;
  season_id: string;
  number: number;
  name: string;
}

export interface VipLeaderboardEntry {
  profile_id: string;
  display_name: string;
  total_points: number;
  correct_results: number;
  exact_scores: number;
  rank_position: number;
}

export interface VipMembership {
  id: string;
  profile_id: string;
  display_name: string;
  status: VipMembershipStatus;
  requested_at: string;
  decided_at: string | null;
  decided_by_profile_id: string | null;
  decided_by_display_name: string | null;
  admin_note: string | null;
}

export interface VipCompetition {
  id: string;
  season_id: string;
  season_name: string;
  name: string;
  entry_fee_amount: number;
  admin_commission_pct: number;
  first_place_pct: number;
  second_place_pct: number;
  third_place_pct: number;
  is_active: boolean;
  matchdays: VipMatchday[];
  approved_members_count: number;
  pending_requests_count: number;
  gross_pool_amount: number;
  admin_commission_amount: number;
  distributable_prize_pool_amount: number;
  first_place_amount: number;
  second_place_amount: number;
  third_place_amount: number;
  remaining_pool_amount: number;
  my_membership: VipMembership | null;
  leaderboard: VipLeaderboardEntry[];
}

export interface VipJoinResponse {
  vip_id: string;
  membership: VipMembership;
}

export interface AdminVipCompetition {
  id: string;
  season_id: string;
  season_name: string;
  name: string;
  entry_fee_amount: number;
  admin_commission_pct: number;
  first_place_pct: number;
  second_place_pct: number;
  third_place_pct: number;
  is_active: boolean;
  created_by_profile_id: string | null;
  created_by_display_name: string | null;
  matchdays: VipMatchday[];
  memberships: VipMembership[];
  approved_members_count: number;
  pending_requests_count: number;
  gross_pool_amount: number;
  admin_commission_amount: number;
  distributable_prize_pool_amount: number;
  first_place_amount: number;
  second_place_amount: number;
  third_place_amount: number;
  remaining_pool_amount: number;
  leaderboard: VipLeaderboardEntry[];
}

export interface PricingRule {
  id: string;
  scope_type: PaymentScopeType;
  scope_id: string;
  label: string;
  amount: number;
  currency: string;
  starts_at: string | null;
  ends_at: string | null;
  start_matchday_number: number | null;
  end_matchday_number: number | null;
  is_active: boolean;
  created_by_profile_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface EffectivePricing {
  scope_type: PaymentScopeType;
  scope_id: string;
  label: string;
  amount: number;
  currency: string;
  pricing_rule_id: string;
}

export interface CheckoutSessionResponse {
  payment_id: string;
  checkout_session_id: string;
  checkout_url: string;
  scope_type: PaymentScopeType;
  scope_id: string;
  label: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
}

export interface PaymentRecord {
  id: string;
  scope_type: PaymentScopeType;
  scope_id: string;
  pricing_rule_id: string | null;
  provider_name: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
  stripe_customer_id: string | null;
  checkout_url: string | null;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface QuinielaPlusLeague {
  id: string;
  sport_name: string;
  league_name: string;
  slug: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface QuinielaPlusPlan {
  id: string;
  name: string;
  billing_period: QuinielaPlusBillingPeriod;
  included_leagues_count: number | null;
  includes_all_leagues: boolean;
  price_amount: number;
  currency: string;
  is_active: boolean;
  sort_order: number;
  created_by_profile_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface QuinielaPlusMembershipLeague {
  id: string;
  sport_name: string;
  league_name: string;
  slug: string;
}

export interface QuinielaPlusMembership {
  id: string;
  status: QuinielaPlusMembershipStatus;
  starts_at: string;
  ends_at: string;
  created_at: string;
  plan: QuinielaPlusPlan;
  leagues: QuinielaPlusMembershipLeague[];
}

export interface QuinielaPlusCatalog {
  checkout_enabled: boolean;
  checkout_message: string | null;
  leagues: QuinielaPlusLeague[];
  plans: QuinielaPlusPlan[];
  active_memberships: QuinielaPlusMembership[];
}

export interface QuinielaPlusAdminSettings {
  checkout_enabled: boolean;
  checkout_message: string | null;
}

export interface QuinielaPlusAdminConsole {
  settings: QuinielaPlusAdminSettings;
  leagues: QuinielaPlusLeague[];
  plans: QuinielaPlusPlan[];
}

export interface WorldCupGroupStanding {
  team_id: string;
  team_name: string;
  team_short_name: string;
  team_crest_url: string | null;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goals_for: number;
  goals_against: number;
  goal_difference: number;
  points: number;
}

export interface WorldCupGroup {
  group_label: string;
  standings: WorldCupGroupStanding[];
}

export interface WorldCupAdminGroupTeam {
  team_id: string;
  team_name: string;
  team_short_name: string;
  team_crest_url: string | null;
}

export interface WorldCupAdminGroup {
  id: string;
  season_id: string;
  group_label: string;
  display_name: string | null;
  sort_order: number;
  teams: WorldCupAdminGroupTeam[];
}

export interface WorldCupBracketMatch {
  match_id: string;
  matchday_id: string;
  stage_type: MatchStageType;
  bracket_slot: string | null;
  home_team_id: string | null;
  home_placeholder: string | null;
  home_team_name: string;
  home_team_short_name: string;
  home_team_crest_url: string | null;
  away_team_id: string | null;
  away_placeholder: string | null;
  away_team_name: string;
  away_team_short_name: string;
  away_team_crest_url: string | null;
  kickoff_at: string;
  home_score: number | null;
  away_score: number | null;
  advancing_team_id: string | null;
  is_official: boolean;
  is_ready_for_picks: boolean;
}

export interface WorldCupBoard {
  season_id: string;
  season_name: string;
  groups: WorldCupGroup[];
  round_of_32: WorldCupBracketMatch[];
  round_of_16: WorldCupBracketMatch[];
  quarterfinals: WorldCupBracketMatch[];
  semifinals: WorldCupBracketMatch[];
  third_place: WorldCupBracketMatch[];
  final: WorldCupBracketMatch[];
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
  advancing_team_id: string | null;
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
  pick_reminder_email_enabled: boolean;
  pick_reminder_opening_enabled: boolean;
  pick_reminder_hours_before: PickReminderHoursBefore | null;
  role_code: string;
  is_active: boolean;
  active_season_id: string | null;
  active_season_name: string | null;
  can_participate_active_season: boolean;
  is_paid_active_season: boolean;
  selected_season_id: string | null;
  selected_season_name: string | null;
  can_participate_selected_season: boolean;
  is_paid_selected_season: boolean;
  selected_season_membership: UserSeasonMembership | null;
  season_memberships: UserSeasonMembership[];
}

export interface UserSeasonMembership {
  season_id: string;
  season_name: string;
  competition_id: string | null;
  competition_name: string | null;
  is_active: boolean;
  is_paid: boolean;
  eligible_for_scoring: boolean;
  can_participate: boolean;
  eligible_locked_at: string | null;
  activated_at: string | null;
  notes: string | null;
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

export interface Competition {
  id: string;
  sport_name: string;
  name: string;
  slug: string;
  provider_league_id: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface Season {
  id: string;
  name: string;
  slug: string;
  competition_id: string | null;
  competition_name: string | null;
  competition_sport_name: string | null;
  tournament_format: TournamentFormat;
  is_active: boolean;
  start_matchday_id: string | null;
  end_matchday_id: string | null;
  participants_lock_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Team {
  id: string;
  competition_id: string | null;
  competition_name: string | null;
  competition_sport_name: string | null;
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
  advancing_team_points: number;
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
  home_team_id: string | null;
  home_placeholder: string | null;
  home_team_name: string;
  away_team_id: string | null;
  away_placeholder: string | null;
  away_team_name: string;
  stage_type: MatchStageType;
  group_label: string | null;
  bracket_slot: string | null;
  kickoff_at: string;
  match_status: MatchStatus;
  home_score: number | null;
  away_score: number | null;
  advancing_team_id: string | null;
  is_official: boolean;
  is_ready_for_picks: boolean;
  is_published: boolean;
  source_provider_name: string | null;
  is_manual_override: boolean;
}
