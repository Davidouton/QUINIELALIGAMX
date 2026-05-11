from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.entities import Competition, Season, TournamentFormat
from app.repositories.season_repository import SeasonRepository
from app.schemas.season import SeasonOut

router = APIRouter()
repo = SeasonRepository()


def _normalize_text(value: str | None) -> str:
    return (value or "").strip().lower()


def _find_inferred_competitions(
    competitions: dict[str, Competition],
) -> tuple[Competition | None, Competition | None]:
    liga_mx = next(
        (
            row
            for row in competitions.values()
            if "liga mx" in _normalize_text(row.name) or row.slug == "liga-mx"
        ),
        None,
    )
    fifa_world_cup = next(
        (
            row
            for row in competitions.values()
            if any(
                token in _normalize_text(row.name)
                for token in ("fifa", "world cup", "mundial")
            )
            or any(token in _normalize_text(row.slug) for token in ("fifa", "world-cup", "fifawc"))
        ),
        None,
    )
    return liga_mx, fifa_world_cup


def _resolve_season_competition(
    season: Season,
    competitions: dict[str, Competition],
    liga_mx_competition: Competition | None,
    fifa_world_cup_competition: Competition | None,
) -> Competition | None:
    if season.competition_id and season.competition_id in competitions:
        return competitions[season.competition_id]
    if season.tournament_format == TournamentFormat.STANDARD:
        return liga_mx_competition
    if season.tournament_format == TournamentFormat.WORLD_CUP:
        return fifa_world_cup_competition
    return None


@router.get("/seasons", response_model=list[SeasonOut])
def list_seasons(
    competition_id: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> list[SeasonOut]:
    seasons = repo.list_all(db)
    competitions = {
        row.id: row
        for row in db.scalars(select(Competition))
    }
    liga_mx_competition, fifa_world_cup_competition = _find_inferred_competitions(competitions)
    if competition_id:
        filtered_seasons: list[Season] = []
        for season in seasons:
            resolved_competition = _resolve_season_competition(
                season,
                competitions,
                liga_mx_competition,
                fifa_world_cup_competition,
            )
            if resolved_competition is not None and resolved_competition.id == competition_id:
                filtered_seasons.append(season)
        seasons = filtered_seasons

    payload: list[SeasonOut] = []
    for season in seasons:
        resolved_competition = _resolve_season_competition(
            season,
            competitions,
            liga_mx_competition,
            fifa_world_cup_competition,
        )
        payload.append(
            SeasonOut(
                id=season.id,
                name=season.name,
                slug=season.slug,
                competition_id=resolved_competition.id if resolved_competition is not None else season.competition_id,
                competition_name=resolved_competition.name if resolved_competition is not None else None,
                competition_sport_name=resolved_competition.sport_name if resolved_competition is not None else None,
                tournament_format=season.tournament_format,
                is_active=season.is_active,
                start_matchday_id=season.start_matchday_id,
                end_matchday_id=season.end_matchday_id,
                participants_lock_at=season.participants_lock_at,
                created_at=season.created_at,
                updated_at=season.updated_at,
            )
        )
    return payload
