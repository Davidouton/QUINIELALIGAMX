from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import Matchday, MatchdayStatus


class MatchdayRepository:
    def list_matchdays(self, db: Session, status_filter: MatchdayStatus | None = None) -> list[Matchday]:
        stmt = select(Matchday).order_by(Matchday.number.asc())
        if status_filter is not None:
            stmt = stmt.where(Matchday.status == status_filter)
        return list(db.scalars(stmt))

    def get_active_matchday(self, db: Session) -> Matchday | None:
        return db.scalar(select(Matchday).where(Matchday.status == MatchdayStatus.ACTIVE))

    def get_by_id(self, db: Session, matchday_id: str) -> Matchday | None:
        return db.scalar(select(Matchday).where(Matchday.id == matchday_id))

