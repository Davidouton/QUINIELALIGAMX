from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation

from fastapi import HTTPException, status
from sqlalchemy import Select, and_, select
from sqlalchemy.orm import Session

from app.core.datetime import ensure_utc
from app.models.entities import Competition, Match, MatchResult, Matchday, Odds, PickSelection, Profile, ScoringRule, Season, SeasonMembership, Team, UserPick
from app.repositories.match_repository import MatchRepository
from app.repositories.odds_repository import OddsRepository
from app.repositories.pick_repository import PickRepository
from app.repositories.season_membership_repository import SeasonMembershipRepository
from app.schemas.admin import AdminPickOverrideRequest, AdminPickRowOut
from app.schemas.pick import GlobalPickBoardOut, GlobalPickCellOut, GlobalPickMatchOut, GlobalPickPlayerOut, PickCreate, PickOut, PickResultRowOut, PickUpdate
from app.services.season_eligibility_service import SeasonEligibilityService


class PickService:
    def __init__(self) -> None:
        self.match_repo = MatchRepository()
        self.odds_repo = OddsRepository()
        self.pick_repo = PickRepository()
        self.membership_repo = SeasonMembershipRepository()
        self.eligibility_service = SeasonEligibilityService()

    def create_pick(self, db: Session, profile: Profile, payload: PickCreate) -> PickOut:
        match = self._get_open_match(db, payload.match_id)
        self._ensure_profile_can_pick(db, profile, match)
        self._validate_pick_payload(db, match, payload)
        advancing_team_id = self._validate_advancing_team_for_match(match, payload)
        spread_selection, spread_line_value = self._resolve_spread_pick(db, match, payload)
        pick = self.pick_repo.get_for_user_and_match(db, profile.id, payload.match_id)
        if pick is None:
            pick = UserPick(
                profile_id=profile.id,
                match_id=payload.match_id,
                selection=payload.selection,
                spread_selection=spread_selection,
                spread_line_value=spread_line_value,
                predicted_home_score=payload.predicted_home_score,
                predicted_away_score=payload.predicted_away_score,
                advancing_team_id=advancing_team_id,
            )
        else:
            pick.selection = payload.selection
            pick.spread_selection = spread_selection
            pick.spread_line_value = spread_line_value
            pick.predicted_home_score = payload.predicted_home_score
            pick.predicted_away_score = payload.predicted_away_score
            pick.advancing_team_id = advancing_team_id

        self._clear_admin_override(pick)
        db.add(pick)

        db.commit()
        db.refresh(pick)
        return self._build_pick_out(db, pick, match=match)

    def update_pick(self, db: Session, profile: Profile, pick_id: str, payload: PickUpdate) -> PickOut:
        pick = self.pick_repo.get_by_id(db, pick_id)
        if pick is None or pick.profile_id != profile.id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pick not found")

        match = self._get_open_match(db, pick.match_id)
        self._ensure_profile_can_pick(db, profile, match)
        self._validate_pick_payload(db, match, payload)
        advancing_team_id = self._validate_advancing_team_for_match(match, payload)
        spread_selection, spread_line_value = self._resolve_spread_pick(db, match, payload)
        pick.selection = payload.selection
        pick.spread_selection = spread_selection
        pick.spread_line_value = spread_line_value
        pick.predicted_home_score = payload.predicted_home_score
        pick.predicted_away_score = payload.predicted_away_score
        pick.advancing_team_id = advancing_team_id
        self._clear_admin_override(pick)
        db.add(pick)
        db.commit()
        db.refresh(pick)
        return self._build_pick_out(db, pick, match=match)

    def list_my_picks(self, db: Session, profile: Profile, matchday_id: str | None = None) -> list[PickOut]:
        stmt: Select[tuple[UserPick, Match]] = (
            select(UserPick, Match)
            .join(Match, Match.id == UserPick.match_id)
            .where(UserPick.profile_id == profile.id)
            .order_by(Match.kickoff_at.asc())
        )
        if matchday_id is not None:
            stmt = stmt.where(Match.matchday_id == matchday_id)

        rows = db.execute(stmt).all()
        return [self._build_pick_out(db, pick, match) for pick, match in rows]

    def list_my_pick_results(
        self,
        db: Session,
        profile: Profile,
        matchday_id: str | None = None,
    ) -> list[PickResultRowOut]:
        stmt: Select[tuple[Match, UserPick | None, MatchResult | None]] = (
            select(Match, UserPick, MatchResult)
            .outerjoin(
                UserPick,
                and_(
                    UserPick.match_id == Match.id,
                    UserPick.profile_id == profile.id,
                ),
            )
            .outerjoin(MatchResult, MatchResult.match_id == Match.id)
            .order_by(Match.kickoff_at.asc())
        )
        if matchday_id is not None:
            stmt = stmt.where(Match.matchday_id == matchday_id)

        rules = self._load_rules(db)
        rows = db.execute(stmt).all()
        teams = self._load_teams(db, [match for match, _, _ in rows])
        override_profiles = self._load_override_profiles(
            db,
            [
                pick.overridden_by_profile_id
                for _, pick, _ in rows
                if pick is not None and pick.overridden_by_profile_id is not None
            ],
        )
        matchday_season_ids = self._load_season_ids_by_matchday(db, [match.matchday_id for match, _, _ in rows])
        season_cache = self._load_seasons(db, matchday_season_ids.values())
        competition_cache = self._load_competitions(
            db,
            [
                season.competition_id
                for season in season_cache.values()
                if season is not None and season.competition_id is not None
            ],
        )

        result_rows: list[PickResultRowOut] = []
        for match, pick, result in rows:
            home_team = teams.get(match.home_team_id)
            away_team = teams.get(match.away_team_id)
            season = season_cache.get(matchday_season_ids.get(match.matchday_id))
            competition = (
                competition_cache.get(season.competition_id)
                if season is not None and season.competition_id is not None
                else None
            )
            is_nfl_match = self._is_nfl_competition(competition)
            is_official = bool(
                result
                and result.is_official
                and result.home_score is not None
                and result.away_score is not None
            )

            result_points = 0
            exact_score_points = 0
            advancing_team_points = 0
            spread_points = 0
            if pick is not None and is_official and result is not None:
                winner = self._resolve_winner(result.home_score, result.away_score)
                result_points = rules["result_correct"] if pick.selection == winner else 0
                exact_score_points = 0
                if not is_nfl_match:
                    exact_score_points = (
                        rules["exact_score"]
                        if pick.predicted_home_score == result.home_score
                        and pick.predicted_away_score == result.away_score
                        else 0
                    )
                advancing_team_points = (
                    rules["advancing_team"]
                    if match.stage_type != "group"
                    and match.stage_type != "regular"
                    and pick.advancing_team_id is not None
                    and pick.advancing_team_id == result.advancing_team_id
                    else 0
                )
                if is_nfl_match:
                    spread_points = self._calculate_spread_points(
                        result.home_score,
                        result.away_score,
                        pick.spread_selection,
                        pick.spread_line_value,
                        rules["spread_correct"],
                    )

            result_rows.append(
                PickResultRowOut(
                    match_id=match.id,
                    matchday_id=match.matchday_id,
                    home_team_name=home_team.name if home_team else match.home_placeholder or "Local",
                    home_team_crest_url=home_team.crest_url if home_team else None,
                    away_team_name=away_team.name if away_team else match.away_placeholder or "Visitante",
                    away_team_crest_url=away_team.crest_url if away_team else None,
                    kickoff_at=match.kickoff_at,
                    match_status=match.status.value,
                    has_pick=pick is not None,
                    selection=pick.selection if pick is not None else None,
                    predicted_home_score=pick.predicted_home_score if pick is not None else None,
                    predicted_away_score=pick.predicted_away_score if pick is not None else None,
                    advancing_team_id=pick.advancing_team_id if pick is not None else None,
                    spread_selection=pick.spread_selection if pick is not None else None,
                    spread_line_value=pick.spread_line_value if pick is not None else None,
                    home_score=result.home_score if result is not None else None,
                    away_score=result.away_score if result is not None else None,
                    official_advancing_team_id=result.advancing_team_id if result is not None else None,
                    is_official=is_official,
                    is_admin_override=pick.is_admin_override if pick is not None else False,
                    admin_override_note=pick.admin_override_note if pick is not None else None,
                    overridden_by_display_name=(
                        override_profiles.get(pick.overridden_by_profile_id).display_name
                        if pick is not None and pick.overridden_by_profile_id is not None
                        else None
                    ),
                    overridden_at=pick.overridden_at if pick is not None else None,
                    result_points=result_points,
                    exact_score_points=exact_score_points,
                    advancing_team_points=advancing_team_points,
                    spread_points=spread_points,
                    total_points=result_points + exact_score_points + advancing_team_points + spread_points,
                )
            )

        return result_rows

    def list_global_picks(
        self,
        db: Session,
        profile: Profile,
        matchday_id: str,
    ) -> GlobalPickBoardOut:
        matchday = db.get(Matchday, matchday_id)
        if matchday is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Matchday not found")

        matches = list(
            db.scalars(
                select(Match)
                .where(Match.matchday_id == matchday_id)
                .order_by(Match.kickoff_at.asc())
            )
        )
        latest_odds_by_match_id = self.odds_repo.list_latest_by_match_ids(db, [match.id for match in matches])
        teams = self._load_teams(db, matches)

        player_rows = db.execute(
            select(Profile.id, Profile.display_name)
            .join(SeasonMembership, SeasonMembership.profile_id == Profile.id)
            .where(
                SeasonMembership.season_id == matchday.season_id,
                SeasonMembership.is_active.is_(True),
                Profile.is_active.is_(True),
            )
            .order_by(Profile.display_name.asc())
        ).all()

        players = [
            GlobalPickPlayerOut(profile_id=profile_id, display_name=display_name)
            for profile_id, display_name in player_rows
        ]

        profile_ids = [player.profile_id for player in players]
        match_ids = [match.id for match in matches]
        pick_map: dict[tuple[str, str], UserPick] = {}
        if profile_ids and match_ids:
            pick_rows = db.scalars(
                select(UserPick).where(
                    UserPick.profile_id.in_(profile_ids),
                    UserPick.match_id.in_(match_ids),
                )
            ).all()
            pick_map = {(pick.profile_id, pick.match_id): pick for pick in pick_rows}

        now = datetime.now(UTC)
        match_out = []
        for match in matches:
            home_team = teams.get(match.home_team_id)
            away_team = teams.get(match.away_team_id)
            odds = latest_odds_by_match_id.get(match.id)
            match_out.append(
                GlobalPickMatchOut(
                    match_id=match.id,
                    home_team_id=match.home_team_id,
                    home_placeholder=match.home_placeholder,
                    home_team_name=home_team.name if home_team else match.home_placeholder or "Local",
                    home_team_crest_url=home_team.crest_url if home_team else None,
                    away_team_id=match.away_team_id,
                    away_placeholder=match.away_placeholder,
                    away_team_name=away_team.name if away_team else match.away_placeholder or "Visitante",
                    away_team_crest_url=away_team.crest_url if away_team else None,
                    stage_type=match.stage_type.value,
                    group_label=match.group_label,
                    bracket_slot=match.bracket_slot,
                    kickoff_at=match.kickoff_at,
                    is_locked=now >= ensure_utc(match.picks_lock_at),
                    is_ready_for_picks=self._match_has_confirmed_teams(match),
                    spread_home_line=odds.spread_home_line if odds is not None else None,
                    spread_away_line=odds.spread_away_line if odds is not None else None,
                )
            )

        cells: list[GlobalPickCellOut] = []
        for player_row in players:
            for match in match_out:
                pick = pick_map.get((player_row.profile_id, match.match_id))
                if not match.is_locked:
                    cells.append(
                        GlobalPickCellOut(
                            profile_id=player_row.profile_id,
                            match_id=match.match_id,
                            has_pick=pick is not None,
                            is_revealed=False,
                            selection=None,
                            predicted_home_score=None,
                            predicted_away_score=None,
                            advancing_team_id=None,
                            spread_selection=None,
                            spread_line_value=None,
                        )
                    )
                    continue

                cells.append(
                    GlobalPickCellOut(
                        profile_id=player_row.profile_id,
                        match_id=match.match_id,
                        has_pick=pick is not None,
                        is_revealed=True,
                        selection=pick.selection if pick is not None else None,
                        predicted_home_score=pick.predicted_home_score if pick is not None else None,
                        predicted_away_score=pick.predicted_away_score if pick is not None else None,
                        advancing_team_id=pick.advancing_team_id if pick is not None else None,
                        spread_selection=pick.spread_selection if pick is not None else None,
                        spread_line_value=pick.spread_line_value if pick is not None else None,
                    )
                )

        return GlobalPickBoardOut(
            matchday_id=matchday_id,
            players=players,
            matches=match_out,
            cells=cells,
        )

    def list_admin_picks(
        self,
        db: Session,
        matchday_id: str,
        profile_id: str | None = None,
    ) -> list[AdminPickRowOut]:
        matchday = db.get(Matchday, matchday_id)
        if matchday is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Matchday not found")

        matches = list(
            db.scalars(
                select(Match)
                .where(Match.matchday_id == matchday_id)
                .order_by(Match.kickoff_at.asc())
            )
        )
        if not matches:
            return []

        teams = self._load_teams(db, matches)
        players_stmt = (
            select(Profile)
            .join(SeasonMembership, SeasonMembership.profile_id == Profile.id)
            .where(
                SeasonMembership.season_id == matchday.season_id,
                SeasonMembership.is_active.is_(True),
                Profile.is_active.is_(True),
            )
            .order_by(Profile.display_name.asc())
        )
        if profile_id is not None:
            players_stmt = players_stmt.where(Profile.id == profile_id)

        players = list(db.scalars(players_stmt))
        if not players:
            return []

        match_ids = [match.id for match in matches]
        profile_ids = [player.id for player in players]
        pick_rows = list(
            db.scalars(
                select(UserPick).where(
                    UserPick.profile_id.in_(profile_ids),
                    UserPick.match_id.in_(match_ids),
                )
            )
        )
        pick_map = {(pick.profile_id, pick.match_id): pick for pick in pick_rows}
        override_profiles = self._load_override_profiles(
            db,
            [pick.overridden_by_profile_id for pick in pick_rows if pick.overridden_by_profile_id is not None],
        )

        now = datetime.now(UTC)
        result_rows: list[AdminPickRowOut] = []
        for match in matches:
            home_team = teams.get(match.home_team_id)
            away_team = teams.get(match.away_team_id)
            for player in players:
                pick = pick_map.get((player.id, match.id))
                result_rows.append(
                    AdminPickRowOut(
                        pick_id=pick.id if pick is not None else None,
                        profile_id=player.id,
                        profile_display_name=player.display_name,
                        match_id=match.id,
                        matchday_id=match.matchday_id,
                        home_team_id=match.home_team_id,
                        home_placeholder=match.home_placeholder,
                        home_team_name=home_team.name if home_team else match.home_placeholder or "Local",
                        away_team_id=match.away_team_id,
                        away_placeholder=match.away_placeholder,
                        away_team_name=away_team.name if away_team else match.away_placeholder or "Visitante",
                        stage_type=match.stage_type,
                        group_label=match.group_label,
                        bracket_slot=match.bracket_slot,
                        kickoff_at=match.kickoff_at,
                        picks_lock_at=match.picks_lock_at,
                        match_status=match.status,
                        has_pick=pick is not None,
                        is_locked=now >= ensure_utc(match.picks_lock_at),
                        is_ready_for_picks=self._match_has_confirmed_teams(match),
                        selection=pick.selection if pick is not None else None,
                        spread_selection=pick.spread_selection if pick is not None else None,
                        spread_line_value=pick.spread_line_value if pick is not None else None,
                        predicted_home_score=pick.predicted_home_score if pick is not None else None,
                        predicted_away_score=pick.predicted_away_score if pick is not None else None,
                        advancing_team_id=pick.advancing_team_id if pick is not None else None,
                        is_admin_override=pick.is_admin_override if pick is not None else False,
                        admin_override_note=pick.admin_override_note if pick is not None else None,
                        overridden_by_profile_id=pick.overridden_by_profile_id if pick is not None else None,
                        overridden_by_display_name=(
                            override_profiles.get(pick.overridden_by_profile_id).display_name
                            if pick is not None and pick.overridden_by_profile_id is not None
                            else None
                        ),
                        overridden_at=pick.overridden_at if pick is not None else None,
                        updated_at=pick.updated_at if pick is not None else None,
                    )
                )

        return result_rows

    def save_admin_override(
        self,
        db: Session,
        payload: AdminPickOverrideRequest,
        updated_by: Profile,
    ) -> AdminPickRowOut:
        profile = db.get(Profile, payload.profile_id)
        if profile is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
        if not profile.is_active:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User is inactive")

        match = self.match_repo.get_by_id(db, payload.match_id)
        if match is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Match not found")

        season_id = self._season_id_for_match(db, match)
        membership = self.membership_repo.get_for_profile_and_season(db, profile.id, season_id)
        if membership is None or not membership.is_active:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="User is not active in the season for this match",
            )

        pick = self.pick_repo.get_for_user_and_match(db, profile.id, match.id)
        self._validate_pick_payload(db, match, payload)
        advancing_team_id = self._validate_advancing_team_for_match(match, payload)
        spread_selection, spread_line_value = self._resolve_spread_pick(db, match, payload)
        if pick is None:
            pick = UserPick(
                profile_id=profile.id,
                match_id=match.id,
                selection=payload.selection,
                spread_selection=spread_selection,
                spread_line_value=spread_line_value,
                predicted_home_score=payload.predicted_home_score,
                predicted_away_score=payload.predicted_away_score,
                advancing_team_id=advancing_team_id,
            )
        else:
            pick.selection = payload.selection
            pick.spread_selection = spread_selection
            pick.spread_line_value = spread_line_value
            pick.predicted_home_score = payload.predicted_home_score
            pick.predicted_away_score = payload.predicted_away_score
            pick.advancing_team_id = advancing_team_id

        pick.is_admin_override = True
        pick.admin_override_note = self._normalize_optional_text(payload.admin_override_note)
        pick.overridden_by_profile_id = updated_by.id
        pick.overridden_at = datetime.now(UTC)
        db.add(pick)
        db.commit()
        db.refresh(pick)

        rows = self.list_admin_picks(db, match.matchday_id, profile_id=profile.id)
        for row in rows:
            if row.match_id == match.id:
                return row

        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Override saved but row not found")

    def _get_open_match(self, db: Session, match_id: str) -> Match:
        match = self.match_repo.get_by_id(db, match_id)
        if match is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Match not found")
        if not self._match_has_confirmed_teams(match):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Este partido todavia no tiene a los dos equipos definidos",
            )
        if datetime.now(UTC) >= ensure_utc(match.picks_lock_at):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Pick window closed")
        return match

    def _ensure_profile_can_pick(self, db: Session, profile: Profile, match: Match) -> None:
        if not profile.is_active:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tu acceso a la app esta inactivo")

        matchday = db.get(Matchday, match.matchday_id)
        if matchday is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Matchday not found")

        season = db.get(Season, matchday.season_id)
        if season is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Season not found")

        did_freeze = self.eligibility_service.freeze_season_if_due(db, season)
        if did_freeze:
            db.commit()
            db.refresh(season)

        membership = self.membership_repo.get_for_profile_and_season(db, profile.id, matchday.season_id)
        if not self.eligibility_service.can_participate(db, season, membership):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="No estas dado de alta en este torneo. Pidele al admin que te active la temporada.",
            )

    def _season_id_for_match(self, db: Session, match: Match) -> str:
        matchday = db.get(Matchday, match.matchday_id)
        if matchday is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Matchday not found")
        return matchday.season_id

    def _clear_admin_override(self, pick: UserPick) -> None:
        pick.is_admin_override = False
        pick.admin_override_note = None
        pick.overridden_by_profile_id = None
        pick.overridden_at = None

    def _validate_pick_payload(
        self,
        db: Session,
        match: Match,
        payload: PickCreate | PickUpdate | AdminPickOverrideRequest,
    ) -> None:
        if self._is_nfl_match(db, match):
            if payload.selection == PickSelection.DRAW:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="En NFL debes escoger ganador puro, no empate",
                )
            if payload.spread_selection not in {PickSelection.HOME, PickSelection.AWAY}:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="En NFL debes escoger la linea para local o visitante",
                )
            return

        if payload.selection == PickSelection.DRAW and payload.predicted_home_score != payload.predicted_away_score:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Draw picks require equal scores")
        if payload.selection == PickSelection.HOME and payload.predicted_home_score <= payload.predicted_away_score:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Home picks require home score greater than away score",
            )
        if payload.selection == PickSelection.AWAY and payload.predicted_home_score >= payload.predicted_away_score:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Away picks require away score greater than home score",
            )

    def _resolve_spread_pick(
        self,
        db: Session,
        match: Match,
        payload: PickCreate | PickUpdate | AdminPickOverrideRequest,
    ) -> tuple[PickSelection | None, str | None]:
        if not self._is_nfl_match(db, match):
            return None, None

        latest_odds = self._latest_odds_for_match(db, match)
        if latest_odds is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Este partido de NFL todavia no tiene linea disponible",
            )

        if payload.spread_selection == PickSelection.HOME:
            if not latest_odds.spread_home_line:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="La linea del local todavia no esta disponible",
                )
            return PickSelection.HOME, latest_odds.spread_home_line

        if payload.spread_selection == PickSelection.AWAY:
            if not latest_odds.spread_away_line:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="La linea del visitante todavia no esta disponible",
                )
            return PickSelection.AWAY, latest_odds.spread_away_line

        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="En NFL debes escoger una linea valida",
        )

    def _validate_advancing_team_for_match(
        self,
        match: Match,
        payload: PickCreate | PickUpdate | AdminPickOverrideRequest,
    ) -> str | None:
        if match.stage_type.value in {"regular", "group"}:
            return None
        if not self._match_has_confirmed_teams(match):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Este partido todavia no tiene a los dos equipos definidos",
            )
        if payload.advancing_team_id not in {match.home_team_id, match.away_team_id}:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Debes seleccionar el equipo que avanza en eliminatoria directa",
            )
        if payload.selection == PickSelection.HOME and payload.advancing_team_id != match.home_team_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Si ganas con local en 90 minutos, el local debe ser el equipo que avanza",
            )
        if payload.selection == PickSelection.AWAY and payload.advancing_team_id != match.away_team_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Si ganas con visitante en 90 minutos, el visitante debe ser el equipo que avanza",
            )
        return payload.advancing_team_id

    def _build_pick_out(self, db: Session, pick: UserPick, match: Match | None = None) -> PickOut:
        match = match or self.match_repo.get_by_id(db, pick.match_id)
        if match is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Match not found")
        home_team = db.get(Team, match.home_team_id) if match.home_team_id else None
        away_team = db.get(Team, match.away_team_id) if match.away_team_id else None
        overridden_by = db.get(Profile, pick.overridden_by_profile_id) if pick.overridden_by_profile_id else None
        return PickOut(
            id=pick.id,
            profile_id=pick.profile_id,
            match_id=pick.match_id,
            matchday_id=match.matchday_id,
            selection=pick.selection,
            spread_selection=pick.spread_selection,
            spread_line_value=pick.spread_line_value,
            predicted_home_score=pick.predicted_home_score,
            predicted_away_score=pick.predicted_away_score,
            advancing_team_id=pick.advancing_team_id,
            home_team_name=home_team.name if home_team else match.home_placeholder or "Local",
            away_team_name=away_team.name if away_team else match.away_placeholder or "Visitante",
            stage_type=match.stage_type.value,
            group_label=match.group_label,
            bracket_slot=match.bracket_slot,
            home_placeholder=match.home_placeholder,
            away_placeholder=match.away_placeholder,
            kickoff_at=match.kickoff_at,
            is_locked=datetime.now(UTC) >= ensure_utc(match.picks_lock_at),
            is_ready_for_picks=self._match_has_confirmed_teams(match),
            is_admin_override=pick.is_admin_override,
            admin_override_note=pick.admin_override_note,
            overridden_by_profile_id=pick.overridden_by_profile_id,
            overridden_by_display_name=overridden_by.display_name if overridden_by is not None else None,
            overridden_at=pick.overridden_at,
            created_at=pick.created_at,
            updated_at=pick.updated_at,
        )

    def _load_rules(self, db: Session) -> dict[str, int]:
        stored_rules = {
            rule.rule_key: rule.points
            for rule in db.scalars(select(ScoringRule).where(ScoringRule.is_active.is_(True)))
        }
        return {
            "result_correct": stored_rules.get("result_correct", 3),
            "exact_score": stored_rules.get("exact_score", 2),
            "advancing_team": stored_rules.get("advancing_team", 1),
            "spread_correct": stored_rules.get("spread_correct", 3),
        }

    def _load_teams(self, db: Session, matches: list[Match]) -> dict[str, Team]:
        team_ids = {
            team_id
            for match in matches
            for team_id in (match.home_team_id, match.away_team_id)
            if team_id is not None
        }
        if not team_ids:
            return {}
        teams = db.scalars(select(Team).where(Team.id.in_(team_ids))).all()
        return {team.id: team for team in teams}

    def _load_season_ids_by_matchday(self, db: Session, matchday_ids: list[str]) -> dict[str, str]:
        clean_ids = sorted({matchday_id for matchday_id in matchday_ids if matchday_id})
        if not clean_ids:
            return {}
        return dict(
            db.execute(select(Matchday.id, Matchday.season_id).where(Matchday.id.in_(clean_ids))).all()
        )

    def _load_seasons(self, db: Session, season_ids: list[str | None]) -> dict[str, Season]:
        clean_ids = sorted({season_id for season_id in season_ids if season_id})
        if not clean_ids:
            return {}
        seasons = db.scalars(select(Season).where(Season.id.in_(clean_ids))).all()
        return {season.id: season for season in seasons}

    def _load_competitions(self, db: Session, competition_ids: list[str | None]) -> dict[str, Competition]:
        clean_ids = sorted({competition_id for competition_id in competition_ids if competition_id})
        if not clean_ids:
            return {}
        competitions = db.scalars(select(Competition).where(Competition.id.in_(clean_ids))).all()
        return {competition.id: competition for competition in competitions}

    def _match_has_confirmed_teams(self, match: Match) -> bool:
        return match.home_team_id is not None and match.away_team_id is not None

    def _load_override_profiles(self, db: Session, profile_ids: list[str | None]) -> dict[str, Profile]:
        clean_ids = sorted({profile_id for profile_id in profile_ids if profile_id})
        if not clean_ids:
            return {}
        profiles = list(db.scalars(select(Profile).where(Profile.id.in_(clean_ids))))
        return {profile.id: profile for profile in profiles}

    def _normalize_optional_text(self, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None

    def _latest_odds_for_match(self, db: Session, match: Match) -> Odds | None:
        return self.odds_repo.list_latest_by_match_ids(db, [match.id]).get(match.id)

    def _is_nfl_match(self, db: Session, match: Match) -> bool:
        season_id = self._season_id_for_match(db, match)
        season = db.get(Season, season_id)
        if season is None or season.competition_id is None:
            return False
        competition = db.get(Competition, season.competition_id)
        return self._is_nfl_competition(competition)

    def _is_nfl_competition(self, competition: Competition | None) -> bool:
        if competition is None:
            return False
        haystack = " ".join(
            [
                competition.slug or "",
                competition.name or "",
                competition.sport_name or "",
            ]
        ).lower()
        return "nfl" in haystack or "football" in haystack

    def _calculate_spread_points(
        self,
        home_score: int,
        away_score: int,
        spread_selection: PickSelection | None,
        spread_line_value: str | None,
        awarded_points: int,
    ) -> int:
        if spread_selection not in {PickSelection.HOME, PickSelection.AWAY} or not spread_line_value:
            return 0
        line_decimal = self._parse_line_decimal(spread_line_value)
        if line_decimal is None:
            return 0
        side_score = home_score if spread_selection == PickSelection.HOME else away_score
        opponent_score = away_score if spread_selection == PickSelection.HOME else home_score
        margin_with_line = Decimal(side_score) + line_decimal - Decimal(opponent_score)
        if margin_with_line > 0:
            return awarded_points
        return 0

    def _parse_line_decimal(self, raw_value: str) -> Decimal | None:
        normalized = raw_value.strip().replace("PK", "0").replace("pk", "0")
        if not normalized:
            return None
        try:
            return Decimal(normalized)
        except (InvalidOperation, ValueError):
            return None

    def _resolve_winner(self, home_score: int, away_score: int) -> PickSelection:
        if home_score > away_score:
            return PickSelection.HOME
        if away_score > home_score:
            return PickSelection.AWAY
        return PickSelection.DRAW
