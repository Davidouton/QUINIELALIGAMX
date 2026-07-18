from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import Profile, RoleCode, Season, SeasonMembership, SeasonVisibilityStatus


class SeasonVisibilityService:
    @staticmethod
    def can_view(db: Session, profile: Profile | None, season: Season) -> bool:
        if season.visibility_status != SeasonVisibilityStatus.TESTING:
            return True
        if profile is None:
            return False
        if profile.role_code in {RoleCode.ADMIN, RoleCode.MASTER_ADMIN}:
            return True
        return bool(
            db.scalar(
                select(SeasonMembership.id).where(
                    SeasonMembership.season_id == season.id,
                    SeasonMembership.profile_id == profile.id,
                    SeasonMembership.is_active.is_(True),
                )
            )
        )

    def require_view(self, db: Session, profile: Profile, season: Season) -> None:
        if not self.can_view(db, profile, season):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Temporada no encontrada")

    @staticmethod
    def visible_testing_season_ids(db: Session, profile: Profile | None) -> set[str]:
        if profile is None:
            return set()
        if profile.role_code in {RoleCode.ADMIN, RoleCode.MASTER_ADMIN}:
            return set(
                db.scalars(select(Season.id).where(Season.visibility_status == SeasonVisibilityStatus.TESTING))
            )
        return set(
            db.scalars(
                select(SeasonMembership.season_id)
                .join(Season, Season.id == SeasonMembership.season_id)
                .where(
                    Season.visibility_status == SeasonVisibilityStatus.TESTING,
                    SeasonMembership.profile_id == profile.id,
                    SeasonMembership.is_active.is_(True),
                )
            )
        )
