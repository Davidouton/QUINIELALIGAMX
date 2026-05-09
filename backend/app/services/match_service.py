from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.match_keys import build_match_key
from app.core.datetime import ensure_utc
from app.models.entities import Match, MatchStageType, Matchday, Odds, Team, WorldCupGroup, WorldCupGroupTeam
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
        inferred_group_labels = self._infer_group_labels(db, matches)
        return [
            self._to_match_out(
                db,
                match,
                latest_odds_by_match_id.get(match.id),
                inferred_group_label=inferred_group_labels.get(match.id),
            )
            for match in matches
        ]

    def get_match(self, db: Session, match_id: str) -> MatchOut | None:
        match = self.repo.get_by_id(db, match_id)
        if match is None:
            return None
        latest_odds_by_match_id = self.odds_repo.list_latest_by_match_ids(db, [match.id])
        inferred_group_labels = self._infer_group_labels(db, [match])
        return self._to_match_out(
            db,
            match,
            latest_odds_by_match_id.get(match.id),
            inferred_group_label=inferred_group_labels.get(match.id),
        )

    def _to_match_out(
        self,
        db: Session,
        match: Match,
        odds: Odds | None = None,
        *,
        inferred_group_label: str | None = None,
    ) -> MatchOut:
        home_team = db.get(Team, match.home_team_id) if match.home_team_id else None
        away_team = db.get(Team, match.away_team_id) if match.away_team_id else None
        now = datetime.now(UTC)
        home_probability, draw_probability, away_probability = self._build_devigged_probabilities(odds)
        is_ready_for_picks = match.home_team_id is not None and match.away_team_id is not None
        return MatchOut(
            id=match.id,
            matchday_id=match.matchday_id,
            external_id=match.external_id,
            match_key=build_match_key(
                self._build_participant_slug(home_team, match.home_placeholder, "home"),
                self._build_participant_slug(away_team, match.away_placeholder, "away"),
                match.kickoff_at,
            ),
            home_team_id=match.home_team_id,
            away_team_id=match.away_team_id,
            stage_type=match.stage_type,
            group_label=match.group_label or inferred_group_label,
            bracket_slot=match.bracket_slot,
            home_placeholder=match.home_placeholder,
            away_placeholder=match.away_placeholder,
            home_team_name=self._build_participant_name(home_team, match.home_placeholder, "Local"),
            away_team_name=self._build_participant_name(away_team, match.away_placeholder, "Visitante"),
            kickoff_at=match.kickoff_at,
            picks_lock_at=match.picks_lock_at,
            status=match.status,
            venue=match.venue,
            is_locked=now >= ensure_utc(match.picks_lock_at),
            is_ready_for_picks=is_ready_for_picks,
            odds_provider_name=odds.provider_name if odds else None,
            home_win_probability=home_probability,
            draw_probability=draw_probability,
            away_win_probability=away_probability,
        )

    def _infer_group_labels(self, db: Session, matches: list[Match]) -> dict[str, str]:
        unresolved_group_matches = [
            match
            for match in matches
            if (
                match.stage_type == MatchStageType.GROUP
                and not match.group_label
                and match.home_team_id is not None
                and match.away_team_id is not None
            )
        ]
        if not unresolved_group_matches:
            return {}

        matchday_ids = {match.matchday_id for match in unresolved_group_matches}
        season_id_by_matchday_id = dict(
            db.execute(
                select(Matchday.id, Matchday.season_id).where(Matchday.id.in_(matchday_ids))
            ).all()
        )
        season_ids = {season_id for season_id in season_id_by_matchday_id.values()}
        if not season_ids:
            return {}

        groups = list(
            db.scalars(select(WorldCupGroup).where(WorldCupGroup.season_id.in_(season_ids)))
        )
        if not groups:
            return {}

        group_label_by_group_id = {group.id: group.group_label for group in groups}
        season_id_by_group_id = {group.id: group.season_id for group in groups}
        team_links = list(
            db.scalars(
                select(WorldCupGroupTeam).where(WorldCupGroupTeam.group_id.in_(group_label_by_group_id))
            )
        )
        if not team_links:
            return {}

        group_label_by_season_and_team_id: dict[tuple[str, str], str] = {}
        for link in team_links:
            season_id = season_id_by_group_id.get(link.group_id)
            group_label = group_label_by_group_id.get(link.group_id)
            if season_id and group_label:
                group_label_by_season_and_team_id[(season_id, link.team_id)] = group_label

        inferred_labels: dict[str, str] = {}
        for match in unresolved_group_matches:
            season_id = season_id_by_matchday_id.get(match.matchday_id)
            if not season_id or not match.home_team_id or not match.away_team_id:
                continue
            home_group = group_label_by_season_and_team_id.get((season_id, match.home_team_id))
            away_group = group_label_by_season_and_team_id.get((season_id, match.away_team_id))
            if home_group and home_group == away_group:
                inferred_labels[match.id] = home_group
        return inferred_labels

    def _build_participant_name(self, team: Team | None, placeholder: str | None, fallback: str) -> str:
        if team is not None:
            return team.name
        if placeholder:
            return placeholder
        return fallback

    def _build_participant_slug(self, team: Team | None, placeholder: str | None, fallback: str) -> str | None:
        if team is not None:
            return team.slug
        if placeholder:
            return placeholder.lower().replace(" ", "-")
        return fallback

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
