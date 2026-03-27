from datetime import datetime

from pydantic import BaseModel, field_serializer

from app.core.datetime import ensure_utc
from app.models.entities import MatchdayStatus


class MatchdayOut(BaseModel):
    id: str
    season_id: str
    number: int
    name: str
    default_lock_offset_minutes: int
    picks_reopened_override: bool
    status: MatchdayStatus
    starts_at: datetime
    ends_at: datetime

    @field_serializer("starts_at", "ends_at")
    def serialize_datetimes(self, value: datetime) -> str:
        return ensure_utc(value).isoformat().replace("+00:00", "Z")
