from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import SeasonMembership


class SeasonMembershipRepository:
    def get_for_profile_and_season(self, db: Session, profile_id: str, season_id: str) -> SeasonMembership | None:
        return db.scalar(
            select(SeasonMembership).where(
                SeasonMembership.profile_id == profile_id,
                SeasonMembership.season_id == season_id,
            )
        )

    def list_for_season(self, db: Session, season_id: str) -> list[SeasonMembership]:
        return list(
            db.scalars(
                select(SeasonMembership)
                .where(SeasonMembership.season_id == season_id)
                .order_by(SeasonMembership.created_at.desc())
            )
        )

    def save(self, db: Session, membership: SeasonMembership) -> SeasonMembership:
        db.add(membership)
        db.flush()
        return membership
