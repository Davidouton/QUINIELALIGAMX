from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.repositories.team_repository import TeamRepository
from app.schemas.team import TeamOut

router = APIRouter()
repo = TeamRepository()


@router.get("/teams", response_model=list[TeamOut])
def list_teams(db: Session = Depends(get_db)) -> list[TeamOut]:
    return [TeamOut.model_validate(team, from_attributes=True) for team in repo.list_all(db)]
