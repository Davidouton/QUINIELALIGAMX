from decimal import Decimal

from conftest import MATCH_ONE_ID, MATCHDAY_ID, PROFILE_LEADER_ID, PROFILE_USER_ID, SEASON_ID, SessionLocal
from app.api.v1.routes.admin import sync_weekly_awards_for_trophy_asset
from app.models.entities import (
    MatchResult,
    PickSelection,
    Profile,
    ProfileTrophyAward,
    RoleCode,
    SeasonMembership,
    StandingsMatchday,
    StandingsOverall,
    TrophyAsset,
    UserPick,
)
from app.services.scoring_service import ScoringService


def test_scoring_uses_competition_ranking_for_tied_points():
    third_profile_id = "10000000-0000-0000-0000-000000000003"
    third_membership_id = "70000000-0000-0000-0000-000000000003"

    db = SessionLocal()
    try:
        db.add(
            Profile(
                id=third_profile_id,
                auth_user_id="33333333-3333-3333-3333-333333333333",
                email="third@example.com",
                display_name="Tercero",
                role_code=RoleCode.USER,
                is_active=True,
            )
        )
        db.add(
            SeasonMembership(
                id=third_membership_id,
                season_id=SEASON_ID,
                profile_id=third_profile_id,
                is_active=True,
                is_paid=True,
            )
        )
        db.add_all(
            [
                UserPick(
                    profile_id=PROFILE_USER_ID,
                    match_id=MATCH_ONE_ID,
                    selection=PickSelection.HOME,
                    predicted_home_score=2,
                    predicted_away_score=0,
                ),
                UserPick(
                    profile_id=PROFILE_LEADER_ID,
                    match_id=MATCH_ONE_ID,
                    selection=PickSelection.HOME,
                    predicted_home_score=3,
                    predicted_away_score=1,
                ),
                UserPick(
                    profile_id=third_profile_id,
                    match_id=MATCH_ONE_ID,
                    selection=PickSelection.AWAY,
                    predicted_home_score=0,
                    predicted_away_score=1,
                ),
                MatchResult(
                    match_id=MATCH_ONE_ID,
                    home_score=1,
                    away_score=0,
                    is_official=True,
                ),
            ]
        )
        db.commit()

        summary = ScoringService().recalculate(db)
        assert summary["evaluated_picks"] == 3

        matchday_rows = list(
            db.query(StandingsMatchday)
            .filter(StandingsMatchday.matchday_id == MATCHDAY_ID)
            .order_by(StandingsMatchday.total_points.desc(), StandingsMatchday.profile_id.asc())
        )
        assert [row.rank_position for row in matchday_rows] == [1, 1, 3]

        overall_rows = list(
            db.query(StandingsOverall)
            .filter(StandingsOverall.season_id == SEASON_ID)
            .order_by(StandingsOverall.total_points.desc(), StandingsOverall.profile_id.asc())
        )
        assert [row.rank_position for row in overall_rows] == [1, 1, 3]
    finally:
        db.close()


def test_prize_shares_split_absorbed_places_by_tied_group():
    shares_first = ScoringService.calculate_prize_shares(
        ranked_rows=[
            ("a", 1),
            ("b", 1),
            ("c", 3),
        ],
        first_place_amount=Decimal("1000"),
        second_place_amount=Decimal("500"),
        third_place_amount=Decimal("250"),
    )
    assert shares_first["a"] == Decimal("750")
    assert shares_first["b"] == Decimal("750")
    assert shares_first["c"] == Decimal("250")

    shares_three_way_first = ScoringService.calculate_prize_shares(
        ranked_rows=[
            ("a", 1),
            ("b", 1),
            ("c", 1),
            ("d", 4),
        ],
        first_place_amount=Decimal("900"),
        second_place_amount=Decimal("600"),
        third_place_amount=Decimal("300"),
    )
    assert shares_three_way_first["a"] == Decimal("600")
    assert shares_three_way_first["b"] == Decimal("600")
    assert shares_three_way_first["c"] == Decimal("600")
    assert "d" not in shares_three_way_first

    shares_second = ScoringService.calculate_prize_shares(
        ranked_rows=[
            ("a", 1),
            ("b", 2),
            ("c", 2),
            ("d", 4),
        ],
        first_place_amount=Decimal("1000"),
        second_place_amount=Decimal("600"),
        third_place_amount=Decimal("400"),
    )
    assert shares_second["a"] == Decimal("1000")
    assert shares_second["b"] == Decimal("500")
    assert shares_second["c"] == Decimal("500")
    assert "d" not in shares_second

    shares_third = ScoringService.calculate_prize_shares(
        ranked_rows=[
            ("a", 1),
            ("b", 2),
            ("c", 3),
            ("d", 3),
        ],
        first_place_amount=Decimal("1000"),
        second_place_amount=Decimal("600"),
        third_place_amount=Decimal("400"),
    )
    assert shares_third["a"] == Decimal("1000")
    assert shares_third["b"] == Decimal("600")
    assert shares_third["c"] == Decimal("200")
    assert shares_third["d"] == Decimal("200")


def test_recalculate_creates_weekly_badge_awards_when_assets_exist():
    third_profile_id = "10000000-0000-0000-0000-000000000003"
    third_membership_id = "70000000-0000-0000-0000-000000000003"

    db = SessionLocal()
    try:
        db.add(
            Profile(
                id=third_profile_id,
                auth_user_id="33333333-3333-3333-3333-333333333333",
                email="third@example.com",
                display_name="Tercero",
                role_code=RoleCode.USER,
                is_active=True,
            )
        )
        db.add(
            SeasonMembership(
                id=third_membership_id,
                season_id=SEASON_ID,
                profile_id=third_profile_id,
                is_active=True,
                is_paid=True,
            )
        )
        db.add_all(
            [
                TrophyAsset(
                    id="80000000-0000-0000-0000-000000000001",
                    name="Badge J3 1er",
                    category="Badge Jornada",
                    season_id=SEASON_ID,
                    matchday_number=3,
                    award_place_label="1er Lugar",
                    image_url="https://example.com/j3-1.png",
                ),
                TrophyAsset(
                    id="80000000-0000-0000-0000-000000000003",
                    name="Badge J3 3er",
                    category="Badge Jornada",
                    season_id=SEASON_ID,
                    matchday_number=3,
                    award_place_label="3er Lugar",
                    image_url="https://example.com/j3-3.png",
                ),
                UserPick(
                    profile_id=PROFILE_USER_ID,
                    match_id=MATCH_ONE_ID,
                    selection=PickSelection.HOME,
                    predicted_home_score=2,
                    predicted_away_score=0,
                ),
                UserPick(
                    profile_id=PROFILE_LEADER_ID,
                    match_id=MATCH_ONE_ID,
                    selection=PickSelection.HOME,
                    predicted_home_score=3,
                    predicted_away_score=1,
                ),
                UserPick(
                    profile_id=third_profile_id,
                    match_id=MATCH_ONE_ID,
                    selection=PickSelection.AWAY,
                    predicted_home_score=0,
                    predicted_away_score=1,
                ),
                MatchResult(
                    match_id=MATCH_ONE_ID,
                    home_score=1,
                    away_score=0,
                    is_official=True,
                ),
            ]
        )
        db.commit()

        summary = ScoringService().recalculate(db)
        assert summary["weekly_awards"] == 3

        awards = list(
            db.query(ProfileTrophyAward)
            .filter(ProfileTrophyAward.source_type == "weekly_matchday")
            .order_by(ProfileTrophyAward.place_label.asc(), ProfileTrophyAward.profile_id.asc())
        )
        assert len(awards) == 3
        assert [award.place_label for award in awards] == ["1er Lugar", "1er Lugar", "3er Lugar"]
        assert awards[0].matchday_id == MATCHDAY_ID
        assert awards[0].season_id == SEASON_ID
    finally:
        db.close()


def test_recalculate_uses_generic_weekly_badges_without_season():
    db = SessionLocal()
    try:
        db.add_all(
            [
                TrophyAsset(
                    id="80000000-0000-0000-0000-000000000011",
                    name="Badge Global J3 1er",
                    category="Badge Jornada",
                    season_id=None,
                    matchday_number=3,
                    award_place_label="1er Lugar",
                    image_url="https://example.com/global-j3-1.png",
                ),
                UserPick(
                    profile_id=PROFILE_USER_ID,
                    match_id=MATCH_ONE_ID,
                    selection=PickSelection.HOME,
                    predicted_home_score=2,
                    predicted_away_score=0,
                ),
                MatchResult(
                    match_id=MATCH_ONE_ID,
                    home_score=1,
                    away_score=0,
                    is_official=True,
                ),
            ]
        )
        db.commit()

        summary = ScoringService().recalculate(db)
        assert summary["weekly_awards"] == 1

        award = db.query(ProfileTrophyAward).filter(ProfileTrophyAward.source_type == "weekly_matchday").one()
        assert award.profile_id == PROFILE_USER_ID
        assert award.place_label == "1er Lugar"
        assert award.matchday_id == MATCHDAY_ID
    finally:
        db.close()


def test_sync_weekly_awards_for_trophy_asset_backfills_existing_standings():
    db = SessionLocal()
    try:
        db.add_all(
            [
                UserPick(
                    profile_id=PROFILE_USER_ID,
                    match_id=MATCH_ONE_ID,
                    selection=PickSelection.HOME,
                    predicted_home_score=2,
                    predicted_away_score=0,
                ),
                MatchResult(
                    match_id=MATCH_ONE_ID,
                    home_score=1,
                    away_score=0,
                    is_official=True,
                ),
            ]
        )
        db.commit()
        ScoringService().recalculate(db)

        asset = TrophyAsset(
            id="80000000-0000-0000-0000-000000000021",
            name="Badge Backfill J3 1er",
            category="Badge Jornada",
            season_id=None,
            matchday_number=3,
            award_place_label="1er Lugar",
            image_url="https://example.com/backfill-j3-1.png",
        )
        db.add(asset)
        db.flush()

        created = sync_weekly_awards_for_trophy_asset(db, asset)
        db.commit()

        assert created == 1
        awards = list(db.query(ProfileTrophyAward).filter(ProfileTrophyAward.trophy_asset_id == asset.id))
        assert len(awards) == 1
        assert awards[0].profile_id == PROFILE_USER_ID
    finally:
        db.close()
