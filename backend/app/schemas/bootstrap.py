from pydantic import BaseModel, Field

from app.schemas.matchday import MatchdayOut
from app.schemas.profile import MeResponse
from app.schemas.season import SeasonOut
from app.schemas.team import TeamOut


class AppBootstrapOut(BaseModel):
    me: MeResponse
    seasons: list[SeasonOut] = Field(default_factory=list)
    matchdays: list[MatchdayOut] = Field(default_factory=list)
    active_matchdays: list[MatchdayOut] = Field(default_factory=list)
    teams: list[TeamOut] = Field(default_factory=list)
