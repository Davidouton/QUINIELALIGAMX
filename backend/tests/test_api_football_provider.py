from app.core.config import Settings
from app.providers.api_football_provider import ApiFootballProvider


def test_fetch_results_for_dates_falls_back_to_previous_season_and_normalizes_fixture(monkeypatch) -> None:
    provider = ApiFootballProvider(
        Settings(
            _env_file=None,
            api_football_key="test-key",
            api_football_league_id="262",
            api_football_timezone="America/Mexico_City",
        )
    )
    requested_seasons: list[int] = []

    def fake_request_json(path: str, params: dict[str, object]) -> dict:
        assert path == "/fixtures"
        season = int(params["season"])
        requested_seasons.append(season)
        if season == 2026:
            return {"errors": [], "response": []}
        return {
            "errors": [],
            "response": [
                {
                    "fixture": {
                        "id": 2468902,
                        "date": "2026-05-03T18:00:00-05:00",
                        "status": {
                            "short": "FT",
                            "long": "Match Finished",
                        },
                    },
                    "teams": {
                        "home": {"name": "Club America"},
                        "away": {"name": "U.N.A.M. - Pumas"},
                    },
                    "goals": {
                        "home": 3,
                        "away": 3,
                    },
                    "score": {
                        "halftime": {"home": 1, "away": 1},
                        "fulltime": {"home": 3, "away": 3},
                        "extratime": {"home": None, "away": None},
                        "penalty": {"home": None, "away": None},
                    },
                }
            ],
        }

    monkeypatch.setattr(provider, "_request_json", fake_request_json)

    records = provider.fetch_results_for_dates(["2026-05-03", "2026-05-04"])

    assert requested_seasons == [2026, 2025]
    assert len(records) == 1
    assert records[0]["external_id"] == "2468902"
    assert records[0]["home_team_name"] == "Club America"
    assert records[0]["away_team_name"] == "U.N.A.M. - Pumas"
    assert records[0]["home_score"] == 3
    assert records[0]["away_score"] == 3
    assert records[0]["status"] == "FT"
    assert records[0]["is_official"] is True
    assert records[0]["source_match_date"] == "2026-05-03"
