from sqlalchemy import case, select
from sqlalchemy.orm import Session

from app.models.entities import Season, SeasonVisibilityStatus


class SeasonRepository:
    def list_all(self, db: Session) -> list[Season]:
        visibility_rank = case(
            (Season.visibility_status == SeasonVisibilityStatus.LIVE, 0),
            (Season.visibility_status == SeasonVisibilityStatus.TESTING, 1),
            (Season.visibility_status == SeasonVisibilityStatus.CLOSED, 2),
            else_=3,
        )
        stmt = select(Season).order_by(
            visibility_rank.asc(),
            Season.created_at.desc(),
        )
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
