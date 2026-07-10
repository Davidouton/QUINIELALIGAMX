from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import get_current_profile
from app.core.database import get_db
from app.models.entities import Profile
from app.schemas.survivor import SurvivorBoardOut, SurvivorPickUpsertRequest
from app.services.survivor_service import SurvivorService

router = APIRouter()
service = SurvivorService()


@router.get("/survivor/board", response_model=SurvivorBoardOut)
def get_survivor_board(
    season_id: str = Query(...),
    db: Session = Depends(get_db),
    current_profile: Profile = Depends(get_current_profile),
) -> SurvivorBoardOut:
    return service.get_board(db, season_id, current_profile)


@router.post("/survivor/seasons/{season_id}/join", response_model=SurvivorBoardOut)
def join_survivor_season(
    season_id: str,
    db: Session = Depends(get_db),
    current_profile: Profile = Depends(get_current_profile),
) -> SurvivorBoardOut:
    return service.join_season(db, season_id, current_profile)


@router.put("/survivor/picks", response_model=SurvivorBoardOut)
def upsert_survivor_pick(
    payload: SurvivorPickUpsertRequest,
    db: Session = Depends(get_db),
    current_profile: Profile = Depends(get_current_profile),
) -> SurvivorBoardOut:
    return service.upsert_pick(db, payload, current_profile)

