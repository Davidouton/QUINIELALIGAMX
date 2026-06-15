from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.schemas.world_cup import WorldCupBoardOut, WorldCupNewsFeedOut
from app.services.world_cup_service import WorldCupService

router = APIRouter()
service = WorldCupService()


@router.get("/world-cup/board", response_model=WorldCupBoardOut)
def get_world_cup_board(
    season_id: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> WorldCupBoardOut:
    return service.get_board(db, season_id)


@router.get("/world-cup/news", response_model=WorldCupNewsFeedOut)
def get_world_cup_news(
    category: str = Query(default="all", pattern="^(all|official|mexico)$"),
) -> WorldCupNewsFeedOut:
    return service.list_news(category)
