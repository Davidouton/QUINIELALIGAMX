from fastapi import APIRouter, Depends
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
    db: Session = Depends(get_db),
    current_profile: Profile = Depends(get_current_profile),
) -> list[VipCompetitionOut]:
    return service.list_public_vips(db, current_profile)


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
