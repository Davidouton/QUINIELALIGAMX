from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import Season


class SeasonRepository:
    def list_all(self, db: Session) -> list[Season]:
        stmt = select(Season).order_by(Season.is_active.desc(), Season.created_at.desc())
        return list(db.scalars(stmt))

    def get_by_id(self, db: Session, season_id: str) -> Season | None:
        return db.scalar(select(Season).where(Season.id == season_id))

    def create(self, db: Session, season: Season) -> Season:
        db.add(season)
        db.flush()
        return season

    def save(self, db: Session, season: Season) -> Season:
        db.add(season)
        db.flush()
        return season
