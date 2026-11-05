from datetime import UTC, datetime, timedelta

from fastapi import HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.datetime import ensure_utc
from app.models.entities import (
    PickSelection,
    Profile,
    VipCompetition,
    VipCompetitionKind,
    VipMembership,
    VipMembershipStatus,
    VipWeeklyMatch,
    VipWeeklyPick,
    uuid_str,
)
from app.schemas.vip import (
    AdminVipWeeklyMatchesRequest,
    AdminVipWeeklyResultsRequest,
    VipLeaderboardEntryOut,
    VipWeeklyMatchOut,
    VipWeeklyPicksRequest,
)


class WeeklyPoolService:
    """Independent ten-game picks, using the existing VIP membership and pool."""

    @staticmethod
    def _now() -> datetime:
        return datetime.now(UTC)

    @staticmethod
    def _lock_at(match: VipWeeklyMatch) -> datetime:
        return ensure_utc(match.kickoff_at) - timedelta(minutes=10)

    @staticmethod
    def _matches(db: Session, vip_id: str) -> list[VipWeeklyMatch]:
        return list(db.scalars(
            select(VipWeeklyMatch)
            .where(VipWeeklyMatch.vip_competition_id == vip_id)
            .order_by(VipWeeklyMatch.sort_order.asc())
            .execution_options(populate_existing=True)
        ))

    @staticmethod
    def _is_ready(matches: list[VipWeeklyMatch]) -> bool:
        return (
            len(matches) == 10
            and {match.sort_order for match in matches} == set(range(1, 11))
            and sum(match.is_tiebreaker for match in matches) == 1
        )

    @staticmethod
    def _vip(db: Session, vip_id: str, *, writing: bool = False) -> VipCompetition:
        statement = select(VipCompetition).where(VipCompetition.id == vip_id)
        if writing:
            statement = statement.with_for_update().execution_options(populate_existing=True)
        vip = db.scalar(statement)
        if vip is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "VIP no encontrada")
        if vip.competition_kind != VipCompetitionKind.WEEKLY_POOL:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Esta VIP no es un Quinielón Semanal")
        if writing and vip.lifecycle_status != "active":
            raise HTTPException(status.HTTP_409_CONFLICT, "El Quinielón Semanal ya está cerrado")
        return vip

    def ready(self, db: Session, vip_id: str) -> bool:
        return self._is_ready(self._matches(db, vip_id))

    def configure_matches(
        self, db: Session, vip_id: str, payload: AdminVipWeeklyMatchesRequest,
    ) -> None:
        self._vip(db, vip_id, writing=True)
        existing = self._matches(db, vip_id)
        by_id = {match.id: match for match in existing}
        by_order = {match.sort_order: match for match in existing}
        desired: list[tuple[str, int, str, str, datetime, bool]] = []
        for order, incoming in enumerate(payload.matches, start=1):
            if incoming.id is not None and incoming.id not in by_id:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "Partido del Quinielón no encontrado")
            current = by_id.get(incoming.id) if incoming.id else by_order.get(order)
            desired.append((
                current.id if current else uuid_str(), order, incoming.home_team,
                incoming.away_team, ensure_utc(incoming.kickoff_at), incoming.is_tiebreaker,
            ))
        if len({row[0] for row in desired}) != 10:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "No repitas partidos en la configuración")
        current_values = [
            (match.id, match.sort_order, match.home_team, match.away_team,
             ensure_utc(match.kickoff_at), match.is_tiebreaker)
            for match in existing
        ]
        if desired == current_values:
            db.commit()
            return
        now = self._now()
        has_picks = db.scalar(
            select(VipWeeklyPick.id)
            .join(VipWeeklyMatch, VipWeeklyMatch.id == VipWeeklyPick.match_id)
            .where(VipWeeklyMatch.vip_competition_id == vip_id)
            .limit(1)
        ) is not None
        if has_picks or any(now >= self._lock_at(match) for match in existing):
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "Los partidos y el desempate quedan fijos al recibir pronósticos o cerrar el primer partido",
            )
        if any(kickoff - timedelta(minutes=10) <= now for _, _, _, _, kickoff, _ in desired):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "Todos los partidos deben comenzar dentro de más de 10 minutos",
            )
        # No picks exist here. Reinsert atomically to allow reordering with a unique slot constraint.
        db.execute(delete(VipWeeklyMatch).where(VipWeeklyMatch.vip_competition_id == vip_id))
        db.flush()
        for match_id, order, home, away, kickoff, is_tiebreaker in desired:
            db.add(VipWeeklyMatch(
                id=match_id, vip_competition_id=vip_id, sort_order=order,
                home_team=home, away_team=away, kickoff_at=kickoff,
                is_tiebreaker=is_tiebreaker,
            ))
        db.commit()

    def save_results(
        self, db: Session, vip_id: str, payload: AdminVipWeeklyResultsRequest,
    ) -> None:
        self._vip(db, vip_id, writing=True)
        matches = self._matches(db, vip_id)
        if not self._is_ready(matches):
            raise HTTPException(status.HTTP_409_CONFLICT, "Configura los 10 partidos primero")
        by_id = {match.id: match for match in matches}
        now = self._now()
        for result in payload.results:
            match = by_id.get(result.match_id)
            if match is None:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "Partido del Quinielón no encontrado")
            if now < ensure_utc(match.kickoff_at):
                raise HTTPException(
                    status.HTTP_409_CONFLICT, "No puedes registrar resultados antes del inicio del partido",
                )
        for result in payload.results:
            match = by_id[result.match_id]
            match.home_score = result.home_score
            match.away_score = result.away_score
            db.add(match)
        db.commit()

    def save_picks(
        self, db: Session, vip_id: str, profile: Profile, payload: VipWeeklyPicksRequest,
    ) -> None:
        vip = self._vip(db, vip_id, writing=True)
        if not vip.is_active:
            raise HTTPException(status.HTTP_409_CONFLICT, "El Quinielón Semanal no está activo")
        membership = db.scalar(
            select(VipMembership)
            .where(
                VipMembership.vip_competition_id == vip_id,
                VipMembership.profile_id == profile.id,
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if membership is None or membership.status != VipMembershipStatus.APPROVED:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN, "Sólo los miembros aprobados pueden registrar pronósticos",
            )
        matches = self._matches(db, vip_id)
        if not self._is_ready(matches):
            raise HTTPException(status.HTTP_409_CONFLICT, "Configura los 10 partidos primero")
        by_id = {match.id: match for match in matches}
        now = self._now()
        for incoming in payload.picks:
            match = by_id.get(incoming.match_id)
            if match is None:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "Partido del Quinielón no encontrado")
            if now >= self._lock_at(match) or match.home_score is not None:
                raise HTTPException(
                    status.HTTP_409_CONFLICT,
                    f"El registro de {match.home_team} vs {match.away_team} ya cerró",
                )
            if match.is_tiebreaker and incoming.total_goals is None:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, "Indica el total de goles para el desempate")
            if not match.is_tiebreaker and incoming.total_goals is not None:
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST, "El total de goles sólo corresponde al partido de desempate",
                )
        existing = {
            pick.match_id: pick
            for pick in db.scalars(select(VipWeeklyPick).where(
                VipWeeklyPick.profile_id == profile.id,
                VipWeeklyPick.match_id.in_([incoming.match_id for incoming in payload.picks]),
            ))
        }
        for incoming in payload.picks:
            pick = existing.get(incoming.match_id)
            if pick is None:
                pick = VipWeeklyPick(match_id=incoming.match_id, profile_id=profile.id)
            pick.selection = incoming.selection
            pick.total_goals = incoming.total_goals
            db.add(pick)
        db.commit()

    def match_outs(
        self, db: Session, vip_id: str, profile_id: str | None = None,
    ) -> list[VipWeeklyMatchOut]:
        matches = self._matches(db, vip_id)
        picks = {
            pick.match_id: pick
            for pick in db.scalars(select(VipWeeklyPick).where(
                VipWeeklyPick.match_id.in_([match.id for match in matches]),
                VipWeeklyPick.profile_id == profile_id,
            ))
        } if profile_id is not None and matches else {}
        vip = db.get(VipCompetition, vip_id)
        disabled = vip is None or not vip.is_active or vip.lifecycle_status != "active"
        now = self._now()
        return [VipWeeklyMatchOut(
            id=match.id, sort_order=match.sort_order,
            home_team=match.home_team, away_team=match.away_team,
            kickoff_at=ensure_utc(match.kickoff_at), lock_at=self._lock_at(match),
            is_tiebreaker=match.is_tiebreaker,
            home_score=match.home_score, away_score=match.away_score,
            my_selection=picks[match.id].selection if match.id in picks else None,
            my_total_goals=picks[match.id].total_goals if match.id in picks else None,
            is_locked=disabled or now >= self._lock_at(match) or match.home_score is not None,
        ) for match in matches]

    def join_lock(self, db: Session, vip_id: str) -> dict[str, object]:
        matches = self._matches(db, vip_id)
        if not self._is_ready(matches):
            return {"locked": True, "lock_at": None, "match_label": "la configuración de los 10 partidos"}
        first_match = min(matches, key=self._lock_at)
        lock_at = self._lock_at(first_match)
        vip = db.get(VipCompetition, vip_id)
        return {
            "locked": vip is None or not vip.is_active or vip.lifecycle_status != "active" or self._now() >= lock_at,
            "lock_at": lock_at,
            "match_label": f"{first_match.home_team} vs {first_match.away_team}",
        }

    def leaderboard(
        self, db: Session, vip_id: str, approved_profile_ids: list[str],
        profile_names: dict[str, str], profile_usernames: dict[str, str | None] | None = None,
    ) -> list[VipLeaderboardEntryOut]:
        matches = self._matches(db, vip_id)
        by_id = {match.id: match for match in matches}
        points = dict.fromkeys(approved_profile_ids, 0)
        tiebreak = next((match for match in matches if match.is_tiebreaker), None)
        reveal_tiebreak = tiebreak is not None and self._now() >= self._lock_at(tiebreak)
        official_total = (
            tiebreak.home_score + tiebreak.away_score
            if tiebreak is not None and tiebreak.home_score is not None and tiebreak.away_score is not None
            else None
        )
        predictions: dict[str, int] = {}
        if points and matches:
            picks = db.scalars(select(VipWeeklyPick).where(
                VipWeeklyPick.profile_id.in_(list(points)),
                VipWeeklyPick.match_id.in_(list(by_id)),
            ))
            for pick in picks:
                match = by_id[pick.match_id]
                if match.is_tiebreaker and pick.total_goals is not None:
                    predictions[pick.profile_id] = pick.total_goals
                if match.home_score is None or match.away_score is None:
                    continue
                outcome = (
                    PickSelection.HOME if match.home_score > match.away_score
                    else PickSelection.AWAY if match.home_score < match.away_score
                    else PickSelection.DRAW
                )
                if pick.selection == outcome:
                    points[pick.profile_id] += 1
        differences = {
            profile_id: abs(prediction - official_total)
            for profile_id, prediction in predictions.items()
        } if official_total is not None and reveal_tiebreak else {}
        ordered_ids = sorted(points, key=lambda profile_id: (
            -points[profile_id], differences.get(profile_id, 10**9),
            profile_names.get(profile_id, profile_id).casefold(), profile_id,
        ))
        rows: list[VipLeaderboardEntryOut] = []
        previous_signature: tuple[int, int | None] | None = None
        rank = 0
        for index, profile_id in enumerate(ordered_ids, start=1):
            signature = (points[profile_id], differences.get(profile_id))
            if signature != previous_signature:
                rank = index
                previous_signature = signature
            rows.append(VipLeaderboardEntryOut(
                profile_id=profile_id, display_name=profile_names.get(profile_id, "Jugador"),
                username=(profile_usernames or {}).get(profile_id),
                total_points=points[profile_id], correct_results=points[profile_id],
                exact_scores=0, rank_position=rank,
                tiebreak_prediction=predictions.get(profile_id) if reveal_tiebreak else None,
                tiebreak_difference=differences.get(profile_id),
            ))
        return rows

    def validate_close(self, db: Session, vip_id: str) -> None:
        self._vip(db, vip_id, writing=True)
        matches = self._matches(db, vip_id)
        if not self._is_ready(matches) or any(
            match.home_score is None or match.away_score is None for match in matches
        ):
            raise HTTPException(
                status.HTTP_409_CONFLICT, "Registra el resultado de los 10 partidos antes de cerrar el Quinielón",
            )
