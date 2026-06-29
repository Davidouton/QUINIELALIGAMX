from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import get_current_profile
from app.core.database import get_db
from app.models.entities import Profile
from app.schemas.vip import VipCompetitionOut, VipRequestJoinResponse
from app.services.vip_service import VipService

router = APIRouter()
service = VipService()


@router.get("/vip", response_model=list[VipCompetitionOut])
def list_vips(
    vip_id: str | None = Query(default=None),
    include_leaderboard: bool = Query(default=True),
    include_member_dashboard: bool = Query(default=True),
    include_approved_members: bool = Query(default=True),
    include_team_winner_details: bool = Query(default=True),
    db: Session = Depends(get_db),
    current_profile: Profile = Depends(get_current_profile),
) -> list[VipCompetitionOut]:
    return service.list_public_vips(
        db,
        current_profile,
        vip_id=vip_id,
        include_leaderboard=include_leaderboard,
        include_member_dashboard=include_member_dashboard,
        include_approved_members=include_approved_members,
        include_team_winner_details=include_team_winner_details,
    )


@router.post("/vip/{vip_id}/request", response_model=VipRequestJoinResponse)
def request_vip_join(
    vip_id: str,
    db: Session = Depends(get_db),
    current_profile: Profile = Depends(get_current_profile),
) -> VipRequestJoinResponse:
    membership = service.request_join(db, vip_id, current_profile)
    return VipRequestJoinResponse(
        vip_id=vip_id,
        membership=service.get_membership_out(db, membership),
    )
