from datetime import datetime

from pydantic import BaseModel, field_serializer

from app.core.datetime import ensure_utc


class CompetitionOut(BaseModel):
    id: str
    sport_name: str
    name: str
    slug: str
    provider_league_id: str | None = None
    is_active: bool = True
    sort_order: int = 100
    created_at: datetime
    updated_at: datetime

    @field_serializer("created_at", "updated_at")
    def serialize_datetimes(self, value: datetime) -> str:
        return ensure_utc(value).isoformat().replace("+00:00", "Z")
