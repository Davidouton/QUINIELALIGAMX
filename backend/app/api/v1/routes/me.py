from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_profile
from app.core.database import get_db
from app.models.entities import Profile
from app.repositories.profile_repository import ProfileRepository
from app.repositories.team_repository import TeamRepository
from app.schemas.profile import (
    AdvancedStatsResponse,
    DashboardSummaryResponse,
    MeResponse,
    MeUpdateRequest,
    PersonalTrophyOut,
    PrizeSummaryResponse,
    RegisteredUserOption,
)
from app.services.profile_service import ProfileService

router = APIRouter()
service = ProfileService()
team_repo = TeamRepository()
profile_repo = ProfileRepository()


@router.get("/me", response_model=MeResponse)
def get_me(
    db: Session = Depends(get_db),
    current_profile: Profile = Depends(get_current_profile),
) -> MeResponse:
    return service.build_me_response(db, current_profile)


@router.put("/me", response_model=MeResponse)
def update_me(
    payload: MeUpdateRequest,
    db: Session = Depends(get_db),
    current_profile: Profile = Depends(get_current_profile),
) -> MeResponse:
    favorite_team_id = payload.favorite_team_id.strip() if payload.favorite_team_id else None
    aval_profile_id = payload.aval_profile_id.strip() if payload.aval_profile_id else None
    if favorite_team_id and team_repo.get_by_id(db, favorite_team_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Equipo favorito no encontrado")
    if payload.theme_preference == "favorite_team" and not favorite_team_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Selecciona un equipo favorito para usar ese ambiente",
        )
    if payload.modality == "aval" and not aval_profile_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Selecciona un aval para esta modalidad",
        )
    if aval_profile_id == current_profile.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No puedes seleccionarte como aval",
        )
    if aval_profile_id and profile_repo.get_by_id(db, aval_profile_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Aval no encontrado")

    updated = service.update_settings(
        db,
        current_profile,
        payload.model_copy(
            update={
                "favorite_team_id": favorite_team_id,
                "aval_profile_id": aval_profile_id if payload.modality == "aval" else None,
            }
        ),
    )
    return service.build_me_response(db, updated)


@router.get("/me/registered-users", response_model=list[RegisteredUserOption])
def get_registered_users(
    db: Session = Depends(get_db),
    current_profile: Profile = Depends(get_current_profile),
) -> list[RegisteredUserOption]:
    return service.list_registered_user_options(db, current_profile)


@router.get("/me/prize-summary", response_model=PrizeSummaryResponse)
def get_prize_summary(
    db: Session = Depends(get_db),
    current_profile: Profile = Depends(get_current_profile),
) -> PrizeSummaryResponse:
    return service.build_prize_summary(db)


@router.get("/me/dashboard-summary", response_model=DashboardSummaryResponse)
def get_dashboard_summary(
    season_id: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_profile: Profile = Depends(get_current_profile),
) -> DashboardSummaryResponse:
    return service.build_dashboard_summary(db, current_profile, season_id=season_id)


@router.get("/me/advanced-stats", response_model=AdvancedStatsResponse)
def get_advanced_stats(
    season_id: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_profile: Profile = Depends(get_current_profile),
) -> AdvancedStatsResponse:
    return service.build_advanced_stats(db, current_profile, season_id=season_id)


@router.get("/me/trophies", response_model=list[PersonalTrophyOut])
def get_personal_trophies(
    db: Session = Depends(get_db),
    current_profile: Profile = Depends(get_current_profile),
) -> list[PersonalTrophyOut]:
    return service.list_personal_trophies(db, current_profile)
