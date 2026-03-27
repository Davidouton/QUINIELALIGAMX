from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.schemas.result import PublishedResultOut, ResultOut
from app.services.result_service import ResultService

router = APIRouter()
service = ResultService()


@router.get("/results", response_model=list[ResultOut])
def list_results(
    matchday_id: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> list[ResultOut]:
    return service.list_results(db, matchday_id=matchday_id)


@router.get("/published-results", response_model=list[PublishedResultOut])
def list_published_results(
    matchday_id: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> list[PublishedResultOut]:
    return service.list_published_results(db, matchday_id=matchday_id)

