from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import get_current_profile
from app.core.database import get_db
from app.models.entities import Profile
from app.schemas.leaderboard import HallOfFameResponse, LeaderboardEntry, MyMatchdayPointsEntry, PerformanceRaceResponse
from app.services.leaderboard_service import LeaderboardService

router = APIRouter()
service = LeaderboardService()


@router.get("/leaderboard", response_model=list[LeaderboardEntry])
def get_leaderboard(
    season_id: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> list[LeaderboardEntry]:
    return service.list_overall(db, season_id=season_id)


@router.get("/leaderboard/overall", response_model=list[LeaderboardEntry])
def get_overall_leaderboard(
    season_id: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> list[LeaderboardEntry]:
    return service.list_overall(db, season_id=season_id)


@router.get("/leaderboard/matchday/{matchday_id}", response_model=list[LeaderboardEntry])
def get_matchday_leaderboard(
    matchday_id: str,
    db: Session = Depends(get_db),
) -> list[LeaderboardEntry]:
    return service.list_matchday(db, matchday_id)


@router.get("/leaderboard/my-matchdays", response_model=list[MyMatchdayPointsEntry])
def get_my_matchday_points(
    season_id: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_profile: Profile = Depends(get_current_profile),
) -> list[MyMatchdayPointsEntry]:
    return service.list_profile_matchdays(db, current_profile, season_id=season_id)


@router.get("/leaderboard/my-race", response_model=PerformanceRaceResponse)
def get_my_performance_race(
    season_id: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_profile: Profile = Depends(get_current_profile),
) -> PerformanceRaceResponse:
    return service.get_performance_race(db, current_profile, season_id=season_id)


@router.get("/leaderboard/hall-of-fame", response_model=HallOfFameResponse)
def get_hall_of_fame(
    db: Session = Depends(get_db),
) -> HallOfFameResponse:
    return service.get_hall_of_fame(db)
