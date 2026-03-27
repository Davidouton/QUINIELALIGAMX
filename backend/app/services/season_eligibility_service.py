from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.core.datetime import ensure_utc
from app.models.entities import Matchday, Season, SeasonMembership
from app.repositories.season_membership_repository import SeasonMembershipRepository


class SeasonEligibilityService:
    def __init__(self) -> None:
        self.membership_repo = SeasonMembershipRepository()

    def get_effective_lock_at(self, db: Session, season: Season) -> datetime | None:
        if season.participants_lock_at is not None:
            return ensure_utc(season.participants_lock_at)
        if season.start_matchday_id is None:
            return None
        matchday = db.get(Matchday, season.start_matchday_id)
        if matchday is None:
            return None
        return ensure_utc(matchday.starts_at)

    def is_locked(self, db: Session, season: Season, now: datetime | None = None) -> bool:
        lock_at = self.get_effective_lock_at(db, season)
        if lock_at is None:
            return False
        current = now or datetime.now(UTC)
        return current >= lock_at

    def freeze_season_if_due(self, db: Session, season: Season, now: datetime | None = None) -> bool:
        current = now or datetime.now(UTC)
        lock_at = self.get_effective_lock_at(db, season)
        if lock_at is None or current < lock_at:
            return False

        changed = False
        for membership in self.membership_repo.list_for_season(db, season.id):
            if membership.eligible_locked_at is not None:
                continue
            membership.eligible_for_scoring = membership.is_active
            membership.eligible_locked_at = current
            self.membership_repo.save(db, membership)
            changed = True
        return changed

    def can_participate(self, db: Session, season: Season, membership: SeasonMembership | None) -> bool:
        if membership is None:
            return False
        if self.is_locked(db, season):
            return bool(membership.eligible_for_scoring)
        return bool(membership.is_active)
