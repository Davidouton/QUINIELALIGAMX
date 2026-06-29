from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_profile
from app.api.v1.routes.matchdays import list_matchdays
from app.api.v1.routes.seasons import list_seasons
from app.api.v1.routes.teams import list_teams
from app.core.database import get_db
from app.models.entities import MatchdayStatus, Profile
from app.schemas.bootstrap import AppBootstrapOut
from app.services.profile_service import ProfileService

router = APIRouter()
profile_service = ProfileService()


@router.get("/bootstrap", response_model=AppBootstrapOut)
def get_app_bootstrap(
    db: Session = Depends(get_db),
    current_profile: Profile = Depends(get_current_profile),
) -> AppBootstrapOut:
    return AppBootstrapOut(
        me=profile_service.build_me_response(db, current_profile),
        seasons=list_seasons(competition_id=None, db=db),
        matchdays=list_matchdays(status=None, db=db),
        active_matchdays=list_matchdays(status=MatchdayStatus.ACTIVE, db=db),
        teams=list_teams(competition_id=None, db=db),
    )
