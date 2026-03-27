from datetime import datetime

from pydantic import BaseModel


class TeamOut(BaseModel):
    id: str
    external_id: str | None
    name: str
    short_name: str
    slug: str
    crest_url: str | None
    home_venue: str | None
    primary_color: str | None
    secondary_color: str | None
    accent_color: str | None
    created_at: datetime
    updated_at: datetime
