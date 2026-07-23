from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.entities import Competition, CompetitionTeam
from app.repositories.team_repository import TeamRepository
from app.schemas.team import TeamOut

router = APIRouter()
repo = TeamRepository()


@router.get("/teams", response_model=list[TeamOut])
def list_teams(
    competition_id: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> list[TeamOut]:
    teams = repo.list_all(db)
    membership_rows = list(db.scalars(select(CompetitionTeam)).all())
    competition_ids_by_team: dict[str, list[str]] = {}
    for membership in membership_rows:
        competition_ids_by_team.setdefault(membership.team_id, []).append(membership.competition_id)
    for team in teams:
        if team.competition_id and team.competition_id not in competition_ids_by_team.get(team.id, []):
            competition_ids_by_team.setdefault(team.id, []).append(team.competition_id)
    if competition_id:
        teams = [team for team in teams if competition_id in competition_ids_by_team.get(team.id, [])]

    competition_ids = sorted({row_id for ids in competition_ids_by_team.values() for row_id in ids})
    competitions = {
        row.id: row
        for row in db.scalars(select(Competition).where(Competition.id.in_(competition_ids)))
    } if competition_ids else {}

    return [
        TeamOut(
            id=team.id,
            competition_id=team.competition_id,
            competition_name=competitions.get(team.competition_id).name if team.competition_id in competitions else None,
            competition_sport_name=(
                competitions.get(team.competition_id).sport_name if team.competition_id in competitions else None
            ),
            competition_ids=competition_ids_by_team.get(team.id, []),
            competition_names=[
                competitions[row_id].name
                for row_id in competition_ids_by_team.get(team.id, [])
                if row_id in competitions
            ],
            external_id=team.external_id,
            name=team.name,
            short_name=team.short_name,
            slug=team.slug,
            crest_url=team.crest_url,
            home_venue=team.home_venue,
            primary_color=team.primary_color,
            secondary_color=team.secondary_color,
            accent_color=team.accent_color,
            created_at=team.created_at,
            updated_at=team.updated_at,
        )
        for team in teams
    ]
