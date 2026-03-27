from datetime import UTC, datetime

from fastapi import HTTPException, status
from sqlalchemy import Select, select
from sqlalchemy.orm import Session

from app.models.entities import Match, MatchResult, MatchStatus, Profile, PublishedMatchday, RawMatchResult, Team
from app.schemas.admin import AdminResultRowOut, AdminResultUpdateRequest
from app.schemas.result import PublishedResultOut, ResultOut


class ResultService:
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

        result = db.scalar(select(MatchResult).where(MatchResult.match_id == match.id))
        if result is None:
            result = MatchResult(match_id=match.id)

        result.home_score = payload.home_score
        result.away_score = payload.away_score
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
        home_team = db.get(Team, match.home_team_id)
        away_team = db.get(Team, match.away_team_id)
        return ResultOut(
            match_id=match.id,
            matchday_id=match.matchday_id,
            home_team_name=home_team.name if home_team else "Local",
            away_team_name=away_team.name if away_team else "Visitante",
            home_score=match_result.home_score,
            away_score=match_result.away_score,
            is_official=match_result.is_official,
        )

    def _to_admin_result_out(
        self,
        db: Session,
        match: Match,
        match_result: MatchResult | None,
        published: PublishedMatchday | None,
    ) -> AdminResultRowOut:
        home_team = db.get(Team, match.home_team_id)
        away_team = db.get(Team, match.away_team_id)
        return AdminResultRowOut(
            match_id=match.id,
            matchday_id=match.matchday_id,
            home_team_name=home_team.name if home_team else "Local",
            away_team_name=away_team.name if away_team else "Visitante",
            kickoff_at=match.kickoff_at,
            match_status=match.status,
            home_score=match_result.home_score if match_result is not None else None,
            away_score=match_result.away_score if match_result is not None else None,
            is_official=match_result.is_official if match_result is not None else False,
            is_published=published is not None,
            source_provider_name=match_result.source_provider_name if match_result is not None else None,
            is_manual_override=match_result.is_manual_override if match_result is not None else False,
        )
