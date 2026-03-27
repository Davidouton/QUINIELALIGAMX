from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy.orm import Session

from app.core.match_keys import build_match_key
from app.core.datetime import ensure_utc
from app.models.entities import Match, Odds, Team
from app.repositories.match_repository import MatchRepository
from app.repositories.odds_repository import OddsRepository
from app.schemas.match import MatchOut


class MatchService:
    def __init__(self) -> None:
        self.repo = MatchRepository()
        self.odds_repo = OddsRepository()

    def list_matches(self, db: Session, matchday_id: str | None = None) -> list[MatchOut]:
        matches = self.repo.list_matches(db, matchday_id=matchday_id)
        latest_odds_by_match_id = self.odds_repo.list_latest_by_match_ids(
            db,
            [match.id for match in matches],
        )
        return [self._to_match_out(db, match, latest_odds_by_match_id.get(match.id)) for match in matches]

    def get_match(self, db: Session, match_id: str) -> MatchOut | None:
        match = self.repo.get_by_id(db, match_id)
        if match is None:
            return None
        latest_odds_by_match_id = self.odds_repo.list_latest_by_match_ids(db, [match.id])
        return self._to_match_out(db, match, latest_odds_by_match_id.get(match.id))

    def _to_match_out(self, db: Session, match: Match, odds: Odds | None = None) -> MatchOut:
        home_team = db.get(Team, match.home_team_id)
        away_team = db.get(Team, match.away_team_id)
        now = datetime.now(UTC)
        home_probability, draw_probability, away_probability = self._build_devigged_probabilities(odds)
        return MatchOut(
            id=match.id,
            matchday_id=match.matchday_id,
            external_id=match.external_id,
            match_key=build_match_key(
                home_team.slug if home_team else None,
                away_team.slug if away_team else None,
                match.kickoff_at,
            ),
            home_team_id=match.home_team_id,
            away_team_id=match.away_team_id,
            home_team_name=home_team.name if home_team else "Local",
            away_team_name=away_team.name if away_team else "Visitante",
            kickoff_at=match.kickoff_at,
            picks_lock_at=match.picks_lock_at,
            status=match.status,
            venue=match.venue,
            is_locked=now >= ensure_utc(match.picks_lock_at),
            odds_provider_name=odds.provider_name if odds else None,
            home_win_probability=home_probability,
            draw_probability=draw_probability,
            away_win_probability=away_probability,
        )

    def _build_devigged_probabilities(
        self,
        odds: Odds | None,
    ) -> tuple[float | None, float | None, float | None]:
        if (
            odds is None
            or odds.home_value is None
            or odds.draw_value is None
            or odds.away_value is None
        ):
            return None, None, None

        raw_home = self._odds_to_implied_probability(odds.home_value)
        raw_draw = self._odds_to_implied_probability(odds.draw_value)
        raw_away = self._odds_to_implied_probability(odds.away_value)

        if raw_home is None or raw_draw is None or raw_away is None:
            return None, None, None

        total = raw_home + raw_draw + raw_away

        if total <= 0:
            return None, None, None

        return (
            float(raw_home / total),
            float(raw_draw / total),
            float(raw_away / total),
        )

    def _odds_to_implied_probability(self, value: Decimal | None) -> Decimal | None:
        if value is None:
            return None

        if value >= Decimal("100"):
            return Decimal("100") / (value + Decimal("100"))

        if value <= Decimal("-100"):
            absolute_value = abs(value)
            return absolute_value / (absolute_value + Decimal("100"))

        if value > Decimal("1"):
            return Decimal("1") / value

        return None
