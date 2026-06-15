from datetime import datetime

from pydantic import BaseModel, field_serializer

from app.core.datetime import ensure_utc
from app.models.entities import MatchStageType


class WorldCupGroupStandingOut(BaseModel):
    team_id: str
    team_name: str
    team_short_name: str
    team_crest_url: str | None = None
    played: int = 0
    wins: int = 0
    draws: int = 0
    losses: int = 0
    goals_for: int = 0
    goals_against: int = 0
    goal_difference: int = 0
    points: int = 0


class WorldCupGroupOut(BaseModel):
    group_label: str
    standings: list[WorldCupGroupStandingOut] = []


class WorldCupBracketMatchOut(BaseModel):
    match_id: str
    matchday_id: str
    stage_type: MatchStageType
    bracket_slot: str | None = None
    home_team_id: str | None = None
    home_placeholder: str | None = None
    home_team_name: str
    home_team_short_name: str
    home_team_crest_url: str | None = None
    away_team_id: str | None = None
    away_placeholder: str | None = None
    away_team_name: str
    away_team_short_name: str
    away_team_crest_url: str | None = None
    kickoff_at: datetime
    home_score: int | None = None
    away_score: int | None = None
    advancing_team_id: str | None = None
    is_official: bool = False
    is_ready_for_picks: bool = True

    @field_serializer("kickoff_at")
    def serialize_kickoff(self, value: datetime) -> str:
        return ensure_utc(value).isoformat().replace("+00:00", "Z")


class WorldCupOfficialResultOut(BaseModel):
    match_id: str
    matchday_id: str
    matchday_number: int
    matchday_name: str
    stage_type: MatchStageType
    group_label: str | None = None
    bracket_slot: str | None = None
    home_team_id: str | None = None
    home_placeholder: str | None = None
    home_team_name: str
    home_team_short_name: str
    home_team_crest_url: str | None = None
    away_team_id: str | None = None
    away_placeholder: str | None = None
    away_team_name: str
    away_team_short_name: str
    away_team_crest_url: str | None = None
    kickoff_at: datetime
    home_score: int | None = None
    away_score: int | None = None
    advancing_team_id: str | None = None
    is_official: bool = False

    @field_serializer("kickoff_at")
    def serialize_kickoff(self, value: datetime) -> str:
        return ensure_utc(value).isoformat().replace("+00:00", "Z")


class WorldCupBoardOut(BaseModel):
    season_id: str
    season_name: str
    groups: list[WorldCupGroupOut] = []
    official_results: list[WorldCupOfficialResultOut] = []
    round_of_32: list[WorldCupBracketMatchOut] = []
    round_of_16: list[WorldCupBracketMatchOut] = []
    quarterfinals: list[WorldCupBracketMatchOut] = []
    semifinals: list[WorldCupBracketMatchOut] = []
    third_place: list[WorldCupBracketMatchOut] = []
    final: list[WorldCupBracketMatchOut] = []


class WorldCupNewsArticleOut(BaseModel):
    id: str
    category: str
    source: str
    title: str
    summary: str | None = None
    url: str
    published_at: datetime | None = None

    @field_serializer("published_at")
    def serialize_published_at(self, value: datetime | None) -> str | None:
        if value is None:
            return None
        return ensure_utc(value).isoformat().replace("+00:00", "Z")


class WorldCupNewsFeedOut(BaseModel):
    category: str
    articles: list[WorldCupNewsArticleOut] = []


class WorldCupAdminGroupTeamOut(BaseModel):
    team_id: str
    team_name: str
    team_short_name: str
    team_crest_url: str | None = None


class WorldCupAdminGroupOut(BaseModel):
    id: str
    season_id: str
    group_label: str
    display_name: str | None = None
    sort_order: int = 100
    teams: list[WorldCupAdminGroupTeamOut] = []


class WorldCupAdminGroupUpsertRequest(BaseModel):
    season_id: str
    group_label: str
    display_name: str | None = None
    sort_order: int = 100


class WorldCupAdminGroupTeamsUpdateRequest(BaseModel):
    team_ids: list[str]
