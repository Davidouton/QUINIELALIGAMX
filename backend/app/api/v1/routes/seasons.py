from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.repositories.season_repository import SeasonRepository
from app.schemas.season import SeasonOut

router = APIRouter()
repo = SeasonRepository()


@router.get("/seasons", response_model=list[SeasonOut])
def list_seasons(db: Session = Depends(get_db)) -> list[SeasonOut]:
    return [SeasonOut.model_validate(season, from_attributes=True) for season in repo.list_all(db)]
