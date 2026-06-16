from datetime import datetime
from typing import Literal

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
    total_picks: int
    selection_distribution: QuinielaPlusUserSelectionDistributionOut
    score_distribution: list[QuinielaPlusScoreDistributionOut] = []


class QuinielaPlusUserDistributionOut(BaseModel):
    title: str = "Distribucion de usuarios"
    matches: list[QuinielaPlusUserDistributionMatchOut] = []


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
