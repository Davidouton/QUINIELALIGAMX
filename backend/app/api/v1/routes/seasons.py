from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.entities import Competition
from app.repositories.season_repository import SeasonRepository
from app.schemas.season import SeasonOut

router = APIRouter()
repo = SeasonRepository()


@router.get("/seasons", response_model=list[SeasonOut])
def list_seasons(
    competition_id: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> list[SeasonOut]:
    seasons = repo.list_all(db)
    if competition_id:
        seasons = [season for season in seasons if season.competition_id == competition_id]

    competition_ids = sorted({season.competition_id for season in seasons if season.competition_id})
    competitions = {
        row.id: row
        for row in db.scalars(select(Competition).where(Competition.id.in_(competition_ids)))
    } if competition_ids else {}

    return [
        SeasonOut(
            id=season.id,
            name=season.name,
            slug=season.slug,
            competition_id=season.competition_id,
            competition_name=competitions.get(season.competition_id).name if season.competition_id in competitions else None,
            competition_sport_name=(
                competitions.get(season.competition_id).sport_name if season.competition_id in competitions else None
            ),
            tournament_format=season.tournament_format,
            is_active=season.is_active,
            start_matchday_id=season.start_matchday_id,
            end_matchday_id=season.end_matchday_id,
            participants_lock_at=season.participants_lock_at,
            created_at=season.created_at,
            updated_at=season.updated_at,
        )
        for season in seasons
    ]
