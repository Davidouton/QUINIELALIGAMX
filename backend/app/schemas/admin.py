from datetime import datetime

from pydantic import BaseModel, Field, field_validator

from app.core.datetime import mexico_city_to_utc
from app.models.entities import MatchStatus, MatchdayStatus, RoleCode


class RoleUpdateRequest(BaseModel):
    role_code: RoleCode


class UserAccessUpdateRequest(BaseModel):
    is_active: bool


class UserSeasonMembershipUpdateRequest(BaseModel):
    season_id: str
    is_active: bool = False
    is_paid: bool = False
    notes: str | None = None


class SyncResponse(BaseModel):
    provider_name: str
    resource_type: str
    records_processed: int
    status: str


class AdminResultRowOut(BaseModel):
    match_id: str
    matchday_id: str
    home_team_name: str
    away_team_name: str
    kickoff_at: datetime
    match_status: MatchStatus
    home_score: int | None = None
    away_score: int | None = None
    is_official: bool = False
    is_published: bool = False
    source_provider_name: str | None = None
    is_manual_override: bool = False


class AdminResultUpdateRequest(BaseModel):
    home_score: int = Field(ge=0)
    away_score: int = Field(ge=0)
    is_official: bool = True


class AdminSettingsOut(BaseModel):
    active_season_id: str | None = None
    start_matchday_id: str | None = None
    end_matchday_id: str | None = None
    participants_lock_at: datetime | None = None
    participants_locked: bool = False
    eligible_participants: int = 0
    confirmed_participants: int = 0
    entry_fee_amount: float = 0
    weekly_first_place_amount: float = 0
    weekly_second_place_amount: float = 0
    weekly_third_place_amount: float = 0
    weekly_total_prize_amount: float = 0
    tournament_matchdays_count: int = 0
    admin_commission_pct: float = 0
    reserve_pct: float = 0
    first_place_pct: float = 0
    second_place_pct: float = 0
    third_place_pct: float = 0
    gross_pool_amount: float = 0
    admin_commission_amount: float = 0
    income_after_commission_amount: float = 0
    total_weekly_prizes_amount: float = 0
    reserve_amount: float = 0
    distributable_prize_pool_amount: float = 0
    first_place_amount: float = 0
    second_place_amount: float = 0
    third_place_amount: float = 0
    result_correct_points: int
    exact_score_points: int
    evaluated_picks: int | None = None
    weekly_leaders: int | None = None


class AdminSettingsUpdateRequest(BaseModel):
    active_season_id: str
    start_matchday_id: str | None = None
    end_matchday_id: str | None = None
    entry_fee_amount: float = Field(default=0, ge=0, le=1000000)
    weekly_first_place_amount: float = Field(default=0, ge=0, le=1000000)
    weekly_second_place_amount: float = Field(default=0, ge=0, le=1000000)
    weekly_third_place_amount: float = Field(default=0, ge=0, le=1000000)
    admin_commission_pct: float = Field(default=0, ge=0, le=100)
    reserve_pct: float = Field(default=0, ge=0, le=100)
    first_place_pct: float = Field(default=0, ge=0, le=100)
    second_place_pct: float = Field(default=0, ge=0, le=100)
    third_place_pct: float = Field(default=0, ge=0, le=100)
    result_correct_points: int = Field(default=3, ge=0, le=100)
    exact_score_points: int = Field(default=2, ge=0, le=100)


class AdminUserSeasonMembershipOut(BaseModel):
    season_id: str
    season_name: str
    is_active: bool
    is_paid: bool
    eligible_for_scoring: bool = False
    eligible_locked_at: datetime | None = None
    activated_at: datetime | None = None
    notes: str | None = None


class AdminUserOut(BaseModel):
    id: str
    auth_user_id: str
    email: str | None
    display_name: str
    favorite_team_name: str | None = None
    contact_phone: str | None = None
    bank_name: str | None = None
    deposit_account: str | None = None
    modality: str = "pre_pago"
    aval_profile_id: str | None = None
    aval_display_name: str | None = None
    theme_preference: str = "standard"
    role_code: RoleCode
    is_active: bool
    created_at: datetime
    selected_season_membership: AdminUserSeasonMembershipOut | None = None


class OddsPreviewRow(BaseModel):
    match_date: str
    home_team: str
    away_team: str
    ml_home: str | None = None
    ml_draw: str | None = None
    ml_away: str | None = None


class OddsSnapshotOption(BaseModel):
    snapshot_date: str
    raw_rows_processed: int


class OddsPullResponse(BaseModel):
    status: str
    snapshot_date: str | None = None
    raw_rows_processed: int | None = None
    matched: int | None = None
    unmatched: int | None = None
    preview_rows: list[OddsPreviewRow] = []
    pull_output: str
    sync_output: str


class SeasonCreateRequest(BaseModel):
    name: str
    slug: str
    is_active: bool = False


class SeasonUpdateRequest(SeasonCreateRequest):
    pass


class TeamCreateRequest(BaseModel):
    name: str
    short_name: str = Field(min_length=2, max_length=16)
    slug: str
    external_id: str | None = None
    crest_url: str | None = None
    home_venue: str | None = None
    primary_color: str | None = None
    secondary_color: str | None = None
    accent_color: str | None = None


class TeamUpdateRequest(TeamCreateRequest):
    pass


class MatchdayCreateRequest(BaseModel):
    season_id: str
    number: int = Field(gt=0)
    name: str
    default_lock_offset_minutes: int = Field(default=10, ge=-1000000, le=1000000)
    status: MatchdayStatus = MatchdayStatus.DRAFT
    starts_at: datetime
    ends_at: datetime

    @field_validator("starts_at", "ends_at")
    @classmethod
    def normalize_matchday_datetimes(cls, value: datetime) -> datetime:
        return mexico_city_to_utc(value)


class MatchdayUpdateRequest(MatchdayCreateRequest):
    pass


class MatchCreateRequest(BaseModel):
    matchday_id: str
    home_team_id: str
    away_team_id: str
    kickoff_at: datetime
    picks_lock_at: datetime
    venue: str | None = None
    status: MatchStatus = MatchStatus.SCHEDULED
    external_id: str | None = None

    @field_validator("kickoff_at", "picks_lock_at")
    @classmethod
    def normalize_match_datetimes(cls, value: datetime) -> datetime:
        return mexico_city_to_utc(value)


class MatchUpdateRequest(MatchCreateRequest):
    pass


class HistoricalChampionOut(BaseModel):
    id: str
    tournament_name: str
    user_name: str
    awarded_profile_id: str | None = None
    place_label: str
    trophy_asset_id: str | None = None
    trophy_name: str | None = None
    image_url: str | None = None
    total_points: int
    created_at: datetime
    updated_at: datetime


class HistoricalChampionCreateRequest(BaseModel):
    tournament_name: str = Field(min_length=2, max_length=160)
    user_name: str = Field(min_length=2, max_length=160)
    awarded_profile_id: str | None = None
    place_label: str = Field(min_length=2, max_length=80)
    trophy_asset_id: str | None = None
    image_url: str | None = None
    total_points: int = Field(ge=0, le=10000)


class HistoricalChampionUpdateRequest(HistoricalChampionCreateRequest):
    pass


class TrophyAssetOut(BaseModel):
    id: str
    name: str
    category: str
    asset_code: str | None = None
    season_id: str | None = None
    matchday_number: int | None = None
    award_place_label: str | None = None
    image_url: str | None = None
    created_at: datetime
    updated_at: datetime


class TrophyAssetCreateRequest(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    category: str | None = Field(default=None, min_length=2, max_length=80)
    asset_code: str | None = Field(default=None, max_length=120)
    season_id: str | None = None
    matchday_number: int | None = Field(default=None, gt=0, le=99)
    award_place_label: str | None = Field(default=None, max_length=80)
    image_url: str | None = None


class TrophyAssetUpdateRequest(TrophyAssetCreateRequest):
    pass
