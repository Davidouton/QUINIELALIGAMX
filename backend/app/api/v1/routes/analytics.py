from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_profile, get_db, require_roles
from app.models.entities import Profile, RoleCode
from app.schemas.analytics import AdminAnalyticsStatsOut, AnalyticsAckOut, AnalyticsEventIn
from app.services.analytics_service import AnalyticsService

router = APIRouter()
analytics_service = AnalyticsService()


@router.post("/analytics/events", response_model=AnalyticsAckOut, status_code=status.HTTP_202_ACCEPTED)
def capture_analytics_event(
    payload: AnalyticsEventIn,
    db: Session = Depends(get_db),
    current_profile: Profile = Depends(get_current_profile),
) -> AnalyticsAckOut:
    analytics_service.record_event(db, profile_id=current_profile.id, payload=payload)
    return AnalyticsAckOut()


@router.get("/admin/stats", response_model=AdminAnalyticsStatsOut)
def get_admin_analytics_stats(
    days: int = Query(7, ge=1, le=90),
    profile_id: str | None = Query(default=None),
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> AdminAnalyticsStatsOut:
    return analytics_service.build_admin_stats(db, days=days, profile_id=profile_id)
