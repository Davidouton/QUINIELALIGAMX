from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field, field_serializer

from app.core.datetime import ensure_utc
from app.models.entities import CompetitionStructureFormat, SeasonVisibilityStatus, TournamentFormat


class SeasonOut(BaseModel):
    id: str
    name: str
    description: str | None = None
    slug: str
    competition_id: str | None = None
    competition_name: str | None = None
    competition_sport_name: str | None = None
    tournament_format: TournamentFormat = TournamentFormat.STANDARD
    structure_format: CompetitionStructureFormat = CompetitionStructureFormat.LEAGUE_TABLE
    structure_config: dict[str, Any] = Field(default_factory=dict)
    visibility_status: SeasonVisibilityStatus = SeasonVisibilityStatus.LIVE
    live_dashboard_enabled: bool = False
    is_active: bool
    registration_closed: bool = False
    dashboard_enrollment_enabled: bool = False
    survivor_enabled: bool = False
    survivor_name: str | None = None
    survivor_description: str | None = None
    survivor_max_lives: int = 1
    survivor_registration_closed: bool = False
    survivor_dashboard_enrollment_enabled: bool = False
    survivor_registration_lock_at: datetime | None = None
    start_matchday_id: str | None = None
    end_matchday_id: str | None = None
    participants_lock_at: datetime | None = None
    created_at: datetime
    updated_at: datetime

    @field_serializer("survivor_registration_lock_at", "participants_lock_at", "created_at", "updated_at")
    def serialize_datetimes(self, value: datetime | None) -> str | None:
        if value is None:
            return None
        return ensure_utc(value).isoformat().replace("+00:00", "Z")
