from collections import defaultdict
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.datetime import ensure_utc
from app.models.entities import Competition, HistoricalChampion, Match, MatchResult, Matchday, PickSelection, Profile, Season, SeasonVisibilityStatus, StandingsMatchday, StandingsOverall, Team, TournamentFormat, UserPick, TrophyAsset
from app.repositories.leaderboard_repository import LeaderboardRepository
from app.repositories.season_membership_repository import SeasonMembershipRepository
from app.schemas.leaderboard import (
    HallOfFameEntry,
    HallOfFameResponse,
    LiveLeaderboardEntry,
    LiveLeaderboardResponse,
    LiveMatchScoreOut,
    HallOfFameTournamentPodium,
    LeaderboardEntry,
    MyMatchdayPointsEntry,
    PerformanceRacePoint,
    PerformanceRaceResponse,
)
from app.services.scoring_service import ScoringService
from app.services.season_eligibility_service import SeasonEligibilityService


class LeaderboardService:
    def __init__(self) -> None:
        self.repo = LeaderboardRepository()
        self.membership_repo = SeasonMembershipRepository()
        self.eligibility_service = SeasonEligibilityService()

    def list_overall(self, db: Session, season_id: str | None = None) -> list[LeaderboardEntry]:
        season = self._resolve_season(db, season_id)
        rows = self.repo.list_overall(db, season.id if season is not None else None)
        season_cache: dict[str, Season | None] = {}
        eligible_profile_ids_cache: dict[str, set[str]] = {}
        eligible_rows = [
            (standing, profile)
            for standing, profile in rows
            if self._counts_for_scoring(
                db,
                standing.season_id,
                standing.profile_id,
                season_cache=season_cache,
                eligible_profile_ids_cache=eligible_profile_ids_cache,
            )
        ]
        return self._overall_entries(eligible_rows)

    def list_matchday(self, db: Session, matchday_id: str) -> list[LeaderboardEntry]:
        matchday = db.get(Matchday, matchday_id)
        if matchday is None:
            return []
        rows = self.repo.list_matchday(db, matchday_id)
        season_cache: dict[str, Season | None] = {}
        eligible_profile_ids_cache: dict[str, set[str]] = {}
        eligible_rows = [
            (standing, profile)
            for standing, profile in rows
            if self._counts_for_scoring(
                db,
                matchday.season_id,
                standing.profile_id,
                season_cache=season_cache,
                eligible_profile_ids_cache=eligible_profile_ids_cache,
            )
        ]
        return self._matchday_entries(eligible_rows)

    def list_profile_matchdays(
        self,
        db: Session,
        profile: Profile,
        season_id: str | None = None,
    ) -> list[MyMatchdayPointsEntry]:
        season = self._resolve_season(db, season_id)
        if season is None:
            return []

        matchdays = list(
            db.scalars(
                select(Matchday)
                .where(Matchday.season_id == season.id)
                .order_by(Matchday.number.asc())
            )
        )
        if not matchdays:
            return []

        tournament_matchdays = self._get_tournament_matchdays(matchdays, season)
        if not tournament_matchdays:
            return []

        rows = self.repo.list_profile_matchdays(db, profile.id, season.id)
        allowed_matchday_ids = {matchday.id for matchday in tournament_matchdays}
        rows = [(matchday, standing) for matchday, standing in rows if matchday.id in allowed_matchday_ids]
        all_standings = list(
            db.scalars(
                select(StandingsMatchday)
                .where(StandingsMatchday.matchday_id.in_(allowed_matchday_ids))
            )
        )
        standings_by_matchday: dict[str, list[StandingsMatchday]] = {}
        for standing in all_standings:
            standings_by_matchday.setdefault(standing.matchday_id, []).append(standing)
        cumulative_points = 0
        entries: list[MyMatchdayPointsEntry] = []
        for matchday, standing in rows:
            total_points = standing.total_points if standing else 0
            cumulative_points += total_points
            standings_for_matchday = standings_by_matchday.get(matchday.id, [])
            prize_amount = 0.0
            if standings_for_matchday and standing is not None:
                ranked_rows = [
                    (standing_row.profile_id, standing_row.rank_position)
                    for standing_row in sorted(
                        standings_for_matchday,
                        key=lambda item: (item.rank_position, item.profile_id),
                    )
                ]
                prize_shares = ScoringService.calculate_prize_shares(
                    ranked_rows=ranked_rows,
                    first_place_amount=season.weekly_first_place_amount,
                    second_place_amount=season.weekly_second_place_amount,
                    third_place_amount=season.weekly_third_place_amount,
                )
                prize_amount = float(prize_shares.get(profile.id, 0))
            entries.append(
                self._profile_matchday_entry(
                    matchday,
                    season.id,
                    standing,
                    cumulative_points,
                    weekly_prize_amount=prize_amount,
                )
            )
        return entries

    def get_performance_race(
        self,
        db: Session,
        profile: Profile,
        season_id: str | None = None,
    ) -> PerformanceRaceResponse:
        season = self._resolve_season(db, season_id)
        if season is None:
            return PerformanceRaceResponse()

        matchdays = list(
            db.scalars(
                select(Matchday)
                .where(Matchday.season_id == season.id)
                .order_by(Matchday.number.asc())
            )
        )
        if not matchdays:
            return PerformanceRaceResponse(season_id=season.id, season_name=season.name)

        tournament_matchdays = self._get_tournament_matchdays(matchdays, season)
        if not tournament_matchdays:
            return PerformanceRaceResponse(season_id=season.id, season_name=season.name)

        standings_rows = db.execute(
            select(StandingsMatchday, Profile)
            .join(Profile, Profile.id == StandingsMatchday.profile_id)
            .join(Matchday, Matchday.id == StandingsMatchday.matchday_id)
            .where(StandingsMatchday.matchday_id.in_([matchday.id for matchday in tournament_matchdays]))
            .order_by(StandingsMatchday.matchday_id.asc(), StandingsMatchday.rank_position.asc(), Profile.display_name.asc())
        ).all()
        eligible_profile_ids_cache: dict[str, set[str]] = {}
        standings_rows = [
            (standing, standing_profile)
            for standing, standing_profile in standings_rows
            if self._counts_for_scoring(
                db,
                season.id,
                standing.profile_id,
                season_cache={season.id: season},
                eligible_profile_ids_cache=eligible_profile_ids_cache,
            )
        ]

        standings_by_matchday: dict[str, list[tuple[StandingsMatchday, Profile]]] = {}
        totals_by_profile: dict[str, int] = {}
        for standing, standing_profile in standings_rows:
            standings_by_matchday.setdefault(standing.matchday_id, []).append((standing, standing_profile))
            totals_by_profile[standing.profile_id] = totals_by_profile.get(standing.profile_id, 0) + standing.total_points

        leader_profile_id = None
        leader_name = None
        if totals_by_profile:
            leader_profile_id = sorted(
                totals_by_profile.items(),
                key=lambda item: (-item[1], item[0]),
            )[0][0]
            for _standing, standing_profile in standings_rows:
                if standing_profile.id == leader_profile_id:
                    leader_name = standing_profile.display_name
                    break

        user_cumulative = 0.0
        leader_cumulative = 0.0
        first_place_cumulative = 0.0
        third_place_cumulative = 0.0
        completed_count = 0
        points: list[PerformanceRacePoint] = []

        for matchday in tournament_matchdays:
            standings_for_matchday = standings_by_matchday.get(matchday.id, [])
            user_row = next((standing for standing, standing_profile in standings_for_matchday if standing_profile.id == profile.id), None)
            first_place_row = next((standing for standing, _standing_profile in standings_for_matchday if standing.rank_position == 1), None)
            leader_row = (
                next((standing for standing, standing_profile in standings_for_matchday if standing_profile.id == leader_profile_id), None)
                if leader_profile_id
                else None
            )
            prize_rows = [standing for standing, _standing_profile in standings_for_matchday if standing.rank_position <= 3]
            third_place_row = prize_rows[-1] if prize_rows else first_place_row
            has_results = bool(standings_for_matchday)
            if has_results:
                completed_count += 1
            user_cumulative += float(user_row.total_points if user_row else 0)
            leader_cumulative += float(leader_row.total_points if leader_row else 0)
            first_place_cumulative += float(first_place_row.total_points if first_place_row else 0)
            third_place_cumulative += float(third_place_row.total_points if third_place_row else 0)
            points.append(
                PerformanceRacePoint(
                    matchday_id=matchday.id,
                    matchday_number=matchday.number,
                    matchday_name=matchday.name,
                    user_cumulative_points=user_cumulative,
                    leader_cumulative_points=leader_cumulative,
                    first_place_cumulative_points=first_place_cumulative,
                    third_place_cumulative_points=third_place_cumulative,
                )
            )

        total_matchdays = len(tournament_matchdays)
        projected_user_total = round((user_cumulative / completed_count) * total_matchdays, 1) if completed_count > 0 else 0.0
        projected_first_place_total = (
            round((first_place_cumulative / completed_count) * total_matchdays, 1) if completed_count > 0 else 0.0
        )
        projected_third_place_total = (
            round((third_place_cumulative / completed_count) * total_matchdays, 1) if completed_count > 0 else 0.0
        )

        return PerformanceRaceResponse(
            season_id=season.id,
            season_name=season.name,
            leader_profile_id=leader_profile_id,
            leader_name=leader_name,
            tournament_matchdays=total_matchdays,
            completed_matchdays=completed_count,
            projected_user_total=projected_user_total,
            projected_leader_total=projected_first_place_total,
            projected_first_place_total=projected_first_place_total,
            projected_third_place_total=projected_third_place_total,
            points=points,
        )

    def get_hall_of_fame(self, db: Session) -> HallOfFameResponse:
        historical_rows = list(
            db.scalars(
                select(HistoricalChampion)
                .order_by(HistoricalChampion.created_at.desc(), HistoricalChampion.tournament_name.desc())
            )
        )
        trophy_map = {
            trophy.id: trophy
            for trophy in db.scalars(select(TrophyAsset)).all()
        }
        champions_rows = [row for row in historical_rows if row.place_label == "Campeon"]
        overall_rows = db.execute(
            select(StandingsOverall, Profile)
            .join(Profile, Profile.id == StandingsOverall.profile_id)
        ).all()
        matchday_rows = db.execute(
            select(StandingsMatchday, Profile, Matchday)
            .join(Profile, Profile.id == StandingsMatchday.profile_id)
            .join(Matchday, Matchday.id == StandingsMatchday.matchday_id)
        ).all()
        season_cache: dict[str, Season | None] = {}
        eligible_profile_ids_cache: dict[str, set[str]] = {}
        overall_rows = [
            (standing, profile)
            for standing, profile in overall_rows
            if self._counts_for_scoring(
                db,
                standing.season_id,
                standing.profile_id,
                season_cache=season_cache,
                eligible_profile_ids_cache=eligible_profile_ids_cache,
            )
        ]
        filtered_matchday_rows = [
            (standing, profile)
            for standing, profile, matchday in matchday_rows
            if self._counts_for_scoring(
                db,
                matchday.season_id,
                standing.profile_id,
                season_cache=season_cache,
                eligible_profile_ids_cache=eligible_profile_ids_cache,
            )
        ]

        points_bucket: dict[str, dict[str, int | str]] = {}
        exact_bucket: dict[str, dict[str, int | str]] = {}
        for standing, profile in overall_rows:
            points_info = points_bucket.setdefault(
                profile.id,
                {"display_name": profile.display_name, "value": 0},
            )
            points_info["value"] = int(points_info["value"]) + standing.total_points

            exact_info = exact_bucket.setdefault(
                profile.id,
                {"display_name": profile.display_name, "value": 0},
            )
            exact_info["value"] = int(exact_info["value"]) + standing.exact_scores

        weekly_bucket: dict[str, dict[str, int | str]] = {}
        for standing, profile in filtered_matchday_rows:
            if standing.rank_position != 1:
                continue
            weekly_info = weekly_bucket.setdefault(
                profile.id,
                {"display_name": profile.display_name, "value": 0},
            )
            weekly_info["value"] = int(weekly_info["value"]) + 1

        def sort_entries(entries: list[HallOfFameEntry]) -> list[HallOfFameEntry]:
            return sorted(entries, key=lambda item: (-item.value, item.display_name.lower()))

        champions = [
            HallOfFameEntry(
                profile_id=row.id,
                display_name=row.champion_name,
                value=row.total_points,
                detail=row.tournament_name,
                place_label=row.place_label,
                image_url=trophy_map[row.trophy_asset_id].image_url if row.trophy_asset_id in trophy_map else row.image_url,
            )
            for row in champions_rows
        ]
        tournament_names = list(dict.fromkeys(row.tournament_name for row in historical_rows))
        podium_tournament_name = tournament_names[0] if tournament_names else None
        podium_places = ["Campeon", "2do Lugar", "3er Lugar"]
        podiums_by_tournament: list[HallOfFameTournamentPodium] = []
        for tournament_name in tournament_names:
            tournament_entries: list[HallOfFameEntry] = []
            for place_label in podium_places:
                row = next(
                    (
                        item
                        for item in historical_rows
                        if item.tournament_name == tournament_name and item.place_label == place_label
                    ),
                    None,
                )
                if row is not None:
                    tournament_entries.append(
                        HallOfFameEntry(
                            profile_id=row.id,
                            display_name=row.champion_name,
                            value=row.total_points,
                            detail=row.tournament_name,
                            place_label=row.place_label,
                            image_url=trophy_map[row.trophy_asset_id].image_url if row.trophy_asset_id in trophy_map else row.image_url,
                        )
                    )
            if tournament_entries:
                podiums_by_tournament.append(
                    HallOfFameTournamentPodium(
                        tournament_name=tournament_name,
                        entries=tournament_entries,
                    )
                )
        podium = podiums_by_tournament[0].entries if podiums_by_tournament else []
        points = sort_entries(
            [
                HallOfFameEntry(
                    profile_id=profile_id,
                    display_name=str(bucket["display_name"]),
                    value=int(bucket["value"]),
                    detail="Puntos historicos acumulados",
                )
                for profile_id, bucket in points_bucket.items()
            ]
        )
        weekly_wins = sort_entries(
            [
                HallOfFameEntry(
                    profile_id=profile_id,
                    display_name=str(bucket["display_name"]),
                    value=int(bucket["value"]),
                    detail="Jornadas ganadas",
                )
                for profile_id, bucket in weekly_bucket.items()
            ]
        )
        exact_scores = sort_entries(
            [
                HallOfFameEntry(
                    profile_id=profile_id,
                    display_name=str(bucket["display_name"]),
                    value=int(bucket["value"]),
                    detail="Marcadores exactos acumulados",
                )
                for profile_id, bucket in exact_bucket.items()
            ]
        )

        return HallOfFameResponse(
            podium_tournament_name=podium_tournament_name,
            podium=podium,
            podium_tournaments=tournament_names,
            podiums_by_tournament=podiums_by_tournament,
            champions=champions,
            points=points,
            weekly_wins=weekly_wins,
            exact_scores=exact_scores,
        )

    def get_live_leaderboard(self, db: Session, season_id: str | None = None) -> LiveLeaderboardResponse:
        season = self._resolve_season(db, season_id)
        if season is None:
            return LiveLeaderboardResponse()

        matchdays = list(
            db.scalars(
                select(Matchday)
                .where(Matchday.season_id == season.id)
                .order_by(Matchday.number.asc())
            )
        )
        live_matchday = self._resolve_live_matchday(matchdays)
        official_entries = self.list_overall(db, season_id=season.id)
        official_by_profile_id = {entry.profile_id: entry for entry in official_entries}

        memberships = self.membership_repo.list_for_season(db, season.id)
        eligible_profile_ids = {
            membership.profile_id
            for membership in memberships
            if self.eligibility_service.counts_for_scoring(db, season, membership)
        }
        if not eligible_profile_ids:
            return LiveLeaderboardResponse(
                enabled=season.live_dashboard_enabled,
                season_id=season.id,
                season_name=season.name,
                matchday_id=live_matchday.id if live_matchday is not None else None,
                matchday_name=live_matchday.name if live_matchday is not None else None,
                leaderboard=[],
                matches=[],
            )

        profiles = {
            profile.id: profile
            for profile in db.scalars(select(Profile).where(Profile.id.in_(eligible_profile_ids)))
        }
        teams = {
            team.id: team
            for team in db.scalars(select(Team).where(Team.id.in_(self._load_season_team_ids(db, season.id))))
        }
        competition = db.get(Competition, season.competition_id) if season.competition_id is not None else None
        rules = ScoringService()._load_rules(db)
        is_nfl_competition = self._is_nfl_competition(competition)

        totals_by_profile: dict[str, dict[str, int]] = {
            profile_id: {"total_points": 0, "correct_results": 0, "exact_scores": 0, "live_matchday_points": 0}
            for profile_id in eligible_profile_ids
            if profile_id in profiles
        }
        updated_at: datetime | None = None

        rows = db.execute(
            select(UserPick, Match, MatchResult)
            .join(Match, Match.id == UserPick.match_id)
            .join(Matchday, Matchday.id == Match.matchday_id)
            .join(MatchResult, MatchResult.match_id == Match.id)
            .where(
                Matchday.season_id == season.id,
                MatchResult.home_score.is_not(None),
                MatchResult.away_score.is_not(None),
            )
            .order_by(Match.kickoff_at.asc())
        ).all()

        for pick, match, result in rows:
            if pick.profile_id not in totals_by_profile:
                continue

            score = self._score_pick(
                pick=pick,
                match=match,
                result=result,
                season=season,
                is_nfl_competition=is_nfl_competition,
                rules=rules,
            )
            bucket = totals_by_profile[pick.profile_id]
            bucket["total_points"] += score["total_points"]
            bucket["correct_results"] += score["correct_results"]
            bucket["exact_scores"] += score["exact_scores"]
            if live_matchday is not None and match.matchday_id == live_matchday.id:
                bucket["live_matchday_points"] += score["total_points"]

            result_updated_at = result.updated_at or result.last_synced_at or result.source_updated_at
            if result_updated_at is not None and (updated_at is None or result_updated_at > updated_at):
                updated_at = result_updated_at

        sorted_rows = sorted(
            [
                (profile_id, values, profiles[profile_id])
                for profile_id, values in totals_by_profile.items()
                if profile_id in profiles
            ],
            key=lambda item: (-item[1]["total_points"], -item[1]["exact_scores"], item[2].display_name.lower()),
        )
        leaderboard: list[LiveLeaderboardEntry] = []
        previous_points: int | None = None
        previous_rank = 0
        for index, (profile_id, values, profile) in enumerate(sorted_rows, start=1):
            if previous_points is None or values["total_points"] != previous_points:
                previous_rank = index
                previous_points = values["total_points"]
            official_entry = official_by_profile_id.get(profile_id)
            official_rank = official_entry.rank_position if official_entry is not None else None
            leaderboard.append(
                LiveLeaderboardEntry(
                    profile_id=profile_id,
                    display_name=profile.display_name,
                    role_code=profile.role_code.value,
                    total_points=values["total_points"],
                    correct_results=values["correct_results"],
                    exact_scores=values["exact_scores"],
                    rank_position=previous_rank,
                    official_rank_position=official_rank,
                    official_total_points=official_entry.total_points if official_entry is not None else 0,
                    live_matchday_points=values["live_matchday_points"],
                    points_delta=values["total_points"] - (official_entry.total_points if official_entry is not None else 0),
                    rank_delta=(official_rank - previous_rank) if official_rank is not None else 0,
                )
            )

        matches: list[LiveMatchScoreOut] = []
        if live_matchday is not None:
            live_match_rows = db.execute(
                select(Match, MatchResult)
                .outerjoin(MatchResult, MatchResult.match_id == Match.id)
                .where(Match.matchday_id == live_matchday.id)
                .order_by(Match.kickoff_at.asc())
            ).all()
            for match, result in live_match_rows:
                home_team = teams.get(match.home_team_id)
                away_team = teams.get(match.away_team_id)
                result_updated_at = result.updated_at if result is not None else None
                if result_updated_at is not None and (updated_at is None or result_updated_at > updated_at):
                    updated_at = result_updated_at
                matches.append(
                    LiveMatchScoreOut(
                        match_id=match.id,
                        matchday_id=match.matchday_id,
                        matchday_name=live_matchday.name,
                        kickoff_at=match.kickoff_at,
                        match_status=match.status.value,
                        home_team_name=home_team.name if home_team is not None else match.home_placeholder or "Local",
                        home_team_crest_url=home_team.crest_url if home_team is not None else None,
                        away_team_name=away_team.name if away_team is not None else match.away_placeholder or "Visitante",
                        away_team_crest_url=away_team.crest_url if away_team is not None else None,
                        home_score=result.home_score if result is not None else None,
                        away_score=result.away_score if result is not None else None,
                        is_official=bool(result.is_official) if result is not None else False,
                        updated_at=result_updated_at,
                    )
                )

        return LiveLeaderboardResponse(
            enabled=season.live_dashboard_enabled,
            season_id=season.id,
            season_name=season.name,
            matchday_id=live_matchday.id if live_matchday is not None else None,
            matchday_name=live_matchday.name if live_matchday is not None else None,
            is_official=False,
            updated_at=updated_at,
            leaderboard=leaderboard,
            matches=matches,
        )

    def _overall_entries(self, rows: list[tuple[StandingsOverall, Profile]]) -> list[LeaderboardEntry]:
        sorted_rows = sorted(
            rows,
            key=lambda item: (
                -item[0].total_points,
                -item[0].exact_scores,
                item[1].display_name.lower(),
            ),
        )
        ranked_entries: list[LeaderboardEntry] = []
        previous_points: int | None = None
        previous_rank = 0
        for index, (standing, profile) in enumerate(sorted_rows, start=1):
            if previous_points is None or standing.total_points != previous_points:
                previous_rank = index
                previous_points = standing.total_points
            ranked_entries.append(
                LeaderboardEntry(
                    profile_id=profile.id,
                    display_name=profile.display_name,
                    role_code=profile.role_code.value,
                    total_points=standing.total_points,
                    correct_results=standing.correct_results,
                    exact_scores=standing.exact_scores,
                    rank_position=previous_rank,
                )
            )
        return ranked_entries

    def _matchday_entries(self, rows: list[tuple[StandingsMatchday, Profile]]) -> list[LeaderboardEntry]:
        sorted_rows = sorted(
            rows,
            key=lambda item: (
                -item[0].total_points,
                -item[0].exact_scores,
                item[1].display_name.lower(),
            ),
        )
        ranked_entries: list[LeaderboardEntry] = []
        previous_points: int | None = None
        previous_rank = 0
        for index, (standing, profile) in enumerate(sorted_rows, start=1):
            if previous_points is None or standing.total_points != previous_points:
                previous_rank = index
                previous_points = standing.total_points
            ranked_entries.append(
                LeaderboardEntry(
                    profile_id=profile.id,
                    display_name=profile.display_name,
                    role_code=profile.role_code.value,
                    total_points=standing.total_points,
                    correct_results=standing.correct_results,
                    exact_scores=standing.exact_scores,
                    rank_position=previous_rank,
                )
            )
        return ranked_entries

    def _profile_matchday_entry(
        self,
        matchday: Matchday,
        season_id: str,
        standing: StandingsMatchday | None,
        cumulative_points: int,
        weekly_prize_amount: float = 0,
    ) -> MyMatchdayPointsEntry:
        return MyMatchdayPointsEntry(
            matchday_id=matchday.id,
            season_id=season_id,
            matchday_number=matchday.number,
            matchday_name=matchday.name,
            total_points=standing.total_points if standing else 0,
            correct_results=standing.correct_results if standing else 0,
            exact_scores=standing.exact_scores if standing else 0,
            rank_position=standing.rank_position if standing else None,
            cumulative_points=cumulative_points,
            weekly_prize_amount=weekly_prize_amount,
        )

    def _resolve_live_matchday(self, matchdays: list[Matchday]) -> Matchday | None:
        if not matchdays:
            return None
        active = next((matchday for matchday in matchdays if matchday.status.value == "active"), None)
        if active is not None:
            return active
        now = datetime.now(UTC)
        started_matchdays = [matchday for matchday in matchdays if ensure_utc(matchday.starts_at) <= now]
        if started_matchdays:
            return started_matchdays[-1]
        return matchdays[0]

    def _load_season_team_ids(self, db: Session, season_id: str) -> set[str]:
        team_ids: set[str] = set()
        match_rows = db.execute(
            select(Match.home_team_id, Match.away_team_id)
            .join(Matchday, Matchday.id == Match.matchday_id)
            .where(Matchday.season_id == season_id)
        ).all()
        for home_team_id, away_team_id in match_rows:
            if home_team_id is not None:
                team_ids.add(home_team_id)
            if away_team_id is not None:
                team_ids.add(away_team_id)
        return team_ids

    def _score_pick(
        self,
        *,
        pick: UserPick,
        match: Match,
        result: MatchResult,
        season: Season,
        is_nfl_competition: bool,
        rules: dict[str, int],
    ) -> dict[str, int]:
        winner = self._resolve_winner(result.home_score, result.away_score)
        result_points = rules["result_correct"] if pick.selection == winner else 0
        exact_points = 0
        if not is_nfl_competition:
            exact_points = (
                rules["exact_score"]
                if pick.predicted_home_score == result.home_score and pick.predicted_away_score == result.away_score
                else 0
            )
        advancing_points = (
            rules["advancing_team"]
            if season.tournament_format == TournamentFormat.WORLD_CUP
            and match.stage_type.value not in {"regular", "group"}
            and pick.advancing_team_id is not None
            and pick.advancing_team_id == result.advancing_team_id
            else 0
        )
        spread_points = 0
        if is_nfl_competition:
            spread_points = ScoringService()._calculate_spread_points(
                result.home_score,
                result.away_score,
                pick.spread_selection,
                pick.spread_line_value,
                rules["spread_correct"],
            )
        return {
            "total_points": result_points + exact_points + advancing_points + spread_points,
            "correct_results": 1 if result_points else 0,
            "exact_scores": 1 if exact_points else 0,
        }

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

    @staticmethod
    def _resolve_winner(home_score: int, away_score: int) -> PickSelection:
        if home_score > away_score:
            return PickSelection.HOME
        if away_score > home_score:
            return PickSelection.AWAY
        return PickSelection.DRAW

    def _resolve_season(self, db: Session, season_id: str | None) -> Season | None:
        if season_id:
            return db.get(Season, season_id)
        season = db.query(Season).filter(Season.is_active.is_(True)).first()
        if season is not None:
            return season
        return (
            db.query(Season)
            .filter(Season.visibility_status == SeasonVisibilityStatus.LIVE)
            .order_by(Season.created_at.desc())
            .first()
        )

    @staticmethod
    def _get_tournament_matchdays(matchdays: list[Matchday], season: Season) -> list[Matchday]:
        start_number = next(
            (matchday.number for matchday in matchdays if matchday.id == season.start_matchday_id),
            matchdays[0].number,
        )
        end_number = next(
            (matchday.number for matchday in matchdays if matchday.id == season.end_matchday_id),
            matchdays[-1].number,
        )
        if end_number < start_number:
            end_number = start_number
        return [matchday for matchday in matchdays if start_number <= matchday.number <= end_number]

    def _counts_for_scoring(
        self,
        db: Session,
        season_id: str,
        profile_id: str,
        *,
        season_cache: dict[str, Season | None],
        eligible_profile_ids_cache: dict[str, set[str]],
    ) -> bool:
        if season_id not in season_cache:
            season_cache[season_id] = db.get(Season, season_id)
        season = season_cache[season_id]
        if season is None:
            return False

        if season_id not in eligible_profile_ids_cache:
            memberships = self.membership_repo.list_for_season(db, season_id)
            eligible_profile_ids_cache[season_id] = {
                membership.profile_id
                for membership in memberships
                if self.eligibility_service.counts_for_scoring(db, season, membership)
            }
        return profile_id in eligible_profile_ids_cache[season_id]
