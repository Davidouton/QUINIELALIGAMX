from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import Match


class MatchRepository:
    def list_matches(self, db: Session, matchday_id: str | None = None) -> list[Match]:
        stmt = select(Match).order_by(Match.kickoff_at.asc())
        if matchday_id is not None:
            stmt = stmt.where(Match.matchday_id == matchday_id)
        return list(db.scalars(stmt))

    def get_by_id(self, db: Session, match_id: str) -> Match | None:
        return db.scalar(select(Match).where(Match.id == match_id))

    def delete(self, db: Session, match: Match) -> None:
        db.delete(match)
