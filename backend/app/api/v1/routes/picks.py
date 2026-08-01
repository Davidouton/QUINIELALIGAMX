from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_profile
from app.core.database import get_db
from app.models.entities import Match, Matchday, Profile, WeeklyTiebreakPick
from app.schemas.pick import GlobalPickBoardOut, PickCreate, PickOut, PickResultRowOut, PickUpdate, WeeklyTiebreakPickOut, WeeklyTiebreakPickUpsert
from app.services.pick_service import PickService

router = APIRouter()
service = PickService()


def _tiebreak_out(db: Session, profile: Profile, matchday_id: str) -> WeeklyTiebreakPickOut:
    matchday = db.get(Matchday, matchday_id)
    if matchday is None or not matchday.tiebreak_match_id:
        raise HTTPException(status_code=404, detail="Esta jornada no tiene Tie Break configurado")
    match = db.get(Match, matchday.tiebreak_match_id)
    if match is None or match.matchday_id != matchday.id:
        raise HTTPException(status_code=409, detail="El partido de Tie Break no es válido")
    row = db.scalar(select(WeeklyTiebreakPick).where(WeeklyTiebreakPick.matchday_id == matchday.id, WeeklyTiebreakPick.profile_id == profile.id))
    return WeeklyTiebreakPickOut(matchday_id=matchday.id, match_id=match.id, predicted_total=row.predicted_total if row else None, is_locked=service._is_match_locked(db, match))


@router.get("/picks/tiebreak/{matchday_id}", response_model=WeeklyTiebreakPickOut)
def get_weekly_tiebreak(matchday_id: str, db: Session = Depends(get_db), current_profile: Profile = Depends(get_current_profile)) -> WeeklyTiebreakPickOut:
    return _tiebreak_out(db, current_profile, matchday_id)


@router.put("/picks/tiebreak/{matchday_id}", response_model=WeeklyTiebreakPickOut)
def save_weekly_tiebreak(matchday_id: str, payload: WeeklyTiebreakPickUpsert, db: Session = Depends(get_db), current_profile: Profile = Depends(get_current_profile)) -> WeeklyTiebreakPickOut:
    current = _tiebreak_out(db, current_profile, matchday_id)
    if current.is_locked:
        raise HTTPException(status_code=409, detail="El Tie Break ya está cerrado")
    row = db.scalar(select(WeeklyTiebreakPick).where(WeeklyTiebreakPick.matchday_id == matchday_id, WeeklyTiebreakPick.profile_id == current_profile.id))
    if row is None:
        row = WeeklyTiebreakPick(matchday_id=matchday_id, profile_id=current_profile.id, predicted_total=payload.predicted_total)
    else:
        row.predicted_total = payload.predicted_total
    db.add(row)
    db.commit()
    return _tiebreak_out(db, current_profile, matchday_id)


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
