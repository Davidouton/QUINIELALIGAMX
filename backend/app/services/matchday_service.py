from sqlalchemy.orm import Session

from app.models.entities import MatchdayStatus
from app.repositories.matchday_repository import MatchdayRepository
from app.schemas.matchday import MatchdayOut


class MatchdayService:
    def __init__(self) -> None:
        self.repo = MatchdayRepository()

    def list_matchdays(self, db: Session, status_filter: MatchdayStatus | None = None) -> list[MatchdayOut]:
        matchdays = self.repo.list_matchdays(db, status_filter=status_filter)
        return [MatchdayOut.model_validate(matchday, from_attributes=True) for matchday in matchdays]

    def get_active_matchday(self, db: Session) -> MatchdayOut | None:
        matchday = self.repo.get_active_matchday(db)
        if matchday is None:
            return None
        return MatchdayOut.model_validate(matchday, from_attributes=True)

