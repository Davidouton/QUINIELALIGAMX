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


def test_nfl_pick_scores_only_the_spread() -> None:
    points = ScoringService()._calculate_pick_points(
        pick=SimpleNamespace(
            selection=PickSelection.HOME,
            spread_selection=PickSelection.HOME,
            spread_line_value="-3.5",
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

    assert points == (0, 0, 0, 0)
