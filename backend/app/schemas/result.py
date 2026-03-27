from datetime import datetime

from pydantic import BaseModel, field_serializer

from app.core.datetime import ensure_utc


class ResultOut(BaseModel):
    match_id: str
    matchday_id: str
    home_team_name: str
    away_team_name: str
    home_score: int
    away_score: int
    is_official: bool


class PublishedResultOut(ResultOut):
    published_at: datetime

    @field_serializer("published_at")
    def serialize_datetime(self, value: datetime) -> str:
        return ensure_utc(value).isoformat().replace("+00:00", "Z")
