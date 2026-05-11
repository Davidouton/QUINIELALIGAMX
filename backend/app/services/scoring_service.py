from collections import defaultdict
from decimal import Decimal

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models.entities import (
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
            official_matchday_ids_by_season[season_id].add(match.matchday_id)
            if season_id not in eligible_profiles_by_season:
                eligible_profiles_by_season[season_id] = [
                    membership.profile_id
                    for membership in self.membership_repo.list_for_season(db, season_id)
                    if self.eligibility_service.can_participate(db, season, membership)
                ]

            membership_key = (season_id, pick.profile_id)
            if membership_key not in membership_cache:
                membership = self.membership_repo.get_for_profile_and_season(db, pick.profile_id, season_id)
                membership_cache[membership_key] = self.eligibility_service.can_participate(db, season, membership)
            if not membership_cache[membership_key]:
                continue

            evaluated_picks += 1
            winner = self._resolve_winner(result.home_score, result.away_score)
            result_points = rules["result_correct"] if pick.selection == winner else 0
            exact_points = (
                rules["exact_score"]
                if pick.predicted_home_score == result.home_score
                and pick.predicted_away_score == result.away_score
                else 0
            )
            advancing_points = (
                rules["advancing_team"]
                if match.stage_type.value not in {"regular", "group"}
                and pick.advancing_team_id is not None
                and pick.advancing_team_id == result.advancing_team_id
                else 0
            )
            total_points = result_points + exact_points + advancing_points

            db.add(
                PickPoint(
                    pick_id=pick.id,
                    profile_id=pick.profile_id,
                    match_id=match.id,
                    matchday_id=match.matchday_id,
                    result_points=result_points,
                    exact_score_points=exact_points,
                    advancing_team_points=advancing_points,
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
        previous_signature: tuple[int, int] | None = None
        previous_rank = 0
        for index, (profile_id, values) in enumerate(rows, start=1):
            current_signature = (values["total_points"], values["exact_scores"])
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
        }

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
