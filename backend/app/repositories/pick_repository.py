from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import UserPick


class PickRepository:
    def get_by_id(self, db: Session, pick_id: str) -> UserPick | None:
        return db.scalar(select(UserPick).where(UserPick.id == pick_id))

    def get_for_user_and_match(self, db: Session, profile_id: str, match_id: str) -> UserPick | None:
        return db.scalar(
            select(UserPick).where(
                UserPick.profile_id == profile_id,
                UserPick.match_id == match_id,
            )
        )

    def list_for_user(self, db: Session, profile_id: str) -> list[UserPick]:
        return list(
            db.scalars(
                select(UserPick)
                .where(UserPick.profile_id == profile_id)
                .order_by(UserPick.created_at.desc())
            )
        )

