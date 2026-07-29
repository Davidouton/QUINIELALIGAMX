export type MatchdayStatus = "draft" | "active" | "closed" | "published";
export type MatchStatus = "scheduled" | "final" | "postponed" | "cancelled";
export type TournamentFormat = "standard" | "world_cup";
export type CompetitionStructureFormat =
  | "league_table"
  | "league_playoff"
  | "groups_playoff"
  | "conferences_playoff"
  | "leagues_cup"
  | "knockout";

export interface CompetitionConferenceConfig {
  name: string;
  divisions: string[];
}

export interface CompetitionStructureConfig {
  groups?: string[];
  conferences?: CompetitionConferenceConfig[];
  leagues?: string[];
  phase_one_matches_per_team?: number;
  regulation_win_points?: number;
  shootout_win_points?: number;
  shootout_loss_points?: number;
  qualifiers_per_league?: number;
  playoff_seed_count?: number;
  playoff_rounds?: string[];
  reseed_after_each_round?: boolean;
}
export type SeasonVisibilityStatus = "live" | "testing" | "closed" | "archived";
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
export type PaymentScopeType = "season" | "survivor" | "vip" | "quiniela_plus";
export type PaymentStatus =
  | "pending_checkout"
  | "checkout_created"
  | "paid"
  | "expired"
  | "cancelled"
  | "failed";
export type SettlementStatus = "pending_proof" | "proof_submitted" | "confirmed" | "rejected";
export type VipMembershipStatus = "pending" | "approved" | "rejected";
export type PickReminderHoursBefore = 1 | 3;
export type DashboardWidgetId =
  | "summary"
  | "performance"
  | "matchday_points"
  | "matchday_results"
  | "prize_summary"
  | "upcoming"
  | "memberships"
  | "survivor_summary"
  | "ranking";

export interface DashboardWidgetConfig {
  id: string;
  widget_id: DashboardWidgetId;
  season_id: string | null;
}
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
  home_team_id: string | null;
  home_team_name: string;
  home_team_crest_url: string | null;
  away_team_id: string | null;
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

export interface AnalyticsKpi {
  total_events: number;
  unique_users: number;
  screen_views: number;
  action_events: number;
  failure_events: number;
  avg_screen_load_ms: number | null;
}

export interface AnalyticsScreenStat {
  screen_name: string;
  route_path: string | null;
  views: number;
  unique_users: number;
  avg_load_ms: number | null;
  failures: number;
}

export interface AnalyticsEventStat {
  category: string;
  event_name: string;
  count: number;
  unique_users: number;
}

export interface AnalyticsDailyStat {
  day: string;
  screen_views: number;
  action_events: number;
  failure_events: number;
  unique_users: number;
}

export interface AnalyticsUserStat {
  profile_id: string;
  display_name: string;
  screen_views: number;
  action_events: number;
  failure_events: number;
  avg_load_ms: number | null;
  last_seen_at: string | null;
}

export interface AnalyticsRecentEvent {
  id: string;
  created_at: string;
  profile_id: string | null;
  display_name: string | null;
  category: string;
  event_name: string;
  route_path: string | null;
  screen_name: string | null;
  success: boolean | null;
  duration_ms: number | null;
}

export interface AdminAnalyticsStats {
  window_days: number;
  generated_at: string;
  selected_profile_id: string | null;
  selected_profile_display_name: string | null;
  kpis: AnalyticsKpi;
  users: AnalyticsUserStat[];
  screens: AnalyticsScreenStat[];
  top_events: AnalyticsEventStat[];
  daily: AnalyticsDailyStat[];
  recent_events: AnalyticsRecentEvent[];
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
  home_score: number | null;
  away_score: number | null;
  official_advancing_team_id: string | null;
  is_official: boolean;
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
  username: string | null;
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

export type VipCompetitionKind = "matchday" | "team_winner" | "question_pool";
export type VipLifecycleStatus = "active" | "closed_pending_payments" | "settled" | "archived";

export interface VipLeaderboardEntry {
  profile_id: string;
  display_name: string;
  username: string | null;
  total_points: number;
  correct_results: number;
  exact_scores: number;
  rank_position: number;
}

export interface VipQuestionPoolOption {
  id: string;
  option_text: string;
  sort_order: number;
  is_correct: boolean;
}

export interface VipQuestionPoolQuestion {
  id: string;
  prompt: string;
  points: number;
  sort_order: number;
  is_active: boolean;
  selected_option_id: string | null;
  answered_at: string | null;
  responses_count: number;
  options: VipQuestionPoolOption[];
}

export interface VipTeamWinnerTeam {
  id: string;
  team_id: string;
  team_name: string;
  team_short_name: string;
  team_crest_url: string | null;
  is_eliminated: boolean;
  is_champion: boolean;
}

export interface VipTeamWinnerEntry {
  id: string;
  profile_id: string | null;
  display_name: string;
  is_house: boolean;
  assigned_team_id: string | null;
  assigned_team_name: string | null;
  assigned_team_short_name: string | null;
  assigned_team_crest_url: string | null;
  assigned_team_eliminated: boolean;
  assigned_team_champion: boolean;
  reveal_order: number | null;
  revealed_at: string | null;
  is_paid: boolean;
}

export interface VipMembership {
  id: string;
  profile_id: string;
  display_name: string;
  username: string | null;
  status: VipMembershipStatus;
  is_paid: boolean;
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
  season_visibility_status: SeasonVisibilityStatus;
  competition_kind: VipCompetitionKind;
  name: string;
  entry_fee_amount: number;
  admin_commission_pct: number;
  first_place_pct: number;
  second_place_pct: number;
  third_place_pct: number;
  is_active: boolean;
  lifecycle_status: VipLifecycleStatus;
  questions_lock_at: string | null;
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
  join_locked: boolean;
  join_lock_at: string | null;
  join_lock_match_label: string | null;
  my_membership: VipMembership | null;
  approved_members: VipMembership[];
  leaderboard: VipLeaderboardEntry[];
  matchday_points: MyMatchdayPointsEntry[];
  performance_race: PerformanceRace | null;
  team_winner_teams: VipTeamWinnerTeam[];
  team_winner_entries: VipTeamWinnerEntry[];
  question_pool_questions: VipQuestionPoolQuestion[];
}

export interface VipJoinResponse {
  vip_id: string;
  membership: VipMembership;
}

export interface AdminVipCompetition {
  id: string;
  season_id: string;
  season_name: string;
  competition_kind: VipCompetitionKind;
  name: string;
  entry_fee_amount: number;
  admin_commission_pct: number;
  first_place_pct: number;
  second_place_pct: number;
  third_place_pct: number;
  is_active: boolean;
  lifecycle_status: VipLifecycleStatus;
  questions_lock_at: string | null;
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
  join_locked: boolean;
  join_lock_at: string | null;
  join_lock_match_label: string | null;
  leaderboard: VipLeaderboardEntry[];
  team_winner_teams: VipTeamWinnerTeam[];
  team_winner_entries: VipTeamWinnerEntry[];
  question_pool_questions: VipQuestionPoolQuestion[];
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

export interface SettlementConfig {
  scope_type: PaymentScopeType;
  scope_id: string;
  max_payment_amount: number;
  confirmation_window_hours: number;
  commission_recipient_profile_id: string | null;
  commission_recipient_display_name: string | null;
  commission_allocations: CommissionAllocation[];
  created_by_profile_id: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface SettlementParticipant {
  profile_id: string;
  display_name: string;
  rank_position: number | null;
  total_points: number;
  prize_amount: number;
  weekly_prize_amount: number;
  final_prize_amount: number;
  admin_commission_amount: number;
  pending_entry_amount: number;
  net_amount: number;
  is_payer_candidate: boolean;
  is_selected_payer: boolean;
  contact_phone: string | null;
  bank_name: string | null;
  deposit_account: string | null;
  modality: string | null;
  aval_display_name: string | null;
}

export interface CommissionAllocation {
  profile_id: string;
  amount: number;
  display_name?: string | null;
}

export interface SettlementAssignment {
  id: string;
  scope_type: PaymentScopeType;
  scope_id: string;
  scope_label: string | null;
  payer_profile_id: string;
  payer_display_name: string;
  payer_contact_phone: string | null;
  payee_profile_id: string;
  payee_display_name: string;
  payee_contact_phone: string | null;
  payee_bank_name: string | null;
  payee_deposit_account: string | null;
  amount: number;
  currency: string;
  status: SettlementStatus;
  proof_image_url: string | null;
  proof_note: string | null;
  proof_uploaded_at: string | null;
  auto_confirm_at: string | null;
  confirmed_automatically: boolean;
  confirmed_by_profile_id: string | null;
  confirmed_by_display_name: string | null;
  confirmed_at: string | null;
  rejected_by_profile_id: string | null;
  rejected_by_display_name: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  created_by_profile_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface SettlementScopeSummary {
  scope_type: PaymentScopeType;
  scope_id: string;
  scope_label: string;
  config: SettlementConfig;
  participants: SettlementParticipant[];
  assignments: SettlementAssignment[];
  selected_payer_profile_ids: string[];
  total_receivable_amount: number;
  total_selected_payable_amount: number;
  total_assigned_amount: number;
  expected_admin_commission_amount: number;
  uncovered_receiver_amount: number;
  unallocated_payer_amount: number;
}

export interface SettlementGeneratedScope {
  scope_type: "season" | "vip";
  scope_id: string;
  scope_label: string;
  assignments_count: number;
  pending_count: number;
  proof_submitted_count: number;
  confirmed_count: number;
  rejected_count: number;
  total_assigned_amount: number;
  updated_at: string;
}

export interface MySettlementsResponse {
  outgoing: SettlementAssignment[];
  incoming: SettlementAssignment[];
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

export interface QuinielaPlusOddsSneakPeekMatch {
  match_id: string;
  matchday_id: string;
  matchday_number: number;
  matchday_name: string;
  home_team_name: string;
  home_team_short_name: string;
  home_team_crest_url: string | null;
  away_team_name: string;
  away_team_short_name: string;
  away_team_crest_url: string | null;
  kickoff_at: string;
  odds_provider_name: string;
  home_win_probability: number;
  draw_probability: number;
  away_win_probability: number;
}

export interface QuinielaPlusOddsSneakPeek {
  title: string;
  matches: QuinielaPlusOddsSneakPeekMatch[];
}

export interface QuinielaPlusUserSelectionDistribution {
  home_count: number;
  draw_count: number;
  away_count: number;
  home_percentage: number;
  draw_percentage: number;
  away_percentage: number;
}

export interface QuinielaPlusScoreDistribution {
  score_label: string;
  home_score: number;
  away_score: number;
  count: number;
  percentage: number;
}

export interface QuinielaPlusUserDistributionMatch {
  match_id: string;
  matchday_id: string;
  matchday_number: number;
  matchday_name: string;
  home_team_name: string;
  home_team_short_name: string;
  home_team_crest_url: string | null;
  home_team_primary_color: string | null;
  away_team_name: string;
  away_team_short_name: string;
  away_team_crest_url: string | null;
  away_team_primary_color: string | null;
  kickoff_at: string;
  is_locked: boolean;
  total_picks: number;
  selection_distribution: QuinielaPlusUserSelectionDistribution;
  score_distribution: QuinielaPlusScoreDistribution[];
}

export interface QuinielaPlusUserDistribution {
  title: string;
  matches: QuinielaPlusUserDistributionMatch[];
}

export interface QuinielaPlusAdvancedStatsMatch {
  fixture_id: string;
  date: string;
  kickoff_at: string;
  round: string | null;
  group: string | null;
  home: string;
  away: string;
  home_win_prob: number;
  draw_prob: number;
  away_win_prob: number;
  xg_home: number;
  xg_away: number;
  most_likely_score: string;
  most_likely_score_prob: number;
  implied_odds_home: number;
  implied_odds_draw: number;
  implied_odds_away: number;
  win_margin_implied: number | null;
  btts_prob: number;
  over_0_5_prob: number | null;
  under_0_5_prob: number | null;
  over_1_5_prob: number;
  under_1_5_prob: number;
  over_2_5_prob: number;
  under_2_5_prob: number;
  over_3_5_prob: number;
  under_3_5_prob: number;
  scoreline_probabilities: Record<string, number>;
  h2h: Record<string, unknown>[];
  home_form: Record<string, unknown>[];
  away_form: Record<string, unknown>[];
  home_stats: Record<string, unknown>;
  away_stats: Record<string, unknown>;
}

export interface QuinielaPlusAdvancedStats {
  title: string;
  generated_at: string | null;
  matches: QuinielaPlusAdvancedStatsMatch[];
}

export interface QuinielaPlusValueRecommendation {
  id: string;
  fixture_id: string;
  kickoff_at: string | null;
  home: string;
  away: string;
  market_key: string;
  selection_key: string;
  line_value: number | null;
  model_probability: number | null;
  market_probability: number | null;
  market_odds: number | null;
  fair_odds_decimal: number | null;
  edge_probability: number | null;
  suggested_units: number;
  stake_bankroll_pct: number;
  strategy_label: string;
  stake_reason: string | null;
  odds_bucket: string | null;
  market_segment: string | null;
  entry_grade: string;
  outcome_status: "pending" | "settled" | "push";
  is_hit: boolean | null;
  result_label: string | null;
  profit_units: number | null;
  confidence_label: string;
  recommendation: string;
  reason: string | null;
  created_at: string;
}

export interface QuinielaPlusValueTrackStats {
  label: string;
  total: number;
  open: number;
  wins: number;
  losses: number;
  pushes: number;
  tracked_bets: number;
  staked_units: number;
  profit_units: number;
  hit_rate: number | null;
  roi: number | null;
}

export interface QuinielaPlusValueLab {
  title: string;
  generated_at: string | null;
  track_stats: QuinielaPlusValueTrackStats[];
  recommendations: QuinielaPlusValueRecommendation[];
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
  recent_form: Array<"win" | "draw" | "loss" | "shootout_win" | "shootout_loss">;
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
  home_penalty_score: number | null;
  away_penalty_score: number | null;
  advancing_team_id: string | null;
  is_official: boolean;
  is_ready_for_picks: boolean;
}

export interface WorldCupOfficialResult {
  match_id: string;
  matchday_id: string;
  matchday_number: number;
  matchday_name: string;
  stage_type: MatchStageType;
  group_label: string | null;
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
  home_penalty_score: number | null;
  away_penalty_score: number | null;
  advancing_team_id: string | null;
  is_official: boolean;
}

export interface WorldCupBoard {
  season_id: string;
  season_name: string;
  league_standings: WorldCupGroupStanding[];
  league_tables: Array<{
    league_label: string;
    standings: WorldCupGroupStanding[];
  }>;
  groups: WorldCupGroup[];
  official_results: WorldCupOfficialResult[];
  round_of_32: WorldCupBracketMatch[];
  round_of_16: WorldCupBracketMatch[];
  quarterfinals: WorldCupBracketMatch[];
  semifinals: WorldCupBracketMatch[];
  third_place: WorldCupBracketMatch[];
  final: WorldCupBracketMatch[];
}

export interface WorldCupNewsArticle {
  id: string;
  category: string;
  source: string;
  title: string;
  summary: string | null;
  url: string;
  published_at: string | null;
}

export interface WorldCupNewsFeed {
  category: string;
  articles: WorldCupNewsArticle[];
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

export interface WeeklyPrizeWinner {
  profile_id: string;
  display_name: string;
  rank_position: number;
  total_points: number;
  exact_scores: number;
  prize_amount: number;
}

export interface WeeklyPrizeMatchday {
  matchday_id: string;
  matchday_number: number;
  matchday_name: string;
  total_prize_amount: number;
  winners: WeeklyPrizeWinner[];
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
  username: string | null;
  favorite_team_id: string | null;
  contact_phone: string | null;
  bank_name: string | null;
  deposit_account: string | null;
  modality: PaymentModality;
  aval_profile_id: string | null;
  theme_preference: ThemePreference;
  dashboard_widget_ids: DashboardWidgetId[];
  dashboard_widgets: DashboardWidgetConfig[];
  pick_reminder_email_enabled: boolean;
  pick_reminder_opening_enabled: boolean;
  pick_reminder_hours_before: PickReminderHoursBefore | null;
  matchday_start_notification_enabled: boolean;
  match_result_notification_enabled: boolean;
  matchday_summary_notification_enabled: boolean;
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

export interface AppBootstrap {
  me: Me;
  seasons: Season[];
  matchdays: Matchday[];
  active_matchdays: Matchday[];
  teams: Team[];
}

export interface AppBranding {
  app_icon_url: string | null;
  show_live_tab: boolean;
}

export interface SurvivorCurrentMatchday {
  id: string;
  number: number;
  name: string;
  starts_at: string;
  ends_at: string;
}

export interface SurvivorPick {
  id: string;
  matchday_id: string;
  matchday_number: number;
  matchday_name: string;
  match_id: string;
  team_id: string;
  team_name: string;
  team_short_name: string;
  team_crest_url: string | null;
  opponent_team_name: string;
  opponent_team_short_name: string;
  opponent_team_crest_url: string | null;
  kickoff_at: string;
  is_locked: boolean;
  is_revealed: boolean;
  result_status: "pending" | "won" | "lost" | "draw";
  consumed_life: boolean;
  is_admin_override: boolean;
  admin_override_note: string | null;
  result_override: "pending" | "won" | "lost" | "draw" | null;
  consumes_life_override: boolean | null;
  created_at: string;
  updated_at: string;
}

export interface AdminSurvivorPick extends SurvivorPick {
  profile_id: string;
  profile_display_name: string;
  overridden_by_profile_id: string | null;
  overridden_by_display_name: string | null;
  overridden_at: string | null;
}

export interface SurvivorMembership {
  season_id: string;
  is_active: boolean;
  is_rejected: boolean;
  joined_at: string | null;
  max_lives: number;
  remaining_lives: number;
  lives_spent: number;
  alive: boolean;
  used_team_ids: string[];
  used_team_names: string[];
  current_pick: SurvivorPick | null;
}

export interface SurvivorAvailableTeam {
  team_id: string;
  team_name: string;
  team_short_name: string;
  team_crest_url: string | null;
  is_home_team: boolean;
  opponent_team_id: string | null;
  opponent_team_name: string;
  opponent_team_short_name: string;
  opponent_team_crest_url: string | null;
  match_id: string;
  kickoff_at: string;
  is_locked: boolean;
  already_used: boolean;
  is_current_pick: boolean;
}

export interface SurvivorLeaderboardEntry {
  profile_id: string;
  display_name: string;
  username: string | null;
  remaining_lives: number;
  lives_spent: number;
  total_picks: number;
  alive: boolean;
  last_pick_team_name: string | null;
  current_pick: SurvivorPick | null;
  picks: SurvivorPick[];
}

export interface SurvivorSeasonSummary {
  season_id: string;
  season_name: string;
  competition_id: string | null;
  competition_name: string | null;
  survivor_enabled: boolean;
  survivor_name: string;
  survivor_max_lives: number;
  registration_lock_at: string | null;
  registration_open: boolean;
  total_entries: number;
}

export interface SurvivorBoard {
  season: SurvivorSeasonSummary;
  current_matchday: SurvivorCurrentMatchday | null;
  my_membership: SurvivorMembership | null;
  my_picks: SurvivorPick[];
  available_teams: SurvivorAvailableTeam[];
  leaderboard: SurvivorLeaderboardEntry[];
}

export interface UserSeasonMembership {
  season_id: string;
  season_name: string;
  competition_id: string | null;
  competition_name: string | null;
  is_active: boolean;
  is_rejected: boolean;
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
  username: string | null;
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

export interface DashboardHomeBundle {
  summary: DashboardSummary;
  advanced_stats: AdvancedStats;
  performance_race: PerformanceRace;
  matchday_points: MyMatchdayPointsEntry[];
  personal_trophies: PersonalTrophyRecord[];
  vip_competitions: VipCompetition[];
  leaderboard: LeaderboardEntry[];
  matches: Match[];
  pick_results: PickResultRow[];
}

export interface LiveLeaderboardEntry {
  profile_id: string;
  display_name: string;
  username: string | null;
  role_code: string;
  total_points: number;
  correct_results: number;
  exact_scores: number;
  rank_position: number;
  official_rank_position: number | null;
  official_total_points: number;
  live_matchday_points: number;
  points_delta: number;
  rank_delta: number;
}

export interface LiveMatchScore {
  match_id: string;
  matchday_id: string;
  matchday_name: string;
  kickoff_at: string;
  match_status: string;
  home_team_name: string;
  home_team_crest_url: string | null;
  away_team_name: string;
  away_team_crest_url: string | null;
  home_score: number | null;
  away_score: number | null;
  is_official: boolean;
  updated_at: string | null;
}

export interface LiveLeaderboardResponse {
  enabled: boolean;
  season_id: string | null;
  season_name: string | null;
  matchday_id: string | null;
  matchday_name: string | null;
  is_official: boolean;
  refresh_interval_seconds: number;
  updated_at: string | null;
  leaderboard: LiveLeaderboardEntry[];
  matches: LiveMatchScore[];
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
  season_id: string | null;
  season_name: string | null;
  page_kind: "regular" | "survivor";
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
  structure_format: CompetitionStructureFormat;
  structure_config: CompetitionStructureConfig;
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
  structure_format: CompetitionStructureFormat;
  structure_config: CompetitionStructureConfig;
  visibility_status: SeasonVisibilityStatus;
  live_dashboard_enabled: boolean;
  is_active: boolean;
  registration_closed: boolean;
  survivor_enabled: boolean;
  survivor_name: string | null;
  survivor_max_lives: number;
  survivor_registration_closed: boolean;
  survivor_registration_lock_at: string | null;
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
  competition_ids: string[];
  competition_names: string[];
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

export interface TeamBulkImportRow {
  row_number: number;
  slug: string | null;
  name: string | null;
  status: "created" | "updated" | "failed";
  detail: string | null;
}

export interface TeamBulkImportResult {
  created: number;
  updated: number;
  failed: number;
  rows: TeamBulkImportRow[];
}

export interface TeamPaletteRefreshResult {
  processed: number;
  updated: number;
  failed: number;
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

export interface AdminNflSpreadRow {
  match_id: string;
  matchday_id: string;
  matchday_number: number;
  matchday_name: string;
  kickoff_at: string;
  picks_lock_at: string;
  home_team_name: string;
  away_team_name: string;
  spread_home_line: string | null;
  spread_away_line: string | null;
  provider_name: string | null;
  published_at: string | null;
  pick_count: number;
  is_frozen: boolean;
}

export interface AdvancedStatsPullResult {
  status: string;
  count: number;
  snapshot_id: string | null;
  matches_saved: number | null;
  recommendations_saved: number | null;
  output_path: string;
  pull_output: string;
}

export interface OddsUnmatchedTeam {
  raw_team_name: string;
  raw_team_code: string | null;
  side: string;
  team_exists: boolean;
}

export interface OddsUnmatchedMatch {
  snapshot_date: string;
  match_date: string;
  home_team: string;
  home_code: string | null;
  away_team: string;
  away_code: string | null;
  source_match_key: string | null;
  missing: OddsUnmatchedTeam[];
}

export interface OddsUnmatchedResponse {
  sport_key: string;
  snapshot_date: string | null;
  unmatched_count: number;
  matches: OddsUnmatchedMatch[];
}

export interface AdminSettings {
  active_season_id: string | null;
  selected_season_id: string | null;
  selected_season_name: string | null;
  selected_tournament_format: TournamentFormat | null;
  prize_scope: "season" | "survivor";
  app_icon_url: string | null;
  show_live_tab: boolean;
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
  commission_recipient_profile_id: string | null;
  commission_allocations: CommissionAllocation[];
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
  is_rejected: boolean;
  is_paid: boolean;
  eligible_for_scoring: boolean;
  eligible_locked_at: string | null;
  activated_at: string | null;
  notes: string | null;
}

export interface AdminUserSurvivorMembership {
  season_id: string;
  season_name: string;
  is_active: boolean;
  is_rejected: boolean;
  is_paid: boolean;
  joined_at: string | null;
}

export interface MembershipHistoryEntry {
  id: string;
  membership_type: "quiniela" | "survivor" | "vip";
  name: string;
  season_name: string;
  status: string;
  is_paid: boolean | null;
  joined_at: string | null;
  season_visibility_status: string | null;
}

export interface AdminUser {
  id: string;
  auth_user_id: string;
  email: string | null;
  display_name: string;
  username: string | null;
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
  selected_survivor_membership: AdminUserSurvivorMembership | null;
  season_memberships: AdminUserSeasonMembership[];
  survivor_memberships: AdminUserSurvivorMembership[];
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
  home_penalty_score: number | null;
  away_penalty_score: number | null;
  advancing_team_id: string | null;
  is_official: boolean;
  is_ready_for_picks: boolean;
  is_published: boolean;
  source_provider_name: string | null;
  is_manual_override: boolean;
}

export interface AdminLiveScoreRow {
  match_id: string;
  matchday_id: string;
  kickoff_at: string;
  match_status: MatchStatus;
  home_team_name: string;
  away_team_name: string;
  live_home_score: number | null;
  live_away_score: number | null;
  official_home_score: number | null;
  official_away_score: number | null;
  official_is_official: boolean;
  updated_at: string | null;
}
