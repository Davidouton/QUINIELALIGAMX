from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.api.v1.routes.admin import normalize_nfl_spread_line
from app.models.entities import PickSelection
from app.services.scoring_service import ScoringService


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("-3.5", ("-3.5", "+3.5")),
        ("+7", ("+7", "-7")),
        ("-10", ("-10", "+10")),
        ("+20", ("+20", "-20")),
        ("100", ("+100", "-100")),
        ("-10.0", ("-10", "+10")),
        ("PK", ("0", "0")),
        ("0", ("0", "0")),
        ("", (None, None)),
    ],
)
def test_normalize_nfl_spread_line(raw: str, expected: tuple[str | None, str | None]) -> None:
    assert normalize_nfl_spread_line(raw) == expected


def test_nfl_spread_rejects_quarter_points() -> None:
    with pytest.raises(HTTPException, match="incrementos de 0.5"):
        normalize_nfl_spread_line("-3.25")


@pytest.mark.parametrize("raw", ["NaN", "sNaN", "Infinity", "-Infinity", "abc"])
def test_nfl_spread_rejects_invalid_numbers(raw: str) -> None:
    with pytest.raises(HTTPException) as error:
        normalize_nfl_spread_line(raw)
    assert error.value.status_code == 400


@pytest.mark.parametrize(
    ("side", "line", "expected"),
    [(PickSelection.HOME, "-3.5", 0), (PickSelection.AWAY, "+3.5", 1),
     (PickSelection.HOME, "-3", 0), (PickSelection.AWAY, "+3", 0),
     (PickSelection.HOME, "-2.5", 1)],
)
def test_nfl_pick_scores_only_the_spread(side, line, expected) -> None:
    points = ScoringService()._calculate_pick_points(
        pick=SimpleNamespace(
            selection=PickSelection.HOME,
            spread_selection=side,
            spread_line_value=line,
            predicted_home_score=1,
            predicted_away_score=0,
            advancing_team_id=None,
        ),
        result=SimpleNamespace(home_score=24, away_score=21, advancing_team_id=None),
        match=SimpleNamespace(stage_type=SimpleNamespace(value="regular")),
        season=SimpleNamespace(tournament_format="standard"),
        is_nfl_match=True,
        rules={"result_correct": 3, "exact_score": 2, "advancing_team": 1, "spread_correct": 3},
    )

    assert points == (0, 0, 0, expected)


@pytest.mark.parametrize("scope", ["all", "season", "matchday", "legacy"])
def test_nfl_standings_count_ats_hits_with_legacy_rule(client, scope):
    from conftest import MATCH_ONE_ID, MATCHDAY_ID, PROFILE_USER_ID, SEASON_ID, SessionLocal
    from app.models.entities import (
        Competition, MatchResult, PickPoint, ScoringRule, Season,
        StandingsMatchday, StandingsOverall, UserPick,
    )
    from app.services.leaderboard_service import LeaderboardService

    with SessionLocal() as db:
        competition = Competition(name="NFL", slug="nfl", sport_name="American Football")
        db.add(competition)
        db.flush()
        db.get(Season, SEASON_ID).competition_id = competition.id
        db.add(ScoringRule(rule_key="spread_correct", points=3, is_active=True))
        pick = UserPick(
            profile_id=PROFILE_USER_ID, match_id=MATCH_ONE_ID,
            selection=PickSelection.HOME, spread_selection=PickSelection.AWAY,
            spread_line_value="+3.5", predicted_home_score=24, predicted_away_score=21,
        )
        db.add(pick)
        db.add(MatchResult(match_id=MATCH_ONE_ID, home_score=24, away_score=21, is_official=True))
        db.flush()
        if scope == "legacy":
            db.add(PickPoint(
                pick_id=pick.id, profile_id=PROFILE_USER_ID, match_id=MATCH_ONE_ID,
                matchday_id=MATCHDAY_ID, result_points=0, exact_score_points=0,
                spread_points=3, total_points=3,
            ))
            db.add(StandingsOverall(
                season_id=SEASON_ID, profile_id=PROFILE_USER_ID,
                total_points=3, correct_results=0, exact_scores=0, rank_position=1,
            ))
        db.commit()
        scoring = ScoringService()
        if scope == "all":
            scoring.recalculate(db)
        elif scope == "season":
            scoring.recalculate_season(db, SEASON_ID)
        elif scope == "matchday":
            scoring.recalculate_matchday(db, MATCHDAY_ID)
        else:
            LeaderboardService().list_overall(db, SEASON_ID)
        points = db.query(PickPoint).filter_by(profile_id=PROFILE_USER_ID).one()
        assert points.spread_points == points.total_points == 1
        for model, filters in [
            (StandingsOverall, {"season_id": SEASON_ID}),
            (StandingsMatchday, {"matchday_id": MATCHDAY_ID}),
        ]:
            standing = db.query(model).filter_by(profile_id=PROFILE_USER_ID, **filters).one()
            assert standing.total_points == standing.correct_results == 1


def test_weekly_ranking_respects_tiebreak_without_adding_points():
    from app.models.entities import RoleCode
    from app.services.leaderboard_service import LeaderboardService

    rows = [
        (SimpleNamespace(total_points=1, correct_results=1, exact_scores=0, tiebreak_difference=diff),
         SimpleNamespace(id=name, display_name=name, username=None, role_code=RoleCode.USER))
        for name, diff in [("Ana", 8), ("Beto", 0), ("Carlos", 0)]
    ]
    result = LeaderboardService()._matchday_entries(rows)
    assert [(row.display_name, row.rank_position) for row in result] == [
        ("Beto", 1), ("Carlos", 1), ("Ana", 3),
    ]
    assert all(row.total_points == row.correct_results == 1 for row in result)
