from datetime import UTC, datetime

from fastapi import HTTPException, status
from sqlalchemy import Select, select
from sqlalchemy.orm import Session

from app.models.entities import Match, MatchResult, MatchStatus, Profile, PublishedMatchday, RawMatchResult, Team
from app.schemas.admin import AdminResultRowOut, AdminResultUpdateRequest
from app.schemas.result import PublishedResultOut, ResultOut


class ResultService:
    @staticmethod
    def _resolve_winner_team_id(match: Match, home_score: int, away_score: int) -> str | None:
        if home_score > away_score:
            return match.home_team_id
        if away_score > home_score:
            return match.away_team_id
        return None

    def _validate_advancing_team_for_match(
        self,
        match: Match,
        home_score: int,
        away_score: int,
        advancing_team_id: str | None,
    ) -> str | None:
        self._ensure_match_ready_for_results(match)
        if match.stage_type in {"regular", "group"}:
            return None
        if advancing_team_id not in {match.home_team_id, match.away_team_id}:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Debes seleccionar el equipo que avanza en eliminatoria directa",
            )
        winner_team_id = self._resolve_winner_team_id(match, home_score, away_score)
        if winner_team_id is not None and winner_team_id != advancing_team_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Si no hay empate en 90 minutos, el equipo que avanza debe coincidir con el ganador",
            )
        return advancing_team_id

    @staticmethod
    def _sync_match_status_with_result(match: Match, is_official: bool) -> None:
        if is_official:
            match.status = MatchStatus.FINAL
        elif match.status == MatchStatus.FINAL:
            match.status = MatchStatus.SCHEDULED

    def list_results(self, db: Session, matchday_id: str | None = None) -> list[ResultOut]:
        stmt: Select[tuple[MatchResult, Match]] = (
            select(MatchResult, Match)
            .join(Match, Match.id == MatchResult.match_id)
            .where(MatchResult.is_official.is_(True))
            .order_by(Match.kickoff_at.asc())
        )
        if matchday_id is not None:
            stmt = stmt.where(Match.matchday_id == matchday_id)

        rows = db.execute(stmt).all()
        return [self._to_result_out(db, match_result, match) for match_result, match in rows]

    def list_published_results(self, db: Session, matchday_id: str | None = None) -> list[PublishedResultOut]:
        stmt = (
            select(MatchResult, Match, PublishedMatchday)
            .join(Match, Match.id == MatchResult.match_id)
            .join(PublishedMatchday, PublishedMatchday.matchday_id == Match.matchday_id)
            .where(MatchResult.is_official.is_(True))
            .order_by(Match.kickoff_at.asc())
        )
        if matchday_id is not None:
            stmt = stmt.where(Match.matchday_id == matchday_id)

        rows = db.execute(stmt).all()
        results: list[PublishedResultOut] = []
        for match_result, match, published in rows:
            base = self._to_result_out(db, match_result, match)
            results.append(PublishedResultOut(**base.model_dump(), published_at=published.published_at))
        return results

    def list_admin_results(self, db: Session, matchday_id: str | None = None) -> list[AdminResultRowOut]:
        stmt: Select[tuple[Match, MatchResult | None, PublishedMatchday | None]] = (
            select(Match, MatchResult, PublishedMatchday)
            .outerjoin(MatchResult, MatchResult.match_id == Match.id)
            .outerjoin(PublishedMatchday, PublishedMatchday.matchday_id == Match.matchday_id)
            .order_by(Match.kickoff_at.asc())
        )
        if matchday_id is not None:
            stmt = stmt.where(Match.matchday_id == matchday_id)

        rows = db.execute(stmt).all()
        return [self._to_admin_result_out(db, match, match_result, published) for match, match_result, published in rows]

    def save_admin_result(
        self,
        db: Session,
        match_id: str,
        payload: AdminResultUpdateRequest,
        *,
        updated_by: Profile | None = None,
    ) -> AdminResultRowOut:
        match = db.get(Match, match_id)
        if match is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Match not found")
        self._ensure_match_ready_for_results(match)

        result = db.scalar(select(MatchResult).where(MatchResult.match_id == match.id))
        if result is None:
            result = MatchResult(match_id=match.id)

        result.home_score = payload.home_score
        result.away_score = payload.away_score
        result.advancing_team_id = self._validate_advancing_team_for_match(
            match,
            payload.home_score,
            payload.away_score,
            payload.advancing_team_id,
        )
        result.is_official = payload.is_official
        result.is_manual_override = True
        result.source_provider_name = "admin_manual"
        result.source_external_id = None
        result.source_updated_at = datetime.now(UTC)
        result.last_synced_at = datetime.now(UTC)
        result.updated_by_profile_id = updated_by.id if updated_by is not None else None
        self._sync_match_status_with_result(match, payload.is_official)

        db.add(match)
        db.add(result)
        db.commit()
        db.refresh(match)
        db.refresh(result)

        published = db.scalar(
            select(PublishedMatchday).where(PublishedMatchday.matchday_id == match.matchday_id)
        )
        return self._to_admin_result_out(db, match, result, published)

    def clear_manual_override(self, db: Session, match_id: str) -> AdminResultRowOut:
        match = db.get(Match, match_id)
        if match is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Match not found")

        result = db.scalar(select(MatchResult).where(MatchResult.match_id == match.id))
        if result is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Result not found")

        latest_raw = db.scalar(
            select(RawMatchResult)
            .where(
                RawMatchResult.mapped_match_id == match.id,
                RawMatchResult.home_score.is_not(None),
                RawMatchResult.away_score.is_not(None),
            )
            .order_by(RawMatchResult.fetched_at.desc())
        )

        result.is_manual_override = False
        result.updated_by_profile_id = None

        if latest_raw is not None:
            result.home_score = int(latest_raw.home_score)
            result.away_score = int(latest_raw.away_score)
            result.is_official = latest_raw.is_official
            result.source_provider_name = latest_raw.provider_name
            result.source_external_id = latest_raw.external_match_id or latest_raw.external_result_id
            result.source_updated_at = latest_raw.source_updated_at
            result.last_synced_at = datetime.now(UTC)
            latest_raw.applied_at = datetime.now(UTC)
            db.add(latest_raw)
        else:
            result.source_provider_name = None
            result.source_external_id = None
            result.source_updated_at = None

        self._sync_match_status_with_result(match, result.is_official)

        db.add(match)
        db.add(result)
        db.commit()
        db.refresh(match)
        db.refresh(result)

        published = db.scalar(
            select(PublishedMatchday).where(PublishedMatchday.matchday_id == match.matchday_id)
        )
        return self._to_admin_result_out(db, match, result, published)

    def clear_admin_result(self, db: Session, match_id: str) -> AdminResultRowOut:
        match = db.get(Match, match_id)
        if match is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Match not found")

        result = db.scalar(select(MatchResult).where(MatchResult.match_id == match.id))
        if result is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Result not found")

        if match.status == MatchStatus.FINAL:
            match.status = MatchStatus.SCHEDULED

        db.add(match)
        db.delete(result)
        db.commit()
        db.refresh(match)

        published = db.scalar(
            select(PublishedMatchday).where(PublishedMatchday.matchday_id == match.matchday_id)
        )
        return self._to_admin_result_out(db, match, None, published)

    def _to_result_out(self, db: Session, match_result: MatchResult, match: Match) -> ResultOut:
        home_team = db.get(Team, match.home_team_id) if match.home_team_id else None
        away_team = db.get(Team, match.away_team_id) if match.away_team_id else None
        return ResultOut(
            match_id=match.id,
            matchday_id=match.matchday_id,
            home_team_name=self._participant_name(home_team, match.home_placeholder, "Local"),
            away_team_name=self._participant_name(away_team, match.away_placeholder, "Visitante"),
            home_score=match_result.home_score,
            away_score=match_result.away_score,
            advancing_team_id=match_result.advancing_team_id,
            is_official=match_result.is_official,
        )

    def _to_admin_result_out(
        self,
        db: Session,
        match: Match,
        match_result: MatchResult | None,
        published: PublishedMatchday | None,
    ) -> AdminResultRowOut:
        home_team = db.get(Team, match.home_team_id) if match.home_team_id else None
        away_team = db.get(Team, match.away_team_id) if match.away_team_id else None
        return AdminResultRowOut(
            match_id=match.id,
            matchday_id=match.matchday_id,
            home_team_id=match.home_team_id,
            home_placeholder=match.home_placeholder,
            home_team_name=self._participant_name(home_team, match.home_placeholder, "Local"),
            away_team_id=match.away_team_id,
            away_placeholder=match.away_placeholder,
            away_team_name=self._participant_name(away_team, match.away_placeholder, "Visitante"),
            stage_type=match.stage_type,
            group_label=match.group_label,
            bracket_slot=match.bracket_slot,
            kickoff_at=match.kickoff_at,
            match_status=match.status,
            home_score=match_result.home_score if match_result is not None else None,
            away_score=match_result.away_score if match_result is not None else None,
            advancing_team_id=match_result.advancing_team_id if match_result is not None else None,
            is_official=match_result.is_official if match_result is not None else False,
            is_ready_for_picks=bool(match.home_team_id and match.away_team_id),
            is_published=published is not None,
            source_provider_name=match_result.source_provider_name if match_result is not None else None,
            is_manual_override=match_result.is_manual_override if match_result is not None else False,
        )

    def _ensure_match_ready_for_results(self, match: Match) -> None:
        if match.home_team_id is not None and match.away_team_id is not None:
            return
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Este partido todavia no tiene a los dos equipos definidos",
        )

    def _participant_name(self, team: Team | None, placeholder: str | None, fallback: str) -> str:
        if team is not None:
            return team.name
        if placeholder:
            return placeholder
        return fallback
