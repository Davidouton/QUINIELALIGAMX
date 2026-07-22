from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_serializer

from app.core.datetime import ensure_utc

SurvivorPickResultLiteral = Literal["pending", "won", "lost", "draw"]


class SurvivorSeasonSummaryOut(BaseModel):
    season_id: str
    season_name: str
    competition_id: str | None = None
    competition_name: str | None = None
    survivor_enabled: bool = False
    survivor_name: str
    survivor_max_lives: int = 1
    registration_lock_at: datetime | None = None
    registration_open: bool = True
    total_entries: int = 0

    @field_serializer("registration_lock_at")
    def serialize_registration_lock_at(self, value: datetime | None) -> str | None:
        if value is None:
            return None
        return ensure_utc(value).isoformat().replace("+00:00", "Z")


class SurvivorCurrentMatchdayOut(BaseModel):
    id: str
    number: int
    name: str
    starts_at: datetime
    ends_at: datetime

    @field_serializer("starts_at", "ends_at")
    def serialize_datetimes(self, value: datetime) -> str:
        return ensure_utc(value).isoformat().replace("+00:00", "Z")


class SurvivorAvailableTeamOut(BaseModel):
    team_id: str
    team_name: str
    team_short_name: str
    team_crest_url: str | None = None
    is_home_team: bool = False
    opponent_team_id: str | None = None
    opponent_team_name: str
    opponent_team_short_name: str
    opponent_team_crest_url: str | None = None
    match_id: str
    kickoff_at: datetime
    is_locked: bool = False
    already_used: bool = False
    is_current_pick: bool = False

    @field_serializer("kickoff_at")
    def serialize_kickoff_at(self, value: datetime) -> str:
        return ensure_utc(value).isoformat().replace("+00:00", "Z")


class SurvivorPickOut(BaseModel):
    id: str
    matchday_id: str
    matchday_number: int
    matchday_name: str
    match_id: str
    team_id: str
    team_name: str
    team_short_name: str
    team_crest_url: str | None = None
    opponent_team_name: str
    opponent_team_short_name: str
    opponent_team_crest_url: str | None = None
    kickoff_at: datetime
    is_locked: bool = False
    is_revealed: bool = False
    result_status: SurvivorPickResultLiteral = "pending"
    consumed_life: bool = False
    is_admin_override: bool = False
    admin_override_note: str | None = None
    result_override: SurvivorPickResultLiteral | None = None
    consumes_life_override: bool | None = None
    created_at: datetime
    updated_at: datetime

    @field_serializer("kickoff_at", "created_at", "updated_at")
    def serialize_datetimes(self, value: datetime) -> str:
        return ensure_utc(value).isoformat().replace("+00:00", "Z")


class SurvivorMembershipOut(BaseModel):
    season_id: str
    is_active: bool = False
    joined_at: datetime | None = None
    max_lives: int = 1
    remaining_lives: int = 1
    lives_spent: int = 0
    alive: bool = True
    used_team_ids: list[str] = Field(default_factory=list)
    used_team_names: list[str] = Field(default_factory=list)
    current_pick: SurvivorPickOut | None = None

    @field_serializer("joined_at")
    def serialize_joined_at(self, value: datetime | None) -> str | None:
        if value is None:
            return None
        return ensure_utc(value).isoformat().replace("+00:00", "Z")


class SurvivorLeaderboardEntryOut(BaseModel):
    profile_id: str
    display_name: str
    username: str | None = None
    remaining_lives: int = 0
    lives_spent: int = 0
    total_picks: int = 0
    alive: bool = False
    last_pick_team_name: str | None = None
    current_pick: SurvivorPickOut | None = None
    picks: list[SurvivorPickOut] = Field(default_factory=list)


class SurvivorBoardOut(BaseModel):
    season: SurvivorSeasonSummaryOut
    current_matchday: SurvivorCurrentMatchdayOut | None = None
    my_membership: SurvivorMembershipOut | None = None
    my_picks: list[SurvivorPickOut] = Field(default_factory=list)
    available_teams: list[SurvivorAvailableTeamOut] = Field(default_factory=list)
    leaderboard: list[SurvivorLeaderboardEntryOut] = Field(default_factory=list)


class SurvivorPickUpsertRequest(BaseModel):
    season_id: str
    matchday_id: str
    team_id: str


class AdminSurvivorPickOverrideRequest(BaseModel):
    season_id: str
    profile_id: str
    matchday_id: str
    team_id: str
    result_override: SurvivorPickResultLiteral | None = None
    consumes_life_override: bool | None = None
    admin_override_note: str = Field(min_length=1, max_length=500)


class AdminSurvivorPickRowOut(SurvivorPickOut):
    profile_id: str
    profile_display_name: str
    overridden_by_profile_id: str | None = None
    overridden_by_display_name: str | None = None
    overridden_at: datetime | None = None

    @field_serializer("overridden_at")
    def serialize_overridden_at(self, value: datetime | None) -> str | None:
        if value is None:
            return None
        return ensure_utc(value).isoformat().replace("+00:00", "Z")
