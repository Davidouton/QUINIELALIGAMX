from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_optional_current_profile
from app.core.database import get_db
from app.models.entities import Profile, Season, SeasonVisibilityStatus, MatchdayStatus
from app.schemas.matchday import MatchdayOut
from app.services.matchday_service import MatchdayService
from app.services.season_visibility_service import SeasonVisibilityService

router = APIRouter()
service = MatchdayService()
visibility_service = SeasonVisibilityService()


@router.get("/matchdays", response_model=list[MatchdayOut])
def list_matchdays(
    status: MatchdayStatus | None = Query(default=None),
    db: Session = Depends(get_db),
    current_profile: Profile | None = Depends(get_optional_current_profile),
) -> list[MatchdayOut]:
    rows = service.list_matchdays(db, status_filter=status)
    testing_ids = set(
        db.scalars(select(Season.id).where(Season.visibility_status == SeasonVisibilityStatus.TESTING))
    )
    allowed_testing_ids = visibility_service.visible_testing_season_ids(db, current_profile)
    return [row for row in rows if row.season_id not in testing_ids or row.season_id in allowed_testing_ids]
