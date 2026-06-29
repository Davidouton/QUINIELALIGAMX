from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import get_current_profile
from app.core.database import get_db
from app.models.entities import Profile
from app.schemas.pick import GlobalPickBoardOut, PickCreate, PickOut, PickResultRowOut, PickUpdate
from app.services.pick_service import PickService

router = APIRouter()
service = PickService()


@router.post("/picks", response_model=PickOut, status_code=201)
def create_pick(
    payload: PickCreate,
    db: Session = Depends(get_db),
    current_profile: Profile = Depends(get_current_profile),
) -> PickOut:
    return service.create_pick(db, current_profile, payload)


@router.put("/picks/{pick_id}", response_model=PickOut)
def update_pick(
    pick_id: str,
    payload: PickUpdate,
    db: Session = Depends(get_db),
    current_profile: Profile = Depends(get_current_profile),
) -> PickOut:
    return service.update_pick(db, current_profile, pick_id, payload)


@router.get("/my-picks", response_model=list[PickOut])
def list_my_picks(
    matchday_id: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_profile: Profile = Depends(get_current_profile),
) -> list[PickOut]:
    return service.list_my_picks(db, current_profile, matchday_id=matchday_id)


@router.get("/my-pick-results", response_model=list[PickResultRowOut])
def list_my_pick_results(
    matchday_id: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_profile: Profile = Depends(get_current_profile),
) -> list[PickResultRowOut]:
    return service.list_my_pick_results(db, current_profile, matchday_id=matchday_id)


@router.get("/global-picks", response_model=GlobalPickBoardOut)
def list_global_picks(
    matchday_id: str = Query(...),
    context_type: str | None = Query(default=None),
    context_id: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_profile: Profile = Depends(get_current_profile),
) -> GlobalPickBoardOut:
    return service.list_global_picks(
        db,
        current_profile,
        matchday_id=matchday_id,
        context_type=context_type,
        context_id=context_id,
    )
