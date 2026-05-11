from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import HistoricalChampion, Matchday, Profile, Season, StandingsMatchday, StandingsOverall, TrophyAsset
from app.repositories.leaderboard_repository import LeaderboardRepository
from app.schemas.leaderboard import (
    HallOfFameEntry,
    HallOfFameResponse,
    HallOfFameTournamentPodium,
    LeaderboardEntry,
    MyMatchdayPointsEntry,
    PerformanceRacePoint,
    PerformanceRaceResponse,
)
from app.services.scoring_service import ScoringService


class LeaderboardService:
    def __init__(self) -> None:
        self.repo = LeaderboardRepository()

    def list_overall(self, db: Session, season_id: str | None = None) -> list[LeaderboardEntry]:
        season = self._resolve_season(db, season_id)
        rows = self.repo.list_overall(db, season.id if season is not None else None)
        return [self._overall_entry(standing, profile) for standing, profile in rows]

    def list_matchday(self, db: Session, matchday_id: str) -> list[LeaderboardEntry]:
        rows = self.repo.list_matchday(db, matchday_id)
        return [self._matchday_entry(standing, profile) for standing, profile in rows]

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
            .where(StandingsMatchday.matchday_id.in_([matchday.id for matchday in tournament_matchdays]))
            .order_by(StandingsMatchday.matchday_id.asc(), StandingsMatchday.rank_position.asc(), Profile.display_name.asc())
        ).all()

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
            select(StandingsMatchday, Profile)
            .join(Profile, Profile.id == StandingsMatchday.profile_id)
        ).all()

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
        for standing, profile in matchday_rows:
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

    def _overall_entry(self, standing: StandingsOverall, profile: Profile) -> LeaderboardEntry:
        return LeaderboardEntry(
            profile_id=profile.id,
            display_name=profile.display_name,
            role_code=profile.role_code.value,
            total_points=standing.total_points,
            correct_results=standing.correct_results,
            exact_scores=standing.exact_scores,
            rank_position=standing.rank_position,
        )

    def _matchday_entry(self, standing: StandingsMatchday, profile: Profile) -> LeaderboardEntry:
        return LeaderboardEntry(
            profile_id=profile.id,
            display_name=profile.display_name,
            role_code=profile.role_code.value,
            total_points=standing.total_points,
            correct_results=standing.correct_results,
            exact_scores=standing.exact_scores,
            rank_position=standing.rank_position,
        )

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

    def _resolve_season(self, db: Session, season_id: str | None) -> Season | None:
        if season_id:
            return db.get(Season, season_id)
        return db.query(Season).filter(Season.is_active.is_(True)).first()

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
