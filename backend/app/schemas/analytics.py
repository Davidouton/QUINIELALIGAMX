from datetime import datetime

from pydantic import BaseModel, Field, field_validator


def _normalize_optional_text(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    return normalized or None


class AnalyticsEventIn(BaseModel):
    category: str = Field(min_length=1, max_length=40)
    event_name: str = Field(min_length=1, max_length=80)
    route_path: str | None = Field(default=None, max_length=255)
    screen_name: str | None = Field(default=None, max_length=120)
    season_id: str | None = None
    matchday_id: str | None = None
    competition_id: str | None = None
    success: bool | None = None
    duration_ms: int | None = Field(default=None, ge=0, le=300000)
    metadata: dict[str, str | int | float | bool | None] | None = None

    @field_validator("category", "event_name")
    @classmethod
    def normalize_required_text(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Value cannot be empty")
        return normalized

    @field_validator("route_path", "screen_name", "season_id", "matchday_id", "competition_id")
    @classmethod
    def normalize_optional_text(cls, value: str | None) -> str | None:
        return _normalize_optional_text(value)


class AnalyticsAckOut(BaseModel):
    status: str = "ok"


class AnalyticsKpiOut(BaseModel):
    total_events: int
    unique_users: int
    screen_views: int
    action_events: int
    failure_events: int
    avg_screen_load_ms: float | None = None


class AnalyticsScreenStatOut(BaseModel):
    screen_name: str
    route_path: str | None = None
    views: int
    unique_users: int
    avg_load_ms: float | None = None
    failures: int


class AnalyticsEventStatOut(BaseModel):
    category: str
    event_name: str
    count: int
    unique_users: int


class AnalyticsDailyStatOut(BaseModel):
    day: str
    screen_views: int
    action_events: int
    failure_events: int
    unique_users: int


class AnalyticsRecentEventOut(BaseModel):
    id: str
    created_at: datetime
    profile_id: str | None = None
    display_name: str | None = None
    category: str
    event_name: str
    route_path: str | None = None
    screen_name: str | None = None
    success: bool | None = None
    duration_ms: int | None = None


class AnalyticsUserStatOut(BaseModel):
    profile_id: str
    display_name: str
    screen_views: int
    action_events: int
    failure_events: int
    avg_load_ms: float | None = None
    last_seen_at: datetime | None = None


class AdminAnalyticsStatsOut(BaseModel):
    window_days: int
    generated_at: datetime
    selected_profile_id: str | None = None
    selected_profile_display_name: str | None = None
    kpis: AnalyticsKpiOut
    users: list[AnalyticsUserStatOut]
    screens: list[AnalyticsScreenStatOut]
    top_events: list[AnalyticsEventStatOut]
    daily: list[AnalyticsDailyStatOut]
    recent_events: list[AnalyticsRecentEventOut]
