from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_profile
from app.api.v1.routes.matchdays import list_matchdays
from app.api.v1.routes.seasons import list_seasons
from app.api.v1.routes.teams import list_teams
from app.core.database import get_db
from app.models.entities import CommerceSettings, MatchdayStatus, Profile
from app.schemas.bootstrap import AppBootstrapOut, AppBrandingOut
from app.services.profile_service import ProfileService

router = APIRouter()
profile_service = ProfileService()


@router.get("/branding", response_model=AppBrandingOut)
def get_app_branding(db: Session = Depends(get_db)) -> AppBrandingOut:
    settings_row = db.scalar(select(CommerceSettings).order_by(CommerceSettings.created_at.asc()))
    return AppBrandingOut(app_icon_url=settings_row.app_icon_url if settings_row is not None else None)


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
