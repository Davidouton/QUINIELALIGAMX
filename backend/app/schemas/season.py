from datetime import datetime

from pydantic import BaseModel, field_serializer

from app.core.datetime import ensure_utc
from app.models.entities import TournamentFormat


class SeasonOut(BaseModel):
    id: str
    name: str
    slug: str
    competition_id: str | None = None
    competition_name: str | None = None
    competition_sport_name: str | None = None
    tournament_format: TournamentFormat = TournamentFormat.STANDARD
    is_active: bool
    start_matchday_id: str | None = None
    end_matchday_id: str | None = None
    participants_lock_at: datetime | None = None
    created_at: datetime
    updated_at: datetime

    @field_serializer("participants_lock_at", "created_at", "updated_at")
    def serialize_datetimes(self, value: datetime | None) -> str | None:
        if value is None:
            return None
        return ensure_utc(value).isoformat().replace("+00:00", "Z")
