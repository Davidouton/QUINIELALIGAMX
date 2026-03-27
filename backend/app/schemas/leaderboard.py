from pydantic import BaseModel


class LeaderboardEntry(BaseModel):
    profile_id: str
    display_name: str
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
