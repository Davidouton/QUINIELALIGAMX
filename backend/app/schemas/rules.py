from datetime import datetime

from pydantic import BaseModel, Field


class RulePageOut(BaseModel):
    id: str
    slug: str
    title: str
    content_markdown: str
    version_label: str | None = None
    created_at: datetime
    updated_at: datetime


class RulePageUpdateRequest(BaseModel):
    title: str = Field(default="Reglamento", min_length=2, max_length=160)
    content_markdown: str = Field(default="", max_length=50000)
    version_label: str | None = Field(default=None, max_length=60)
