from pydantic import BaseModel, Field

from app.schemas.leaderboard import LeaderboardEntry, MyMatchdayPointsEntry, PerformanceRaceResponse
from app.schemas.match import MatchOut
from app.schemas.pick import PickResultRowOut
from app.schemas.profile import AdvancedStatsResponse, DashboardSummaryResponse, PersonalTrophyOut
from app.schemas.vip import VipCompetitionOut


class DashboardHomeOut(BaseModel):
    summary: DashboardSummaryResponse = Field(default_factory=DashboardSummaryResponse)
    advanced_stats: AdvancedStatsResponse = Field(default_factory=AdvancedStatsResponse)
    performance_race: PerformanceRaceResponse = Field(default_factory=PerformanceRaceResponse)
    matchday_points: list[MyMatchdayPointsEntry] = Field(default_factory=list)
    personal_trophies: list[PersonalTrophyOut] = Field(default_factory=list)
    vip_competitions: list[VipCompetitionOut] = Field(default_factory=list)
    leaderboard: list[LeaderboardEntry] = Field(default_factory=list)
    matches: list[MatchOut] = Field(default_factory=list)
    pick_results: list[PickResultRowOut] = Field(default_factory=list)
