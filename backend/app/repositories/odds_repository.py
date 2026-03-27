from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import Odds


class OddsRepository:
    def list_latest_by_match_ids(self, db: Session, match_ids: list[str]) -> dict[str, Odds]:
        if not match_ids:
            return {}

        stmt = (
            select(Odds)
            .where(Odds.match_id.in_(match_ids))
            .order_by(Odds.match_id.asc(), Odds.synced_at.desc())
        )
        latest_by_match_id: dict[str, Odds] = {}
        for odds in db.scalars(stmt):
            latest_by_match_id.setdefault(odds.match_id, odds)
        return latest_by_match_id
