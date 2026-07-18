from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_optional_current_profile
from app.core.database import get_db
from app.models.entities import Match, Matchday, Profile, Season
from app.schemas.match import MatchOut
from app.services.match_service import MatchService
from app.services.season_visibility_service import SeasonVisibilityService

router = APIRouter()
service = MatchService()
visibility_service = SeasonVisibilityService()


def _can_view_matchday(db: Session, profile: Profile | None, matchday_id: str) -> bool:
    season = db.scalar(
        select(Season).join(Matchday, Matchday.season_id == Season.id).where(Matchday.id == matchday_id)
    )
    return season is not None and visibility_service.can_view(db, profile, season)


@router.get("/matches", response_model=list[MatchOut])
def list_matches(
    matchday_id: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_profile: Profile | None = Depends(get_optional_current_profile),
) -> list[MatchOut]:
    if matchday_id and not _can_view_matchday(db, current_profile, matchday_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Matchday not found")
    rows = service.list_matches(db, matchday_id=matchday_id)
    if matchday_id:
        return rows
    visible_matchday_ids = {
        matchday.id
        for matchday, season in db.execute(select(Matchday, Season).join(Season, Season.id == Matchday.season_id))
        if visibility_service.can_view(db, current_profile, season)
    }
    return [row for row in rows if row.matchday_id in visible_matchday_ids]


@router.get("/matches/{match_id}", response_model=MatchOut)
def get_match(
    match_id: str,
    db: Session = Depends(get_db),
    current_profile: Profile | None = Depends(get_optional_current_profile),
) -> MatchOut:
    match_row = db.get(Match, match_id)
    if match_row is not None and not _can_view_matchday(db, current_profile, match_row.matchday_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Match not found")
    match = service.get_match(db, match_id)
    if match is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Match not found")
    return match
