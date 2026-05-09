from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.entities import Competition
from app.schemas.competition import CompetitionOut

router = APIRouter()


@router.get("/competitions", response_model=list[CompetitionOut])
def list_competitions(db: Session = Depends(get_db)) -> list[CompetitionOut]:
    rows = list(
        db.scalars(
            select(Competition)
            .order_by(Competition.sort_order.asc(), Competition.sport_name.asc(), Competition.name.asc())
        )
    )
    return [CompetitionOut.model_validate(row, from_attributes=True) for row in rows]
