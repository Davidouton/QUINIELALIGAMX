import pytest
from fastapi import HTTPException

from app.api.v1.routes.admin import normalize_nfl_spread_line


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("-3.5", ("-3.5", "+3.5")),
        ("+7", ("+7", "-7")),
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
