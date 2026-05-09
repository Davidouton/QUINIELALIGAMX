from datetime import datetime

from pydantic import BaseModel, field_serializer

from app.core.datetime import ensure_utc
from app.models.entities import MatchStageType, MatchStatus


class MatchOut(BaseModel):
    id: str
    matchday_id: str
    external_id: str | None
    match_key: str
    home_team_id: str | None = None
    away_team_id: str | None = None
    stage_type: MatchStageType = MatchStageType.REGULAR
    group_label: str | None = None
    bracket_slot: str | None = None
    home_placeholder: str | None = None
    away_placeholder: str | None = None
    home_team_name: str
    away_team_name: str
    kickoff_at: datetime
    picks_lock_at: datetime
    status: MatchStatus
    venue: str | None
    is_locked: bool
    is_ready_for_picks: bool = True
    odds_provider_name: str | None = None
    home_win_probability: float | None = None
    draw_probability: float | None = None
    away_win_probability: float | None = None

    @field_serializer("kickoff_at", "picks_lock_at")
    def serialize_datetimes(self, value: datetime) -> str:
        return ensure_utc(value).isoformat().replace("+00:00", "Z")
