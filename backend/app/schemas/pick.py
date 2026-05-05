from datetime import datetime

from pydantic import BaseModel, Field, field_serializer, model_validator

from app.core.datetime import ensure_utc
from app.models.entities import PickSelection


class PickBase(BaseModel):
    selection: PickSelection
    predicted_home_score: int = Field(ge=0)
    predicted_away_score: int = Field(ge=0)

    @model_validator(mode="after")
    def validate_score_against_selection(self) -> "PickBase":
        if self.selection == PickSelection.DRAW and self.predicted_home_score != self.predicted_away_score:
            raise ValueError("Draw picks require equal scores")
        if self.selection == PickSelection.HOME and self.predicted_home_score <= self.predicted_away_score:
            raise ValueError("Home picks require home score greater than away score")
        if self.selection == PickSelection.AWAY and self.predicted_home_score >= self.predicted_away_score:
            raise ValueError("Away picks require away score greater than home score")
        return self


class PickCreate(PickBase):
    match_id: str


class PickUpdate(PickBase):
    pass


class PickOut(BaseModel):
    id: str
    profile_id: str
    match_id: str
    matchday_id: str
    selection: PickSelection
    predicted_home_score: int
    predicted_away_score: int
    home_team_name: str
    away_team_name: str
    kickoff_at: datetime
    is_locked: bool
    is_admin_override: bool = False
    admin_override_note: str | None = None
    overridden_by_profile_id: str | None = None
    overridden_by_display_name: str | None = None
    overridden_at: datetime | None = None
    created_at: datetime
    updated_at: datetime

    @field_serializer("kickoff_at", "created_at", "updated_at", "overridden_at")
    def serialize_datetimes(self, value: datetime | None) -> str | None:
        if value is None:
            return None
        return ensure_utc(value).isoformat().replace("+00:00", "Z")


class PickResultRowOut(BaseModel):
    match_id: str
    matchday_id: str
    home_team_name: str
    home_team_crest_url: str | None
    away_team_name: str
    away_team_crest_url: str | None
    kickoff_at: datetime
    match_status: str
    has_pick: bool
    selection: PickSelection | None
    predicted_home_score: int | None
    predicted_away_score: int | None
    home_score: int | None
    away_score: int | None
    is_official: bool
    is_admin_override: bool = False
    admin_override_note: str | None = None
    overridden_by_display_name: str | None = None
    overridden_at: datetime | None = None
    result_points: int
    exact_score_points: int
    total_points: int

    @field_serializer("kickoff_at", "overridden_at")
    def serialize_kickoff(self, value: datetime | None) -> str | None:
        if value is None:
            return None
        return ensure_utc(value).isoformat().replace("+00:00", "Z")


class GlobalPickPlayerOut(BaseModel):
    profile_id: str
    display_name: str


class GlobalPickMatchOut(BaseModel):
    match_id: str
    home_team_name: str
    home_team_crest_url: str | None
    away_team_name: str
    away_team_crest_url: str | None
    kickoff_at: datetime
    is_locked: bool

    @field_serializer("kickoff_at")
    def serialize_match_kickoff(self, value: datetime) -> str:
        return ensure_utc(value).isoformat().replace("+00:00", "Z")


class GlobalPickCellOut(BaseModel):
    profile_id: str
    match_id: str
    has_pick: bool
    is_revealed: bool
    selection: PickSelection | None
    predicted_home_score: int | None
    predicted_away_score: int | None


class GlobalPickBoardOut(BaseModel):
    matchday_id: str
    players: list[GlobalPickPlayerOut]
    matches: list[GlobalPickMatchOut]
    cells: list[GlobalPickCellOut]
