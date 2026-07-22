from datetime import datetime

from pydantic import BaseModel, field_serializer

from app.core.datetime import ensure_utc


class LeaderboardEntry(BaseModel):
    profile_id: str
    display_name: str
    username: str | None = None
    role_code: str
    total_points: int
    correct_results: int
    exact_scores: int
    rank_position: int


class MyMatchdayPointsEntry(BaseModel):
    matchday_id: str
    season_id: str
    matchday_number: int
    matchday_name: str
    total_points: int
    correct_results: int
    exact_scores: int
    rank_position: int | None
    cumulative_points: int
    weekly_prize_amount: float = 0


class WeeklyPrizeWinner(BaseModel):
    profile_id: str
    display_name: str
    username: str | None = None
    rank_position: int
    total_points: int
    exact_scores: int
    prize_amount: float


class WeeklyPrizeMatchday(BaseModel):
    matchday_id: str
    matchday_number: int
    matchday_name: str
    total_prize_amount: float
    winners: list[WeeklyPrizeWinner] = []


class PerformanceRacePoint(BaseModel):
    matchday_id: str
    matchday_number: int
    matchday_name: str
    user_cumulative_points: float
    leader_cumulative_points: float = 0
    first_place_cumulative_points: float
    third_place_cumulative_points: float


class PerformanceRaceResponse(BaseModel):
    season_id: str | None = None
    season_name: str | None = None
    leader_profile_id: str | None = None
    leader_name: str | None = None
    tournament_matchdays: int = 0
    completed_matchdays: int = 0
    projected_user_total: float = 0
    projected_leader_total: float = 0
    projected_first_place_total: float = 0
    projected_third_place_total: float = 0
    points: list[PerformanceRacePoint] = []


class HallOfFameEntry(BaseModel):
    profile_id: str
    display_name: str
    value: int
    detail: str | None = None
    place_label: str | None = None
    image_url: str | None = None


class HallOfFameTournamentPodium(BaseModel):
    tournament_name: str
    entries: list[HallOfFameEntry] = []


class HallOfFameResponse(BaseModel):
    podium_tournament_name: str | None = None
    podium: list[HallOfFameEntry] = []
    podium_tournaments: list[str] = []
    podiums_by_tournament: list[HallOfFameTournamentPodium] = []
    champions: list[HallOfFameEntry] = []
    points: list[HallOfFameEntry] = []
    weekly_wins: list[HallOfFameEntry] = []
    exact_scores: list[HallOfFameEntry] = []


class LiveLeaderboardEntry(BaseModel):
    profile_id: str
    display_name: str
    username: str | None = None
    role_code: str
    total_points: int
    correct_results: int
    exact_scores: int
    rank_position: int
    official_rank_position: int | None = None
    official_total_points: int = 0
    live_matchday_points: int = 0
    points_delta: int = 0
    rank_delta: int = 0


class LiveMatchScoreOut(BaseModel):
    match_id: str
    matchday_id: str
    matchday_name: str
    kickoff_at: datetime
    match_status: str
    home_team_name: str
    home_team_crest_url: str | None = None
    away_team_name: str
    away_team_crest_url: str | None = None
    home_score: int | None = None
    away_score: int | None = None
    is_official: bool = False
    updated_at: datetime | None = None

    @field_serializer("kickoff_at", "updated_at")
    def serialize_datetimes(self, value: datetime | None) -> str | None:
        if value is None:
            return None
        return ensure_utc(value).isoformat().replace("+00:00", "Z")


class LiveLeaderboardResponse(BaseModel):
    enabled: bool = False
    season_id: str | None = None
    season_name: str | None = None
    matchday_id: str | None = None
    matchday_name: str | None = None
    is_official: bool = False
    refresh_interval_seconds: int = 20
    updated_at: datetime | None = None
    leaderboard: list[LiveLeaderboardEntry] = []
    matches: list[LiveMatchScoreOut] = []

    @field_serializer("updated_at")
    def serialize_updated_at(self, value: datetime | None) -> str | None:
        if value is None:
            return None
        return ensure_utc(value).isoformat().replace("+00:00", "Z")
