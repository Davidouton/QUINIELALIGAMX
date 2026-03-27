from fastapi import APIRouter, HTTPException, Query, status

from app.schemas.ligamx import MatchOut, StandingRow, TeamOut
from app.services.ligamx_service import build_standings, get_team, list_matches, list_teams

router = APIRouter(prefix="/ligamx")


@router.get("/teams", response_model=list[TeamOut])
def get_teams() -> list[TeamOut]:
    return list_teams()


@router.get("/teams/{team_id}", response_model=TeamOut)
def get_team_by_id(team_id: int) -> TeamOut:
    team = get_team(team_id)
    if team is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Team not found")
    return team


@router.get("/matches", response_model=list[MatchOut])
def get_matches(
    matchday: int | None = Query(default=None, ge=1),
    status_filter: str | None = Query(
        default=None,
        alias="status",
        pattern="^(finished|scheduled)$",
    ),
) -> list[MatchOut]:
    return list_matches(matchday=matchday, status=status_filter)


@router.get("/standings", response_model=list[StandingRow])
def get_standings(matchday: int | None = Query(default=None, ge=1)) -> list[StandingRow]:
    return build_standings(matchday=matchday)
