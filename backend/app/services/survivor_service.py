from collections import defaultdict
from datetime import UTC, datetime

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.datetime import ensure_utc
from app.models.entities import (
    Competition,
    Match,
    MatchResult,
    MatchStatus,
    Matchday,
    MatchdayStatus,
    Profile,
    Season,
    SurvivorMembership,
    SurvivorPick,
    Team,
)
from app.schemas.survivor import (
    SurvivorAvailableTeamOut,
    SurvivorBoardOut,
    SurvivorCurrentMatchdayOut,
    SurvivorLeaderboardEntryOut,
    SurvivorMembershipOut,
    SurvivorPickOut,
    SurvivorPickUpsertRequest,
    SurvivorSeasonSummaryOut,
)
from app.services.season_eligibility_service import SeasonEligibilityService


class SurvivorService:
    def __init__(self) -> None:
        self.season_eligibility_service = SeasonEligibilityService()

    def get_board(self, db: Session, season_id: str, profile: Profile) -> SurvivorBoardOut:
        season = self._get_enabled_season(db, season_id)
        board_bundle = self._build_board_bundle(db, season)
        membership = next(
            (row for row in board_bundle["memberships"] if row.profile_id == profile.id),
            None,
        )
        my_picks = board_bundle["picks_by_profile"].get(profile.id, [])
        membership_out = self._build_membership_out(
            membership=membership,
            season=season,
            picks=my_picks,
            pick_views=board_bundle["pick_views_by_profile"].get(profile.id, []),
            current_matchday_id=board_bundle["current_matchday"].id if board_bundle["current_matchday"] is not None else None,
        )
        available_teams = self._build_available_teams(
            season=season,
            current_matchday=board_bundle["current_matchday"],
            membership=membership_out,
            current_pick=membership_out.current_pick if membership_out is not None else None,
            matches_by_matchday=board_bundle["matches_by_matchday"],
            teams_by_id=board_bundle["teams_by_id"],
        )

        return SurvivorBoardOut(
            season=self._build_season_summary(
                season,
                board_bundle["competition"],
                len(board_bundle["memberships"]),
                self._registration_open(db, season),
            ),
            current_matchday=(
                SurvivorCurrentMatchdayOut(
                    id=board_bundle["current_matchday"].id,
                    number=board_bundle["current_matchday"].number,
                    name=board_bundle["current_matchday"].name,
                    starts_at=board_bundle["current_matchday"].starts_at,
                    ends_at=board_bundle["current_matchday"].ends_at,
                )
                if board_bundle["current_matchday"] is not None
                else None
            ),
            my_membership=membership_out,
            my_picks=board_bundle["pick_views_by_profile"].get(profile.id, []),
            available_teams=available_teams,
            leaderboard=board_bundle["leaderboard"],
        )

    def join_season(self, db: Session, season_id: str, profile: Profile) -> SurvivorBoardOut:
        season = self._get_enabled_season(db, season_id)
        if not self._registration_open(db, season):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="La ventana de inscripcion para survivor ya cerro",
            )

        membership = db.scalar(
            select(SurvivorMembership).where(
                SurvivorMembership.season_id == season.id,
                SurvivorMembership.profile_id == profile.id,
            )
        )
        now = datetime.now(UTC)
        if membership is None:
            membership = SurvivorMembership(
                season_id=season.id,
                profile_id=profile.id,
                is_active=True,
                joined_at=now,
            )
        else:
            membership.is_active = True
            if membership.joined_at is None:
                membership.joined_at = now
        db.add(membership)
        db.commit()
        return self.get_board(db, season.id, profile)

    def upsert_pick(self, db: Session, payload: SurvivorPickUpsertRequest, profile: Profile) -> SurvivorBoardOut:
        season = self._get_enabled_season(db, payload.season_id)
        membership = db.scalar(
            select(SurvivorMembership).where(
                SurvivorMembership.season_id == season.id,
                SurvivorMembership.profile_id == profile.id,
                SurvivorMembership.is_active.is_(True),
            )
        )
        if membership is None:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Primero debes inscribirte al survivor")

        board_bundle = self._build_board_bundle(db, season)
        current_matchday = board_bundle["current_matchday"]
        if current_matchday is None or current_matchday.id != payload.matchday_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Solo puedes capturar pick en la jornada actual de survivor",
            )

        membership_out = self._build_membership_out(
            membership=membership,
            season=season,
            picks=board_bundle["picks_by_profile"].get(profile.id, []),
            pick_views=board_bundle["pick_views_by_profile"].get(profile.id, []),
            current_matchday_id=current_matchday.id,
        )
        if membership_out is None or not membership_out.alive:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Ya no tienes vidas disponibles")

        current_pick = membership_out.current_pick
        used_team_ids = set(membership_out.used_team_ids)
        if current_pick is not None:
            used_team_ids.discard(current_pick.team_id)
        if payload.team_id in used_team_ids:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Ese equipo ya fue utilizado en esta temporada de survivor",
            )

        matches = board_bundle["matches_by_matchday"].get(current_matchday.id, [])
        selected_match = next(
            (
                match
                for match in matches
                if payload.team_id in {match.home_team_id, match.away_team_id}
            ),
            None,
        )
        if selected_match is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="El equipo seleccionado no juega en la jornada actual",
            )
        if self._is_match_locked(selected_match):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="El partido seleccionado ya cerro para survivor",
            )

        pick = db.scalar(
            select(SurvivorPick).where(
                SurvivorPick.season_id == season.id,
                SurvivorPick.profile_id == profile.id,
                SurvivorPick.matchday_id == current_matchday.id,
            )
        )
        if pick is None:
            pick = SurvivorPick(
                season_id=season.id,
                profile_id=profile.id,
                matchday_id=current_matchday.id,
                match_id=selected_match.id,
                team_id=payload.team_id,
            )
        else:
            pick.match_id = selected_match.id
            pick.team_id = payload.team_id
        db.add(pick)
        db.commit()
        return self.get_board(db, season.id, profile)

    def _build_board_bundle(self, db: Session, season: Season) -> dict[str, object]:
        competition = db.get(Competition, season.competition_id) if season.competition_id else None
        matchdays = list(
            db.scalars(
                select(Matchday)
                .where(Matchday.season_id == season.id)
                .order_by(Matchday.number.asc(), Matchday.starts_at.asc())
            )
        )
        matches = list(
            db.scalars(
                select(Match)
                .join(Matchday, Match.matchday_id == Matchday.id)
                .where(Matchday.season_id == season.id)
                .order_by(Match.kickoff_at.asc())
            )
        )
        results = list(
            db.scalars(
                select(MatchResult)
                .join(Match, MatchResult.match_id == Match.id)
                .join(Matchday, Match.matchday_id == Matchday.id)
                .where(Matchday.season_id == season.id)
            )
        )
        memberships = list(
            db.scalars(
                select(SurvivorMembership)
                .where(
                    SurvivorMembership.season_id == season.id,
                    SurvivorMembership.is_active.is_(True),
                )
                .order_by(SurvivorMembership.created_at.asc())
            )
        )
        picks = list(
            db.scalars(
                select(SurvivorPick)
                .where(SurvivorPick.season_id == season.id)
                .order_by(SurvivorPick.created_at.asc())
            )
        )
        team_ids = {
            team_id
            for match in matches
            for team_id in (match.home_team_id, match.away_team_id)
            if team_id is not None
        } | {pick.team_id for pick in picks}
        teams = list(db.scalars(select(Team).where(Team.id.in_(team_ids)))) if team_ids else []
        teams_by_id = {team.id: team for team in teams}
        matchdays_by_id = {matchday.id: matchday for matchday in matchdays}
        matches_by_id = {match.id: match for match in matches}
        matches_by_matchday: dict[str, list[Match]] = defaultdict(list)
        for match in matches:
            matches_by_matchday[match.matchday_id].append(match)
        current_matchday = self._resolve_current_matchday(matchdays, matches_by_matchday)
        results_by_match_id = {result.match_id: result for result in results}
        picks_by_profile: dict[str, list[SurvivorPick]] = defaultdict(list)
        for pick in picks:
            picks_by_profile[pick.profile_id].append(pick)

        pick_views_by_profile: dict[str, list[SurvivorPickOut]] = {}
        leaderboard_rows: list[tuple[SurvivorMembership, SurvivorMembershipOut]] = []
        for membership in memberships:
            membership_picks = picks_by_profile.get(membership.profile_id, [])
            pick_views = [
                self._build_pick_out(
                    pick,
                    matchdays_by_id=matchdays_by_id,
                    matches_by_id=matches_by_id,
                    teams_by_id=teams_by_id,
                    results_by_match_id=results_by_match_id,
                )
                for pick in membership_picks
            ]
            pick_views_by_profile[membership.profile_id] = pick_views
            membership_out = self._build_membership_out(
                membership=membership,
                season=season,
                picks=membership_picks,
                pick_views=pick_views,
                current_matchday_id=current_matchday.id if current_matchday is not None else None,
            )
            if membership_out is not None:
                leaderboard_rows.append((membership, membership_out))

        profiles_by_id = {
            row.id: row
            for row in db.scalars(
                select(Profile).where(Profile.id.in_([membership.profile_id for membership in memberships]))
            )
        } if memberships else {}

        leaderboard = [
            SurvivorLeaderboardEntryOut(
                profile_id=membership.profile_id,
                display_name=profiles_by_id.get(membership.profile_id).display_name
                if profiles_by_id.get(membership.profile_id) is not None
                else "Participante",
                remaining_lives=membership_out.remaining_lives,
                lives_spent=membership_out.lives_spent,
                total_picks=len(pick_views_by_profile.get(membership.profile_id, [])),
                alive=membership_out.alive,
                last_pick_team_name=(
                    pick_views_by_profile[membership.profile_id][-1].team_name
                    if pick_views_by_profile.get(membership.profile_id)
                    else None
                ),
            )
            for membership, membership_out in sorted(
                leaderboard_rows,
                key=lambda row: (
                    0 if row[1].alive else 1,
                    -row[1].remaining_lives,
                    row[1].lives_spent,
                    -len(pick_views_by_profile.get(row[0].profile_id, [])),
                    row[0].joined_at or datetime.min.replace(tzinfo=UTC),
                ),
            )
        ]

        return {
            "competition": competition,
            "matchdays": matchdays,
            "matches_by_matchday": matches_by_matchday,
            "matches_by_id": matches_by_id,
            "teams_by_id": teams_by_id,
            "memberships": memberships,
            "picks_by_profile": picks_by_profile,
            "pick_views_by_profile": pick_views_by_profile,
            "leaderboard": leaderboard,
            "current_matchday": current_matchday,
        }

    def _build_season_summary(
        self,
        season: Season,
        competition: Competition | None,
        total_entries: int,
        registration_open: bool,
    ) -> SurvivorSeasonSummaryOut:
        return SurvivorSeasonSummaryOut(
            season_id=season.id,
            season_name=season.name,
            competition_id=season.competition_id,
            competition_name=competition.name if competition is not None else None,
            survivor_enabled=self._is_survivor_available_for_season(season),
            survivor_name=season.survivor_name or "Survivor",
            survivor_max_lives=max(1, season.survivor_max_lives),
            registration_lock_at=self._get_registration_lock(season),
            registration_open=registration_open,
            total_entries=total_entries,
        )

    def _build_membership_out(
        self,
        *,
        membership: SurvivorMembership | None,
        season: Season,
        picks: list[SurvivorPick],
        pick_views: list[SurvivorPickOut],
        current_matchday_id: str | None,
    ) -> SurvivorMembershipOut | None:
        if membership is None:
            return None
        lives_spent = sum(1 for pick_view in pick_views if pick_view.result_status == "lost")
        max_lives = max(1, season.survivor_max_lives)
        remaining_lives = max(max_lives - lives_spent, 0)
        used_team_ids = [pick.team_id for pick in picks]
        used_team_names = [pick_view.team_name for pick_view in pick_views]
        current_pick = next(
            (pick_view for pick_view in pick_views if pick_view.matchday_id == current_matchday_id),
            None,
        )
        return SurvivorMembershipOut(
            season_id=season.id,
            is_active=bool(membership.is_active),
            joined_at=membership.joined_at,
            max_lives=max_lives,
            remaining_lives=remaining_lives,
            lives_spent=lives_spent,
            alive=remaining_lives > 0,
            used_team_ids=used_team_ids,
            used_team_names=used_team_names,
            current_pick=current_pick,
        )

    def _build_pick_out(
        self,
        pick: SurvivorPick,
        *,
        matchdays_by_id: dict[str, Matchday],
        matches_by_id: dict[str, Match],
        teams_by_id: dict[str, Team],
        results_by_match_id: dict[str, MatchResult],
    ) -> SurvivorPickOut:
        matchday = matchdays_by_id[pick.matchday_id]
        match = matches_by_id[pick.match_id]
        selected_team = teams_by_id[pick.team_id]
        opponent_team_id = match.away_team_id if pick.team_id == match.home_team_id else match.home_team_id
        opponent_team = teams_by_id.get(opponent_team_id) if opponent_team_id else None
        result = results_by_match_id.get(pick.match_id)
        result_status = self._resolve_pick_result_status(pick, match, result)
        return SurvivorPickOut(
            id=pick.id,
            matchday_id=pick.matchday_id,
            matchday_number=matchday.number,
            matchday_name=matchday.name,
            match_id=pick.match_id,
            team_id=pick.team_id,
            team_name=selected_team.name,
            team_short_name=selected_team.short_name,
            team_crest_url=selected_team.crest_url,
            opponent_team_name=opponent_team.name if opponent_team is not None else "Pendiente",
            opponent_team_short_name=opponent_team.short_name if opponent_team is not None else "PEN",
            opponent_team_crest_url=opponent_team.crest_url if opponent_team is not None else None,
            kickoff_at=match.kickoff_at,
            result_status=result_status,
            consumed_life=result_status == "lost",
            created_at=pick.created_at,
            updated_at=pick.updated_at,
        )

    def _build_available_teams(
        self,
        *,
        season: Season,
        current_matchday: Matchday | None,
        membership: SurvivorMembershipOut | None,
        current_pick: SurvivorPickOut | None,
        matches_by_matchday: dict[str, list[Match]],
        teams_by_id: dict[str, Team],
    ) -> list[SurvivorAvailableTeamOut]:
        if current_matchday is None or membership is None or not membership.alive:
            return []
        used_team_ids = set(membership.used_team_ids)
        if current_pick is not None:
            used_team_ids.discard(current_pick.team_id)
        rows: list[SurvivorAvailableTeamOut] = []
        for match in matches_by_matchday.get(current_matchday.id, []):
            for selected_team_id, opponent_team_id in (
                (match.home_team_id, match.away_team_id),
                (match.away_team_id, match.home_team_id),
            ):
                if selected_team_id is None or opponent_team_id is None:
                    continue
                selected_team = teams_by_id.get(selected_team_id)
                opponent_team = teams_by_id.get(opponent_team_id)
                if selected_team is None or opponent_team is None:
                    continue
                already_used = selected_team_id in used_team_ids
                if already_used:
                    continue
                rows.append(
                    SurvivorAvailableTeamOut(
                        team_id=selected_team_id,
                        team_name=selected_team.name,
                        team_short_name=selected_team.short_name,
                        team_crest_url=selected_team.crest_url,
                        opponent_team_id=opponent_team_id,
                        opponent_team_name=opponent_team.name,
                        opponent_team_short_name=opponent_team.short_name,
                        opponent_team_crest_url=opponent_team.crest_url,
                        match_id=match.id,
                        kickoff_at=match.kickoff_at,
                        is_locked=self._is_match_locked(match),
                        already_used=False,
                        is_current_pick=current_pick.team_id == selected_team_id if current_pick is not None else False,
                    )
                )
        return sorted(rows, key=lambda row: (row.is_locked, row.kickoff_at, row.team_name))

    def _resolve_current_matchday(
        self,
        matchdays: list[Matchday],
        matches_by_matchday: dict[str, list[Match]],
    ) -> Matchday | None:
        if not matchdays:
            return None
        active_matchday = next((row for row in matchdays if row.status == MatchdayStatus.ACTIVE), None)
        if active_matchday is not None:
            return active_matchday

        now = datetime.now(UTC)
        upcoming_candidates = [
            matchday
            for matchday in matchdays
            if any(ensure_utc(match.kickoff_at) >= now for match in matches_by_matchday.get(matchday.id, []))
            and matchday.status in {MatchdayStatus.DRAFT, MatchdayStatus.ACTIVE, MatchdayStatus.CLOSED}
        ]
        if upcoming_candidates:
            return min(upcoming_candidates, key=lambda row: ensure_utc(row.starts_at))
        return matchdays[-1]

    def _get_enabled_season(self, db: Session, season_id: str) -> Season:
        season = db.get(Season, season_id)
        if season is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Temporada no encontrada")
        if not self._is_survivor_available_for_season(season):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Survivor no habilitado en esta temporada")
        return season

    @staticmethod
    def _is_survivor_available_for_season(season: Season) -> bool:
        return season.tournament_format == "standard" or bool(season.survivor_enabled)

    def _registration_open(self, db: Session, season: Season) -> bool:
        lock_at = self._get_registration_lock(season)
        if lock_at is None:
            lock_at = self.season_eligibility_service.get_effective_lock_at(db, season)
        if lock_at is None:
            return True
        return datetime.now(UTC) < ensure_utc(lock_at)

    @staticmethod
    def _get_registration_lock(season: Season) -> datetime | None:
        return ensure_utc(season.survivor_registration_lock_at) if season.survivor_registration_lock_at else None

    @staticmethod
    def _is_match_locked(match: Match) -> bool:
        return (
            datetime.now(UTC) >= ensure_utc(match.picks_lock_at)
            or match.status in {MatchStatus.FINAL, MatchStatus.CANCELLED}
        )

    @staticmethod
    def _resolve_pick_result_status(
        pick: SurvivorPick,
        match: Match,
        result: MatchResult | None,
    ) -> str:
        if result is None or match.status != MatchStatus.FINAL:
            return "pending"
        if result.home_score == result.away_score:
            return "draw"
        winner_team_id = match.home_team_id if result.home_score > result.away_score else match.away_team_id
        if winner_team_id == pick.team_id:
            return "won"
        return "lost"
