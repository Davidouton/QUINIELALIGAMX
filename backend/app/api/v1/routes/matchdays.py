from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.entities import MatchdayStatus
from app.schemas.matchday import MatchdayOut
from app.services.matchday_service import MatchdayService

router = APIRouter()
service = MatchdayService()


@router.get("/matchdays", response_model=list[MatchdayOut])
def list_matchdays(
    status: MatchdayStatus | None = Query(default=None),
    db: Session = Depends(get_db),
) -> list[MatchdayOut]:
    if status == MatchdayStatus.ACTIVE:
        active = service.get_active_matchday(db)
        return [active] if active else []
    return service.list_matchdays(db, status_filter=status)

