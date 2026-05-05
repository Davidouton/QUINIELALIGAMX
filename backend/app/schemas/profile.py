from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.models.entities import RoleCode


class ProfileOut(BaseModel):
    id: str
    auth_user_id: str
    email: str | None
    display_name: str
    role_code: RoleCode
    is_active: bool
    created_at: datetime


class MeResponse(ProfileOut):
    favorite_team_id: str | None = None
    contact_phone: str | None = None
    bank_name: str | None = None
    deposit_account: str | None = None
    modality: Literal["pre_pago", "aval"] = "pre_pago"
    aval_profile_id: str | None = None
    theme_preference: str = "standard"
    pick_reminder_email_enabled: bool = False
    pick_reminder_opening_enabled: bool = False
    pick_reminder_hours_before: Literal[1, 3] | None = None
    active_season_id: str | None = None
    active_season_name: str | None = None
    can_participate_active_season: bool = False
    is_paid_active_season: bool = False


class RegisteredUserOption(BaseModel):
    id: str
    display_name: str


class PrizeSummaryResponse(BaseModel):
    season_id: str | None = None
    season_name: str | None = None
    confirmed_participants: int = 0
    entry_fee_amount: float = 0
    gross_pool_amount: float = 0
    admin_commission_pct: float = 0
    admin_commission_amount: float = 0
    reserve_pct: float = 0
    reserve_amount: float = 0
    income_after_commission_amount: float = 0
    net_income_amount: float = 0
    weekly_first_place_amount: float = 0
    weekly_second_place_amount: float = 0
    weekly_third_place_amount: float = 0
    weekly_total_prize_amount: float = 0
    tournament_matchdays_count: int = 0
    total_weekly_prizes_amount: float = 0
    distributable_prize_pool_amount: float = 0
    first_place_pct: float = 0
    first_place_amount: float = 0
    second_place_pct: float = 0
    second_place_amount: float = 0
    third_place_pct: float = 0
    third_place_amount: float = 0


class DashboardSummaryResponse(BaseModel):
    season_id: str | None = None
    season_name: str | None = None
    total_points: int = 0
    overall_rank: int | None = None
    weekly_prizes_count: int = 0
    average_points_per_matchday: float = 0
    projected_total_points: float = 0
    projected_rank: int | None = None
    tournament_matchdays: int = 0
    completed_matchdays: int = 0
    remaining_matchdays: int = 0


class AdvancedStatsResponse(BaseModel):
    season_id: str | None = None
    season_name: str | None = None
    graded_picks: int = 0
    best_matchday_name: str | None = None
    best_matchday_points: int = 0
    home_bets: int = 0
    draw_bets: int = 0
    away_bets: int = 0
    max_hit_points: int = 0
    result_hit_points: int = 0
    exact_hits: int = 0
    result_hits: int = 0
    overall_effectiveness_pct: float = 0
    home_effectiveness_pct: float = 0
    draw_effectiveness_pct: float = 0
    away_effectiveness_pct: float = 0
    home_points: int = 0
    draw_points: int = 0
    away_points: int = 0


class PersonalTrophyOut(BaseModel):
    id: str
    tournament_name: str
    place_label: str
    recognition_type: Literal["trophy", "award"] = "trophy"
    trophy_name: str | None = None
    image_url: str | None = None
    total_points: int = 0


class MeUpdateRequest(BaseModel):
    display_name: str = Field(min_length=1, max_length=120)
    email: str | None = Field(default=None, max_length=255)
    favorite_team_id: str | None = None
    contact_phone: str | None = Field(default=None, max_length=32)
    bank_name: str | None = Field(default=None, max_length=120)
    deposit_account: str | None = Field(default=None, max_length=160)
    modality: Literal["pre_pago", "aval"] = "pre_pago"
    aval_profile_id: str | None = None
    theme_preference: Literal["standard", "favorite_team"] = "standard"
    pick_reminder_email_enabled: bool = False
    pick_reminder_opening_enabled: bool = False
    pick_reminder_hours_before: Literal[1, 3] | None = None
