from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator

QuinielaPlusBillingPeriodLiteral = Literal["weekly", "monthly", "quarterly", "semiannual", "annual"]
QuinielaPlusMembershipStatusLiteral = Literal["active", "expired", "cancelled"]


class QuinielaPlusLeagueOut(BaseModel):
    id: str
    sport_name: str
    league_name: str
    slug: str
    is_active: bool
    sort_order: int
    created_at: datetime
    updated_at: datetime


class QuinielaPlusLeagueUpsertRequest(BaseModel):
    sport_name: str = Field(min_length=1, max_length=80)
    league_name: str = Field(min_length=1, max_length=120)
    slug: str = Field(min_length=1, max_length=120)
    is_active: bool = True
    sort_order: int = Field(default=100, ge=0, le=10_000)


class QuinielaPlusPlanOut(BaseModel):
    id: str
    name: str
    billing_period: QuinielaPlusBillingPeriodLiteral
    included_leagues_count: int | None = None
    includes_all_leagues: bool = False
    price_amount: float
    currency: str
    is_active: bool
    sort_order: int
    created_by_profile_id: str | None = None
    created_at: datetime
    updated_at: datetime


class QuinielaPlusPlanUpsertRequest(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    billing_period: QuinielaPlusBillingPeriodLiteral
    included_leagues_count: int | None = Field(default=None, ge=1, le=4)
    includes_all_leagues: bool = False
    price_amount: float = Field(gt=0, le=1_000_000)
    currency: str = Field(default="mxn", min_length=3, max_length=8)
    is_active: bool = True
    sort_order: int = Field(default=100, ge=0, le=10_000)

    @model_validator(mode="after")
    def validate_bundle_shape(self) -> "QuinielaPlusPlanUpsertRequest":
        if self.includes_all_leagues:
            if self.included_leagues_count is not None:
                raise ValueError("Los planes de todas las ligas no deben llevar included_leagues_count")
            return self
        if self.included_leagues_count is None:
            raise ValueError("Debes indicar cuantas ligas incluye el plan")
        return self


class QuinielaPlusMembershipLeagueOut(BaseModel):
    id: str
    sport_name: str
    league_name: str
    slug: str


class QuinielaPlusMembershipOut(BaseModel):
    id: str
    status: QuinielaPlusMembershipStatusLiteral
    starts_at: datetime
    ends_at: datetime
    created_at: datetime
    plan: QuinielaPlusPlanOut
    leagues: list[QuinielaPlusMembershipLeagueOut] = []


class QuinielaPlusCatalogResponse(BaseModel):
    checkout_enabled: bool = False
    checkout_message: str | None = None
    leagues: list[QuinielaPlusLeagueOut] = []
    plans: list[QuinielaPlusPlanOut] = []
    active_memberships: list[QuinielaPlusMembershipOut] = []


class QuinielaPlusOddsSneakPeekMatchOut(BaseModel):
    match_id: str
    matchday_id: str
    matchday_number: int
    matchday_name: str
    home_team_name: str
    home_team_short_name: str
    home_team_crest_url: str | None = None
    away_team_name: str
    away_team_short_name: str
    away_team_crest_url: str | None = None
    kickoff_at: datetime
    odds_provider_name: str
    home_win_probability: float
    draw_probability: float
    away_win_probability: float


class QuinielaPlusOddsSneakPeekOut(BaseModel):
    title: str = "Probabilidades sin vig"
    matches: list[QuinielaPlusOddsSneakPeekMatchOut] = []


class QuinielaPlusUserSelectionDistributionOut(BaseModel):
    home_count: int = 0
    draw_count: int = 0
    away_count: int = 0
    home_percentage: float = 0
    draw_percentage: float = 0
    away_percentage: float = 0


class QuinielaPlusScoreDistributionOut(BaseModel):
    score_label: str
    home_score: int
    away_score: int
    count: int
    percentage: float


class QuinielaPlusUserDistributionMatchOut(BaseModel):
    match_id: str
    matchday_id: str
    matchday_number: int
    matchday_name: str
    home_team_name: str
    home_team_short_name: str
    home_team_crest_url: str | None = None
    away_team_name: str
    away_team_short_name: str
    away_team_crest_url: str | None = None
    kickoff_at: datetime
    is_locked: bool
    total_picks: int
    selection_distribution: QuinielaPlusUserSelectionDistributionOut
    score_distribution: list[QuinielaPlusScoreDistributionOut] = []


class QuinielaPlusUserDistributionOut(BaseModel):
    title: str = "Distribucion de usuarios"
    matches: list[QuinielaPlusUserDistributionMatchOut] = []


class QuinielaPlusAdvancedStatsMatchOut(BaseModel):
    fixture_id: str
    date: str
    kickoff_at: datetime
    round: str | None = None
    group: str | None = None
    home: str
    away: str
    home_win_prob: float
    draw_prob: float
    away_win_prob: float
    xg_home: float
    xg_away: float
    most_likely_score: str
    most_likely_score_prob: float
    implied_odds_home: float
    implied_odds_draw: float
    implied_odds_away: float
    win_margin_implied: float | None = None
    btts_prob: float
    over_0_5_prob: float | None = None
    under_0_5_prob: float | None = None
    over_1_5_prob: float
    under_1_5_prob: float
    over_2_5_prob: float
    under_2_5_prob: float
    over_3_5_prob: float
    under_3_5_prob: float
    scoreline_probabilities: dict[str, float] = {}
    h2h: list[dict[str, Any]] = []
    home_form: list[dict[str, Any]] = []
    away_form: list[dict[str, Any]] = []
    home_stats: dict[str, Any] = {}
    away_stats: dict[str, Any] = {}


class QuinielaPlusAdvancedStatsOut(BaseModel):
    title: str = "Estadisticas avanzadas"
    generated_at: datetime | None = None
    matches: list[QuinielaPlusAdvancedStatsMatchOut] = []


class QuinielaPlusValueRecommendationOut(BaseModel):
    id: str
    fixture_id: str
    kickoff_at: datetime | None = None
    home: str
    away: str
    market_key: str
    selection_key: str
    line_value: float | None = None
    model_probability: float | None = None
    market_probability: float | None = None
    market_odds: float | None = None
    fair_odds_decimal: float | None = None
    edge_probability: float | None = None
    suggested_units: float = 0
    strategy_label: str = "no_bet"
    stake_reason: str | None = None
    outcome_status: str = "pending"
    is_hit: bool | None = None
    result_label: str | None = None
    profit_units: float | None = None
    confidence_label: str
    recommendation: str
    reason: str | None = None
    created_at: datetime


class QuinielaPlusValueTrackStatsOut(BaseModel):
    label: str
    total: int = 0
    open: int = 0
    wins: int = 0
    losses: int = 0
    pushes: int = 0
    tracked_bets: int = 0
    staked_units: float = 0
    profit_units: float = 0
    hit_rate: float | None = None
    roi: float | None = None


class QuinielaPlusValueLabOut(BaseModel):
    title: str = "Value Lab"
    generated_at: datetime | None = None
    track_stats: list[QuinielaPlusValueTrackStatsOut] = []
    recommendations: list[QuinielaPlusValueRecommendationOut] = []


class QuinielaPlusAdminSettingsOut(BaseModel):
    checkout_enabled: bool = False
    checkout_message: str | None = None


class QuinielaPlusAdminSettingsUpdateRequest(BaseModel):
    checkout_enabled: bool = False
    checkout_message: str | None = Field(default=None, max_length=500)


class QuinielaPlusAdminConsoleResponse(BaseModel):
    settings: QuinielaPlusAdminSettingsOut
    leagues: list[QuinielaPlusLeagueOut] = []
    plans: list[QuinielaPlusPlanOut] = []
