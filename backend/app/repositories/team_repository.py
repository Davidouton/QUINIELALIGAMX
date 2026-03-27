from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import Team


class TeamRepository:
    def list_all(self, db: Session) -> list[Team]:
        stmt = select(Team).order_by(Team.name.asc())
        return list(db.scalars(stmt))

    def get_by_id(self, db: Session, team_id: str) -> Team | None:
        return db.scalar(select(Team).where(Team.id == team_id))

    def create(self, db: Session, team: Team) -> Team:
        db.add(team)
        db.flush()
        return team

    def save(self, db: Session, team: Team) -> Team:
        db.add(team)
        db.flush()
        return team
