from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_profile, get_db, require_roles
from app.models.entities import Profile, RoleCode
from app.schemas.quiniela_plus import (
    QuinielaPlusAdminConsoleResponse,
    QuinielaPlusAdminSettingsOut,
    QuinielaPlusAdminSettingsUpdateRequest,
    QuinielaPlusAdvancedStatsOut,
    QuinielaPlusCatalogResponse,
    QuinielaPlusLeagueOut,
    QuinielaPlusLeagueUpsertRequest,
    QuinielaPlusMembershipOut,
    QuinielaPlusOddsSneakPeekOut,
    QuinielaPlusPlanOut,
    QuinielaPlusPlanUpsertRequest,
    QuinielaPlusUserDistributionOut,
    QuinielaPlusValueLabOut,
)
from app.services.quiniela_plus_service import QuinielaPlusService

router = APIRouter()
service = QuinielaPlusService()


@router.get("/quiniela-plus/catalog", response_model=QuinielaPlusCatalogResponse)
def get_catalog(
    db: Session = Depends(get_db),
    current_profile: Profile = Depends(get_current_profile),
) -> QuinielaPlusCatalogResponse:
    return service.list_catalog(db, current_profile)


@router.get("/quiniela-plus/my-memberships", response_model=list[QuinielaPlusMembershipOut])
def list_my_memberships(
    db: Session = Depends(get_db),
    current_profile: Profile = Depends(get_current_profile),
) -> list[QuinielaPlusMembershipOut]:
    return service.list_memberships(db, current_profile)


@router.get("/quiniela-plus/odds-sneak-peek", response_model=QuinielaPlusOddsSneakPeekOut)
def get_odds_sneak_peek(
    db: Session = Depends(get_db),
    _: Profile = Depends(get_current_profile),
) -> QuinielaPlusOddsSneakPeekOut:
    return service.get_odds_sneak_peek(db)


@router.get("/quiniela-plus/user-distribution", response_model=QuinielaPlusUserDistributionOut)
def get_user_distribution(
    db: Session = Depends(get_db),
    _: Profile = Depends(get_current_profile),
) -> QuinielaPlusUserDistributionOut:
    return service.get_user_distribution(db)


@router.get("/quiniela-plus/advanced-stats", response_model=QuinielaPlusAdvancedStatsOut)
def get_advanced_stats(
    db: Session = Depends(get_db),
    _: Profile = Depends(get_current_profile),
) -> QuinielaPlusAdvancedStatsOut:
    return service.get_advanced_stats(db)


@router.get("/quiniela-plus/value-lab", response_model=QuinielaPlusValueLabOut)
def get_value_lab(
    db: Session = Depends(get_db),
    _: Profile = Depends(get_current_profile),
) -> QuinielaPlusValueLabOut:
    return service.get_value_lab(db)


@router.get("/quiniela-plus/admin/console", response_model=QuinielaPlusAdminConsoleResponse)
def get_admin_console(
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> QuinielaPlusAdminConsoleResponse:
    return service.get_admin_console(db)


@router.put("/quiniela-plus/admin/settings", response_model=QuinielaPlusAdminSettingsOut)
def update_admin_settings(
    payload: QuinielaPlusAdminSettingsUpdateRequest,
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> QuinielaPlusAdminSettingsOut:
    return service.update_settings(db, payload)


@router.post(
    "/quiniela-plus/admin/leagues",
    response_model=QuinielaPlusLeagueOut,
    status_code=status.HTTP_201_CREATED,
)
def create_admin_league(
    payload: QuinielaPlusLeagueUpsertRequest,
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> QuinielaPlusLeagueOut:
    return service.create_league(db, payload)


@router.put("/quiniela-plus/admin/leagues/{league_id}", response_model=QuinielaPlusLeagueOut)
def update_admin_league(
    league_id: str,
    payload: QuinielaPlusLeagueUpsertRequest,
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> QuinielaPlusLeagueOut:
    return service.update_league(db, league_id, payload)


@router.post(
    "/quiniela-plus/admin/plans",
    response_model=QuinielaPlusPlanOut,
    status_code=status.HTTP_201_CREATED,
)
def create_admin_plan(
    payload: QuinielaPlusPlanUpsertRequest,
    db: Session = Depends(get_db),
    current_profile: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> QuinielaPlusPlanOut:
    return service.create_plan(db, payload, current_profile)


@router.put("/quiniela-plus/admin/plans/{plan_id}", response_model=QuinielaPlusPlanOut)
def update_admin_plan(
    plan_id: str,
    payload: QuinielaPlusPlanUpsertRequest,
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> QuinielaPlusPlanOut:
    return service.update_plan(db, plan_id, payload)
