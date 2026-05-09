from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import require_roles
from app.core.database import get_db
from app.models.entities import Match, Profile, RoleCode
from app.schemas.match import MatchOut
from app.schemas.world_cup import (
    WorldCupAdminGroupOut,
    WorldCupAdminGroupTeamsUpdateRequest,
    WorldCupAdminGroupUpsertRequest,
)
from app.services.match_service import MatchService
from app.services.world_cup_service import WorldCupService

router = APIRouter()
service = WorldCupService()
match_service = MatchService()


@router.get("/world-cup/groups", response_model=list[WorldCupAdminGroupOut])
def list_world_cup_groups(
    season_id: str = Query(...),
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> list[WorldCupAdminGroupOut]:
    return service.list_admin_groups(db, season_id)


@router.post("/world-cup/groups", response_model=WorldCupAdminGroupOut, status_code=201)
def create_world_cup_group(
    payload: WorldCupAdminGroupUpsertRequest,
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> WorldCupAdminGroupOut:
    return service.create_admin_group(db, payload)


@router.put("/world-cup/groups/{group_id}", response_model=WorldCupAdminGroupOut)
def update_world_cup_group(
    group_id: str,
    payload: WorldCupAdminGroupUpsertRequest,
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> WorldCupAdminGroupOut:
    return service.update_admin_group(db, group_id, payload)


@router.delete("/world-cup/groups/{group_id}")
def delete_world_cup_group(
    group_id: str,
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> dict[str, str]:
    return service.delete_admin_group(db, group_id)


@router.put("/world-cup/groups/{group_id}/teams", response_model=WorldCupAdminGroupOut)
def update_world_cup_group_teams(
    group_id: str,
    payload: WorldCupAdminGroupTeamsUpdateRequest,
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> WorldCupAdminGroupOut:
    return service.update_admin_group_teams(db, group_id, payload)


@router.get("/world-cup/bracket", response_model=list[MatchOut])
def list_world_cup_bracket_matches(
    season_id: str = Query(...),
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> list[MatchOut]:
    matches = service.list_admin_bracket_matches(db, season_id)
    return [match_service._to_match_out(db, match) for match in matches]
