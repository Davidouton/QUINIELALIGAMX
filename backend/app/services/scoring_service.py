from collections import defaultdict
from decimal import Decimal
from decimal import InvalidOperation

from sqlalchemy import delete, select, text
from sqlalchemy.orm import Session

from app.models.entities import (
    Competition,
    Match,
    MatchResult,
    Matchday,
    PickPoint,
    PickSelection,
    ProfileTrophyAward,
    ScoringRule,
    Season,
    StandingsMatchday,
    StandingsOverall,
    TournamentFormat,
    TrophyAsset,
    UserPick,
    WeeklyLeader,
)
from app.repositories.season_membership_repository import SeasonMembershipRepository
from app.services.season_eligibility_service import SeasonEligibilityService


class ScoringService:
    def __init__(self) -> None:
        self.membership_repo = SeasonMembershipRepository()
        self.eligibility_service = SeasonEligibilityService()

    def recalculate(self, db: Session) -> dict[str, int]:
        rules = self._load_rules(db)
        empty_bucket = {"total_points": 0, "correct_results": 0, "exact_scores": 0}

        db.execute(delete(PickPoint))
        db.execute(delete(StandingsMatchday))
        db.execute(delete(StandingsOverall))
        db.execute(delete(WeeklyLeader))
        db.execute(delete(ProfileTrophyAward).where(ProfileTrophyAward.source_type == "weekly_matchday"))

        rows = db.execute(
            select(UserPick, MatchResult, Match)
            .join(Match, Match.id == UserPick.match_id)
            .join(MatchResult, MatchResult.match_id == Match.id)
            .where(MatchResult.is_official.is_(True))
        ).all()

        matchday_agg: dict[tuple[str, str], dict[str, int]] = defaultdict(
            lambda: {"total_points": 0, "correct_results": 0, "exact_scores": 0}
        )
        season_agg: dict[tuple[str, str], dict[str, int]] = defaultdict(
            lambda: {"total_points": 0, "correct_results": 0, "exact_scores": 0}
        )
        season_cache: dict[str, Season | None] = {}
        competition_cache: dict[str, Competition | None] = {}
        matchday_cache: dict[str, Matchday | None] = {}
        membership_cache: dict[tuple[str, str], bool] = {}
        eligible_profiles_by_season: dict[str, list[str]] = {}
        official_matchday_ids_by_season: dict[str, set[str]] = defaultdict(set)
        evaluated_picks = 0

        for pick, result, match in rows:
            season_id = db.scalar(select(Matchday.season_id).where(Matchday.id == match.matchday_id))
            if season_id is None:
                continue
            if season_id not in season_cache:
                season = db.get(Season, season_id)
                season_cache[season_id] = season
                if season is not None:
                    self.eligibility_service.freeze_season_if_due(db, season)
            season = season_cache[season_id]
            if season is None:
                continue
            competition = None
            if season.competition_id is not None:
                if season.competition_id not in competition_cache:
                    competition_cache[season.competition_id] = db.get(Competition, season.competition_id)
                competition = competition_cache[season.competition_id]
            is_nfl_match = self._is_nfl_competition(competition)
            official_matchday_ids_by_season[season_id].add(match.matchday_id)
            if season_id not in eligible_profiles_by_season:
                eligible_profiles_by_season[season_id] = [
                    membership.profile_id
                    for membership in self.membership_repo.list_for_season(db, season_id)
                    if self.eligibility_service.counts_for_scoring(db, season, membership)
                ]

            membership_key = (season_id, pick.profile_id)
            if membership_key not in membership_cache:
                membership = self.membership_repo.get_for_profile_and_season(db, pick.profile_id, season_id)
                membership_cache[membership_key] = self.eligibility_service.counts_for_scoring(db, season, membership)
            if not membership_cache[membership_key]:
                continue

            evaluated_picks += 1
            winner = self._resolve_winner(result.home_score, result.away_score)
            result_points = rules["result_correct"] if pick.selection == winner else 0
            exact_points = 0
            if not is_nfl_match:
                exact_points = (
                    rules["exact_score"]
                    if pick.predicted_home_score == result.home_score
                    and pick.predicted_away_score == result.away_score
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
            if is_nfl_match:
                spread_points = self._calculate_spread_points(
                    result.home_score,
                    result.away_score,
                    pick.spread_selection,
                    pick.spread_line_value,
                    rules["spread_correct"],
                )
            total_points = result_points + exact_points + advancing_points + spread_points

            db.add(
                PickPoint(
                    pick_id=pick.id,
                    profile_id=pick.profile_id,
                    match_id=match.id,
                    matchday_id=match.matchday_id,
                    result_points=result_points,
                    exact_score_points=exact_points,
                    advancing_team_points=advancing_points,
                    spread_points=spread_points,
                    total_points=total_points,
                )
            )

            matchday_key = (match.matchday_id, pick.profile_id)
            matchday_agg[matchday_key]["total_points"] += total_points
            matchday_agg[matchday_key]["correct_results"] += 1 if result_points else 0
            matchday_agg[matchday_key]["exact_scores"] += 1 if exact_points else 0

            season_key = (season_id, pick.profile_id)
            season_agg[season_key]["total_points"] += total_points
            season_agg[season_key]["correct_results"] += 1 if result_points else 0
            season_agg[season_key]["exact_scores"] += 1 if exact_points else 0

        for season_id, participant_ids in eligible_profiles_by_season.items():
            for profile_id in participant_ids:
                season_agg.setdefault((season_id, profile_id), empty_bucket.copy())
                for matchday_id in official_matchday_ids_by_season.get(season_id, set()):
                    matchday_agg.setdefault((matchday_id, profile_id), empty_bucket.copy())

        weekly_leaders = 0
        weekly_awards = 0
        matchday_ids = list({matchday_id for matchday_id, _ in matchday_agg.keys()})
        trophy_assets = list(
            db.scalars(
                select(TrophyAsset).where(
                    TrophyAsset.matchday_number.is_not(None),
                    TrophyAsset.award_place_label.is_not(None),
                )
            )
        )
        season_specific_trophy_asset_map: dict[tuple[str, int, str], TrophyAsset] = {}
        generic_trophy_asset_map: dict[tuple[int, str], TrophyAsset] = {}
        for trophy_asset in trophy_assets:
            if trophy_asset.season_id:
                season_specific_trophy_asset_map[
                    (
                        trophy_asset.season_id,
                        trophy_asset.matchday_number,
                        trophy_asset.award_place_label,
                    )
                ] = trophy_asset
            else:
                generic_trophy_asset_map[
                    (
                        trophy_asset.matchday_number,
                        trophy_asset.award_place_label,
                    )
                ] = trophy_asset
        for matchday_id in {matchday_id for matchday_id, _ in matchday_agg.keys()}:
            matchday = matchday_cache.get(matchday_id)
            if matchday is None:
                matchday = db.get(Matchday, matchday_id)
                matchday_cache[matchday_id] = matchday
            if matchday is None:
                continue
            season = season_cache.get(matchday.season_id)
            if season is None:
                season = db.get(Season, matchday.season_id)
                season_cache[matchday.season_id] = season

            rows_for_matchday = [
                (profile_id, values)
                for (current_matchday_id, profile_id), values in matchday_agg.items()
                if current_matchday_id == matchday_id
            ]
            rows_for_matchday.sort(
                key=lambda item: (-item[1]["total_points"], -item[1]["exact_scores"], item[0])
            )
            ranked_rows = self._apply_competition_ranks(rows_for_matchday)
            weekly_leader_recorded = False
            for profile_id, values, position in ranked_rows:
                db.add(
                    StandingsMatchday(
                        matchday_id=matchday_id,
                        profile_id=profile_id,
                        total_points=values["total_points"],
                        correct_results=values["correct_results"],
                        exact_scores=values["exact_scores"],
                        rank_position=position,
                    )
                )
                if position == 1 and not weekly_leader_recorded:
                    db.add(
                        WeeklyLeader(
                            matchday_id=matchday_id,
                            profile_id=profile_id,
                            total_points=values["total_points"],
                        )
                    )
                    weekly_leader_recorded = True
                    weekly_leaders += 1
                place_label = self._rank_to_place_label(position)
                if place_label is None:
                    continue
                badge_asset = season_specific_trophy_asset_map.get((matchday.season_id, matchday.number, place_label))
                if badge_asset is None:
                    badge_asset = generic_trophy_asset_map.get((matchday.number, place_label))
                if badge_asset is None:
                    continue
                db.add(
                    ProfileTrophyAward(
                        profile_id=profile_id,
                        trophy_asset_id=badge_asset.id,
                        season_id=matchday.season_id,
                        matchday_id=matchday_id,
                        tournament_name=season.name if season is not None else None,
                        place_label=place_label,
                        total_points=values["total_points"],
                        source_type="weekly_matchday",
                    )
                )
                weekly_awards += 1

        for season_id in {season_id for season_id, _ in season_agg.keys()}:
            rows_for_season = [
                (profile_id, values)
                for (current_season_id, profile_id), values in season_agg.items()
                if current_season_id == season_id
            ]
            rows_for_season.sort(
                key=lambda item: (-item[1]["total_points"], -item[1]["exact_scores"], item[0])
            )
            ranked_rows = self._apply_competition_ranks(rows_for_season)
            for profile_id, values, position in ranked_rows:
                db.add(
                    StandingsOverall(
                        season_id=season_id,
                        profile_id=profile_id,
                        total_points=values["total_points"],
                        correct_results=values["correct_results"],
                        exact_scores=values["exact_scores"],
                        rank_position=position,
                    )
                )

        db.commit()
        return {
            "evaluated_picks": evaluated_picks,
            "weekly_leaders": weekly_leaders,
            "weekly_awards": weekly_awards,
        }

    def recalculate_matchday(self, db: Session, matchday_id: str) -> dict[str, int]:
        if db.get_bind().dialect.name == "postgresql":
            db.execute(
                text("SELECT pg_advisory_xact_lock(hashtext(:lock_key))"),
                {"lock_key": f"scoring-matchday:{matchday_id}"},
            )
        matchday = db.get(Matchday, matchday_id)
        if matchday is None:
            return {
                "evaluated_picks": 0,
                "weekly_leaders": 0,
                "weekly_awards": 0,
            }

        season = db.get(Season, matchday.season_id)
        if season is None:
            return {
                "evaluated_picks": 0,
                "weekly_leaders": 0,
                "weekly_awards": 0,
            }

        self.eligibility_service.freeze_season_if_due(db, season)
        rules = self._load_rules(db)
        competition = db.get(Competition, season.competition_id) if season.competition_id is not None else None
        is_nfl_match = self._is_nfl_competition(competition)

        eligible_profile_ids = [
            membership.profile_id
            for membership in self.membership_repo.list_for_season(db, season.id)
            if self.eligibility_service.counts_for_scoring(db, season, membership)
        ]
        eligible_profile_id_set = set(eligible_profile_ids)

        db.execute(delete(PickPoint).where(PickPoint.matchday_id == matchday_id))

        rows = db.execute(
            select(UserPick, MatchResult, Match)
            .join(Match, Match.id == UserPick.match_id)
            .join(MatchResult, MatchResult.match_id == Match.id)
            .where(
                Match.matchday_id == matchday_id,
                MatchResult.is_official.is_(True),
            )
        ).all()

        matchday_agg: dict[str, dict[str, int]] = defaultdict(
            lambda: {"total_points": 0, "correct_results": 0, "exact_scores": 0}
        )
        evaluated_picks = 0

        for pick, result, match in rows:
            if pick.profile_id not in eligible_profile_id_set:
                continue

            evaluated_picks += 1
            result_points, exact_points, advancing_points, spread_points = self._calculate_pick_points(
                pick=pick,
                result=result,
                match=match,
                season=season,
                is_nfl_match=is_nfl_match,
                rules=rules,
            )
            total_points = result_points + exact_points + advancing_points + spread_points

            db.add(
                PickPoint(
                    pick_id=pick.id,
                    profile_id=pick.profile_id,
                    match_id=match.id,
                    matchday_id=match.matchday_id,
                    result_points=result_points,
                    exact_score_points=exact_points,
                    advancing_team_points=advancing_points,
                    spread_points=spread_points,
                    total_points=total_points,
                )
            )

            bucket = matchday_agg[pick.profile_id]
            bucket["total_points"] += total_points
            bucket["correct_results"] += 1 if result_points else 0
            bucket["exact_scores"] += 1 if exact_points else 0

        weekly_leaders, weekly_awards = self._rebuild_matchday_standings(
            db,
            season=season,
            matchday=matchday,
            eligible_profile_ids=eligible_profile_ids,
            matchday_agg=matchday_agg,
            has_official_results=bool(rows),
        )
        db.flush()
        self._rebuild_overall_standings_for_season(
            db,
            season=season,
            eligible_profile_ids=eligible_profile_ids,
        )

        db.commit()
        return {
            "evaluated_picks": evaluated_picks,
            "weekly_leaders": weekly_leaders,
            "weekly_awards": weekly_awards,
        }

    def recalculate_season(self, db: Session, season_id: str) -> dict[str, int]:
        season = db.get(Season, season_id)
        if season is None:
            return {
                "evaluated_picks": 0,
                "weekly_leaders": 0,
                "weekly_awards": 0,
            }

        matchdays = list(
            db.scalars(
                select(Matchday)
                .where(Matchday.season_id == season.id)
                .order_by(Matchday.number.asc())
            )
        )
        matchday_ids = [matchday.id for matchday in matchdays]
        if not matchday_ids:
            db.execute(delete(StandingsOverall).where(StandingsOverall.season_id == season.id))
            db.commit()
            return {
                "evaluated_picks": 0,
                "weekly_leaders": 0,
                "weekly_awards": 0,
            }

        self.eligibility_service.freeze_season_if_due(db, season)
        rules = self._load_rules(db)
        competition = db.get(Competition, season.competition_id) if season.competition_id is not None else None
        is_nfl_match = self._is_nfl_competition(competition)
        eligible_profile_ids = [
            membership.profile_id
            for membership in self.membership_repo.list_for_season(db, season.id)
            if self.eligibility_service.counts_for_scoring(db, season, membership)
        ]
        eligible_profile_id_set = set(eligible_profile_ids)

        db.execute(delete(PickPoint).where(PickPoint.matchday_id.in_(matchday_ids)))
        db.execute(delete(StandingsMatchday).where(StandingsMatchday.matchday_id.in_(matchday_ids)))
        db.execute(delete(WeeklyLeader).where(WeeklyLeader.matchday_id.in_(matchday_ids)))
        db.execute(
            delete(ProfileTrophyAward).where(
                ProfileTrophyAward.source_type == "weekly_matchday",
                ProfileTrophyAward.matchday_id.in_(matchday_ids),
            )
        )
        db.execute(delete(StandingsOverall).where(StandingsOverall.season_id == season.id))

        rows = db.execute(
            select(UserPick, MatchResult, Match)
            .join(Match, Match.id == UserPick.match_id)
            .join(MatchResult, MatchResult.match_id == Match.id)
            .where(
                Match.matchday_id.in_(matchday_ids),
                MatchResult.is_official.is_(True),
            )
        ).all()

        matchday_agg_by_matchday: dict[str, dict[str, dict[str, int]]] = defaultdict(
            lambda: defaultdict(lambda: {"total_points": 0, "correct_results": 0, "exact_scores": 0})
        )
        official_matchday_ids: set[str] = set()
        evaluated_picks = 0

        for pick, result, match in rows:
            official_matchday_ids.add(match.matchday_id)
            if pick.profile_id not in eligible_profile_id_set:
                continue

            evaluated_picks += 1
            result_points, exact_points, advancing_points, spread_points = self._calculate_pick_points(
                pick=pick,
                result=result,
                match=match,
                season=season,
                is_nfl_match=is_nfl_match,
                rules=rules,
            )
            total_points = result_points + exact_points + advancing_points + spread_points

            db.add(
                PickPoint(
                    pick_id=pick.id,
                    profile_id=pick.profile_id,
                    match_id=match.id,
                    matchday_id=match.matchday_id,
                    result_points=result_points,
                    exact_score_points=exact_points,
                    advancing_team_points=advancing_points,
                    spread_points=spread_points,
                    total_points=total_points,
                )
            )

            bucket = matchday_agg_by_matchday[match.matchday_id][pick.profile_id]
            bucket["total_points"] += total_points
            bucket["correct_results"] += 1 if result_points else 0
            bucket["exact_scores"] += 1 if exact_points else 0

        weekly_leaders = 0
        weekly_awards = 0
        for matchday in matchdays:
            matchday_agg = matchday_agg_by_matchday.get(matchday.id, {})
            matchday_weekly_leaders, matchday_weekly_awards = self._rebuild_matchday_standings(
                db,
                season=season,
                matchday=matchday,
                eligible_profile_ids=eligible_profile_ids,
                matchday_agg=matchday_agg,
                has_official_results=matchday.id in official_matchday_ids,
            )
            weekly_leaders += matchday_weekly_leaders
            weekly_awards += matchday_weekly_awards

        db.flush()
        self._rebuild_overall_standings_for_season(
            db,
            season=season,
            eligible_profile_ids=eligible_profile_ids,
        )
        db.commit()
        return {
            "evaluated_picks": evaluated_picks,
            "weekly_leaders": weekly_leaders,
            "weekly_awards": weekly_awards,
        }

    @staticmethod
    def calculate_prize_shares(
        ranked_rows: list[tuple[str, int]],
        first_place_amount: Decimal | int | float,
        second_place_amount: Decimal | int | float,
        third_place_amount: Decimal | int | float,
    ) -> dict[str, Decimal]:
        prize_pool = {
            1: Decimal(str(first_place_amount)),
            2: Decimal(str(second_place_amount)),
            3: Decimal(str(third_place_amount)),
        }
        grouped_rows: dict[int, list[str]] = defaultdict(list)
        for profile_id, rank_position in ranked_rows:
            grouped_rows[rank_position].append(profile_id)

        shares: dict[str, Decimal] = {}
        for rank_position in sorted(grouped_rows.keys()):
            if rank_position > 3:
                continue
            group = grouped_rows[rank_position]
            absorbed_places = [
                place
                for place in range(rank_position, rank_position + len(group))
                if place in prize_pool
            ]
            if not absorbed_places:
                continue
            total_prize = sum(prize_pool[place] for place in absorbed_places)
            share = total_prize / Decimal(len(group))
            for profile_id in group:
                shares[profile_id] = share
        return shares

    @staticmethod
    def _apply_competition_ranks(
        rows: list[tuple[str, dict[str, int]]],
    ) -> list[tuple[str, dict[str, int], int]]:
        ranked_rows: list[tuple[str, dict[str, int], int]] = []
        previous_signature: int | None = None
        previous_rank = 0
        for index, (profile_id, values) in enumerate(rows, start=1):
            current_signature = values["total_points"]
            if previous_signature is None or current_signature != previous_signature:
                previous_rank = index
                previous_signature = current_signature
            ranked_rows.append((profile_id, values, previous_rank))
        return ranked_rows

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

    def _calculate_pick_points(
        self,
        *,
        pick: UserPick,
        result: MatchResult,
        match: Match,
        season: Season,
        is_nfl_match: bool,
        rules: dict[str, int],
    ) -> tuple[int, int, int, int]:
        winner = self._resolve_winner(result.home_score, result.away_score)
        result_points = rules["result_correct"] if pick.selection == winner else 0
        exact_points = 0
        if not is_nfl_match:
            exact_points = (
                rules["exact_score"]
                if pick.predicted_home_score == result.home_score
                and pick.predicted_away_score == result.away_score
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
        if is_nfl_match:
            spread_points = self._calculate_spread_points(
                result.home_score,
                result.away_score,
                pick.spread_selection,
                pick.spread_line_value,
                rules["spread_correct"],
            )
        return result_points, exact_points, advancing_points, spread_points

    def _rebuild_matchday_standings(
        self,
        db: Session,
        *,
        season: Season,
        matchday: Matchday,
        eligible_profile_ids: list[str],
        matchday_agg: dict[str, dict[str, int]],
        has_official_results: bool,
    ) -> tuple[int, int]:
        db.execute(delete(StandingsMatchday).where(StandingsMatchday.matchday_id == matchday.id))
        db.execute(delete(WeeklyLeader).where(WeeklyLeader.matchday_id == matchday.id))
        db.execute(
            delete(ProfileTrophyAward).where(
                ProfileTrophyAward.source_type == "weekly_matchday",
                ProfileTrophyAward.matchday_id == matchday.id,
            )
        )

        if not has_official_results:
            return 0, 0

        empty_bucket = {"total_points": 0, "correct_results": 0, "exact_scores": 0}
        for profile_id in eligible_profile_ids:
            matchday_agg.setdefault(profile_id, empty_bucket.copy())

        rows_for_matchday = list(matchday_agg.items())
        rows_for_matchday.sort(
            key=lambda item: (-item[1]["total_points"], -item[1]["exact_scores"], item[0])
        )
        ranked_rows = self._apply_competition_ranks(rows_for_matchday)

        trophy_assets = list(
            db.scalars(
                select(TrophyAsset).where(
                    TrophyAsset.matchday_number == matchday.number,
                    TrophyAsset.award_place_label.is_not(None),
                )
            )
        )
        season_specific_trophy_asset_map: dict[tuple[str, int, str], TrophyAsset] = {}
        generic_trophy_asset_map: dict[tuple[int, str], TrophyAsset] = {}
        for trophy_asset in trophy_assets:
            if trophy_asset.season_id:
                season_specific_trophy_asset_map[
                    (trophy_asset.season_id, trophy_asset.matchday_number, trophy_asset.award_place_label)
                ] = trophy_asset
            else:
                generic_trophy_asset_map[(trophy_asset.matchday_number, trophy_asset.award_place_label)] = trophy_asset

        weekly_leaders = 0
        weekly_awards = 0
        weekly_leader_recorded = False
        for profile_id, values, position in ranked_rows:
            db.add(
                StandingsMatchday(
                    matchday_id=matchday.id,
                    profile_id=profile_id,
                    total_points=values["total_points"],
                    correct_results=values["correct_results"],
                    exact_scores=values["exact_scores"],
                    rank_position=position,
                )
            )
            if position == 1 and not weekly_leader_recorded:
                db.add(
                    WeeklyLeader(
                        matchday_id=matchday.id,
                        profile_id=profile_id,
                        total_points=values["total_points"],
                    )
                )
                weekly_leader_recorded = True
                weekly_leaders += 1

            place_label = self._rank_to_place_label(position)
            if place_label is None:
                continue
            badge_asset = season_specific_trophy_asset_map.get((matchday.season_id, matchday.number, place_label))
            if badge_asset is None:
                badge_asset = generic_trophy_asset_map.get((matchday.number, place_label))
            if badge_asset is None:
                continue
            db.add(
                ProfileTrophyAward(
                    profile_id=profile_id,
                    trophy_asset_id=badge_asset.id,
                    season_id=matchday.season_id,
                    matchday_id=matchday.id,
                    tournament_name=season.name,
                    place_label=place_label,
                    total_points=values["total_points"],
                    source_type="weekly_matchday",
                )
            )
            weekly_awards += 1

        return weekly_leaders, weekly_awards

    def _rebuild_overall_standings_for_season(
        self,
        db: Session,
        *,
        season: Season,
        eligible_profile_ids: list[str],
    ) -> None:
        db.execute(delete(StandingsOverall).where(StandingsOverall.season_id == season.id))

        has_official_results = bool(
            db.execute(
                select(MatchResult.id)
                .join(Match, Match.id == MatchResult.match_id)
                .join(Matchday, Matchday.id == Match.matchday_id)
                .where(
                    Matchday.season_id == season.id,
                    MatchResult.is_official.is_(True),
                )
                .limit(1)
            ).first()
        )
        if not has_official_results:
            return

        empty_bucket = {"total_points": 0, "correct_results": 0, "exact_scores": 0}
        season_agg: dict[str, dict[str, int]] = defaultdict(
            lambda: {"total_points": 0, "correct_results": 0, "exact_scores": 0}
        )
        point_rows = db.scalars(
            select(PickPoint)
            .join(Matchday, Matchday.id == PickPoint.matchday_id)
            .where(Matchday.season_id == season.id)
        ).all()
        eligible_profile_id_set = set(eligible_profile_ids)
        for row in point_rows:
            if row.profile_id not in eligible_profile_id_set:
                continue
            bucket = season_agg[row.profile_id]
            bucket["total_points"] += row.total_points
            bucket["correct_results"] += 1 if row.result_points else 0
            bucket["exact_scores"] += 1 if row.exact_score_points else 0

        for profile_id in eligible_profile_ids:
            season_agg.setdefault(profile_id, empty_bucket.copy())

        rows_for_season = list(season_agg.items())
        rows_for_season.sort(
            key=lambda item: (-item[1]["total_points"], -item[1]["exact_scores"], item[0])
        )
        ranked_rows = self._apply_competition_ranks(rows_for_season)
        for profile_id, values, position in ranked_rows:
            db.add(
                StandingsOverall(
                    season_id=season.id,
                    profile_id=profile_id,
                    total_points=values["total_points"],
                    correct_results=values["correct_results"],
                    exact_scores=values["exact_scores"],
                    rank_position=position,
                )
            )

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

    @staticmethod
    def _rank_to_place_label(rank_position: int) -> str | None:
        mapping = {
            1: "1er Lugar",
            2: "2do Lugar",
            3: "3er Lugar",
        }
        return mapping.get(rank_position)
