from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.schemas.match import MatchOut
from app.services.match_service import MatchService

router = APIRouter()
service = MatchService()


@router.get("/matches", response_model=list[MatchOut])
def list_matches(
    matchday_id: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> list[MatchOut]:
    return service.list_matches(db, matchday_id=matchday_id)


@router.get("/matches/{match_id}", response_model=MatchOut)
def get_match(match_id: str, db: Session = Depends(get_db)) -> MatchOut:
    match = service.get_match(db, match_id)
    if match is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Match not found")
    return match

