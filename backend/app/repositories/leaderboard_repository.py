from sqlalchemy import Select, and_, select
from sqlalchemy.orm import Session

from app.models.entities import Matchday, Profile, SeasonMembership, StandingsMatchday, StandingsOverall


class LeaderboardRepository:
    def list_overall(self, db: Session, season_id: str | None = None) -> list[tuple[StandingsOverall, Profile]]:
        stmt: Select[tuple[StandingsOverall, Profile]] = (
            select(StandingsOverall, Profile)
            .join(Profile, Profile.id == StandingsOverall.profile_id)
            .join(
                SeasonMembership,
                and_(
                    SeasonMembership.season_id == StandingsOverall.season_id,
                    SeasonMembership.profile_id == StandingsOverall.profile_id,
                ),
            )
            .where(SeasonMembership.eligible_for_scoring.is_(True))
            .order_by(StandingsOverall.rank_position.asc(), Profile.display_name.asc())
        )
        if season_id is not None:
            stmt = stmt.where(StandingsOverall.season_id == season_id)
        return list(db.execute(stmt).all())

    def list_matchday(self, db: Session, matchday_id: str) -> list[tuple[StandingsMatchday, Profile]]:
        stmt: Select[tuple[StandingsMatchday, Profile]] = (
            select(StandingsMatchday, Profile)
            .join(Profile, Profile.id == StandingsMatchday.profile_id)
            .join(Matchday, Matchday.id == StandingsMatchday.matchday_id)
            .join(
                SeasonMembership,
                and_(
                    SeasonMembership.season_id == Matchday.season_id,
                    SeasonMembership.profile_id == StandingsMatchday.profile_id,
                ),
            )
            .where(StandingsMatchday.matchday_id == matchday_id)
            .where(SeasonMembership.eligible_for_scoring.is_(True))
            .order_by(StandingsMatchday.rank_position.asc(), Profile.display_name.asc())
        )
        return list(db.execute(stmt).all())

    def list_profile_matchdays(
        self,
        db: Session,
        profile_id: str,
        season_id: str,
    ) -> list[tuple[Matchday, StandingsMatchday | None]]:
        stmt: Select[tuple[Matchday, StandingsMatchday | None]] = (
            select(Matchday, StandingsMatchday)
            .outerjoin(
                StandingsMatchday,
                and_(
                    StandingsMatchday.matchday_id == Matchday.id,
                    StandingsMatchday.profile_id == profile_id,
                ),
            )
            .where(Matchday.season_id == season_id)
            .order_by(Matchday.number.asc())
        )
        return list(db.execute(stmt).all())
