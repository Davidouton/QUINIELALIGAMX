from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_profile
from app.core.database import get_db
from app.models.entities import Profile
from app.schemas.vip import (
    VipCompetitionOut,
    VipQuestionPoolBulkResponseRequest,
    VipQuestionPoolResponseRequest,
    VipRequestJoinResponse,
)
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


@router.put("/vip/{vip_id}/questions/{question_id}/response", response_model=VipCompetitionOut)
def save_vip_question_pool_response(
    vip_id: str,
    question_id: str,
    payload: VipQuestionPoolResponseRequest,
    db: Session = Depends(get_db),
    current_profile: Profile = Depends(get_current_profile),
) -> VipCompetitionOut:
    service.save_question_pool_response(
        db,
        vip_id=vip_id,
        question_id=question_id,
        profile=current_profile,
        payload=payload,
    )
    rows = service.list_public_vips(db, current_profile, vip_id=vip_id)
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="VIP no encontrada")
    return rows[0]


@router.put("/vip/{vip_id}/questions/responses", response_model=VipCompetitionOut)
def save_vip_question_pool_responses_bulk(
    vip_id: str,
    payload: VipQuestionPoolBulkResponseRequest,
    db: Session = Depends(get_db),
    current_profile: Profile = Depends(get_current_profile),
) -> VipCompetitionOut:
    service.save_question_pool_responses_bulk(
        db,
        vip_id=vip_id,
        profile=current_profile,
        payload=payload,
    )
    rows = service.list_public_vips(db, current_profile, vip_id=vip_id)
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="VIP no encontrada")
    return rows[0]
