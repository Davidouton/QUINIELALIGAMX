from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_profile
from app.core.database import get_db
from app.models.entities import (
    Profile,
    Season,
    SeasonMembership,
    SeasonVisibilityStatus,
    SurvivorMembership,
    VipCompetition,
    VipMembership,
)
from app.repositories.season_membership_repository import SeasonMembershipRepository
from app.schemas.dashboard import DashboardHomeOut
from app.repositories.team_repository import TeamRepository
from app.schemas.profile import (
    AdvancedStatsResponse,
    DashboardSummaryResponse,
    MeResponse,
    MeUpdateRequest,
    MembershipHistoryEntryOut,
    PersonalTrophyOut,
    PrizeSummaryResponse,
    RegisteredUserOption,
)
from app.services.leaderboard_service import LeaderboardService
from app.services.match_service import MatchService
from app.services.pick_service import PickService
from app.services.profile_service import ProfileService
from app.services.season_eligibility_service import SeasonEligibilityService
from app.services.vip_service import VipService

router = APIRouter()
service = ProfileService()
team_repo = TeamRepository()
season_membership_repo = SeasonMembershipRepository()
leaderboard_service = LeaderboardService()
match_service = MatchService()
pick_service = PickService()
season_eligibility_service = SeasonEligibilityService()
vip_service = VipService()


@router.get("/me", response_model=MeResponse)
def get_me(
    season_id: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_profile: Profile = Depends(get_current_profile),
) -> MeResponse:
    return service.build_me_response(db, current_profile, season_id=season_id)


@router.put("/me", response_model=MeResponse)
def update_me(
    payload: MeUpdateRequest,
    db: Session = Depends(get_db),
    current_profile: Profile = Depends(get_current_profile),
) -> MeResponse:
    favorite_team_id = payload.favorite_team_id.strip() if payload.favorite_team_id else None
    aval_profile_id = current_profile.aval_profile_id
    next_email = payload.email.strip() if payload.email else None
    if favorite_team_id and team_repo.get_by_id(db, favorite_team_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Equipo favorito no encontrado")
    if payload.theme_preference == "favorite_team" and not favorite_team_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Selecciona un equipo favorito para usar ese ambiente",
        )
    updated = service.update_settings(
        db,
        current_profile,
        payload.model_copy(
            update={
                "email": next_email,
                "favorite_team_id": favorite_team_id,
                "modality": current_profile.modality,
                "aval_profile_id": aval_profile_id,
                "pick_reminder_opening_enabled": (
                    payload.pick_reminder_opening_enabled if payload.pick_reminder_email_enabled else False
                ),
                "pick_reminder_hours_before": (
                    payload.pick_reminder_hours_before if payload.pick_reminder_email_enabled else None
                ),
                "matchday_start_notification_enabled": (
                    payload.matchday_start_notification_enabled if payload.pick_reminder_email_enabled else False
                ),
                "match_result_notification_enabled": (
                    payload.match_result_notification_enabled if payload.pick_reminder_email_enabled else False
                ),
                "matchday_summary_notification_enabled": (
                    payload.matchday_summary_notification_enabled if payload.pick_reminder_email_enabled else False
                ),
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


@router.get("/me/membership-history", response_model=list[MembershipHistoryEntryOut])
def get_membership_history(
    db: Session = Depends(get_db),
    current_profile: Profile = Depends(get_current_profile),
) -> list[MembershipHistoryEntryOut]:
    entries: list[MembershipHistoryEntryOut] = []

    season_rows = db.execute(
        select(SeasonMembership, Season)
        .join(Season, Season.id == SeasonMembership.season_id)
        .where(SeasonMembership.profile_id == current_profile.id)
    ).all()
    for membership, season in season_rows:
        entries.append(
            MembershipHistoryEntryOut(
                id=membership.id,
                membership_type="quiniela",
                name=season.name,
                season_name=season.name,
                status="Activa" if membership.is_active else "Inactiva",
                is_paid=membership.is_paid,
                joined_at=membership.activated_at or membership.created_at,
                season_visibility_status=season.visibility_status.value,
            )
        )

    survivor_rows = db.execute(
        select(SurvivorMembership, Season)
        .join(Season, Season.id == SurvivorMembership.season_id)
        .where(SurvivorMembership.profile_id == current_profile.id)
    ).all()
    for membership, season in survivor_rows:
        entries.append(
            MembershipHistoryEntryOut(
                id=membership.id,
                membership_type="survivor",
                name=season.survivor_name or f"Survivor {season.name}",
                season_name=season.name,
                status="Activa" if membership.is_active else "Inactiva",
                joined_at=membership.joined_at or membership.created_at,
                season_visibility_status=season.visibility_status.value,
            )
        )

    vip_rows = db.execute(
        select(VipMembership, VipCompetition, Season)
        .join(VipCompetition, VipCompetition.id == VipMembership.vip_competition_id)
        .join(Season, Season.id == VipCompetition.season_id)
        .where(VipMembership.profile_id == current_profile.id)
    ).all()
    for membership, vip, season in vip_rows:
        entries.append(
            MembershipHistoryEntryOut(
                id=membership.id,
                membership_type="vip",
                name=vip.name,
                season_name=season.name,
                status=membership.status.value.capitalize(),
                is_paid=membership.is_paid,
                joined_at=membership.requested_at,
                season_visibility_status=season.visibility_status.value,
            )
        )

    return sorted(entries, key=lambda entry: entry.joined_at or datetime.min.replace(tzinfo=UTC), reverse=True)


@router.post("/me/seasons/{season_id}/join", response_model=MeResponse)
def join_season(
    season_id: str,
    db: Session = Depends(get_db),
    current_profile: Profile = Depends(get_current_profile),
) -> MeResponse:
    season = db.get(Season, season_id)
    if season is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Temporada no encontrada")
    if season.visibility_status == SeasonVisibilityStatus.TESTING:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Los torneos de prueba solo aceptan participantes asignados por un administrador",
        )
    if season.registration_closed:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El registro de esta liga fue cerrado por administracion",
        )
    lock_at = season_eligibility_service.get_effective_lock_at(db, season)
    if lock_at is not None and datetime.now(UTC) >= lock_at:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La ventana de inscripcion para esta temporada ya cerro",
        )

    membership = season_membership_repo.get_for_profile_and_season(db, current_profile.id, season.id)
    if membership is None:
        membership = SeasonMembership(
            season_id=season.id,
            profile_id=current_profile.id,
        )

    is_aval_member = current_profile.modality == "aval" and bool(current_profile.aval_profile_id)
    if is_aval_member:
        membership.is_active = True
        if membership.activated_at is None:
            membership.activated_at = datetime.now(UTC)
    elif not membership.is_active:
        membership.is_active = False
        membership.activated_at = None

    if not season_eligibility_service.is_locked(db, season):
        membership.eligible_for_scoring = bool(membership.is_active)
        membership.eligible_locked_at = None

    season_membership_repo.save(db, membership)
    db.commit()
    return service.build_me_response(db, current_profile, season_id=season.id)


@router.get("/me/prize-summary", response_model=PrizeSummaryResponse)
def get_prize_summary(
    season_id: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_profile: Profile = Depends(get_current_profile),
) -> PrizeSummaryResponse:
    return service.build_prize_summary(db, season_id=season_id)


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


@router.get("/me/dashboard-home", response_model=DashboardHomeOut)
def get_dashboard_home(
    season_id: str | None = Query(default=None),
    matchday_id: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_profile: Profile = Depends(get_current_profile),
) -> DashboardHomeOut:
    return DashboardHomeOut(
        summary=service.build_dashboard_summary(db, current_profile, season_id=season_id),
        advanced_stats=service.build_advanced_stats(db, current_profile, season_id=season_id),
        performance_race=leaderboard_service.get_performance_race(db, current_profile, season_id=season_id),
        matchday_points=leaderboard_service.list_profile_matchdays(db, current_profile, season_id=season_id),
        personal_trophies=service.list_personal_trophies(db, current_profile),
        vip_competitions=vip_service.list_public_vips(
            db,
            current_profile,
            include_leaderboard=False,
            include_member_dashboard=False,
            include_approved_members=False,
            include_team_winner_details=False,
        ),
        leaderboard=leaderboard_service.list_overall(db, season_id=season_id) if season_id else [],
        matches=match_service.list_matches(db, matchday_id=matchday_id) if matchday_id else [],
        pick_results=pick_service.list_my_pick_results(db, current_profile, matchday_id=matchday_id) if matchday_id else [],
    )


@router.get("/me/trophies", response_model=list[PersonalTrophyOut])
def get_personal_trophies(
    db: Session = Depends(get_db),
    current_profile: Profile = Depends(get_current_profile),
) -> list[PersonalTrophyOut]:
    return service.list_personal_trophies(db, current_profile)
