from app.core.config import Settings
from app.providers.the_odds_scores_provider import TheOddsScoresProvider


def test_fetch_results_for_dates_normalizes_completed_scores(monkeypatch) -> None:
    provider = TheOddsScoresProvider(
        Settings(
            _env_file=None,
            the_odds_api_key="test-key",
            the_odds_api_sport="soccer_mexico_ligamx",
        )
    )
    requested_days_from: list[int] = []

    def fake_request_json(path: str, params: dict[str, object]) -> list[dict]:
        assert path == "/sports/soccer_mexico_ligamx/scores/"
        requested_days_from.append(int(params["daysFrom"]))
        return [
            {
                "id": "09237654b3417ce61e3c553356ca0a8b",
                "sport_key": "soccer_mexico_ligamx",
                "commence_time": "2026-05-03T23:00:00Z",
                "completed": True,
                "home_team": "America",
                "away_team": "Pumas",
                "scores": [
                    {"name": "America", "score": "3"},
                    {"name": "Pumas", "score": "3"},
                ],
                "last_update": "2026-05-04T08:45:45Z",
            },
            {
                "id": "future-fixture",
                "sport_key": "soccer_mexico_ligamx",
                "commence_time": "2026-05-10T23:00:00Z",
                "completed": False,
                "home_team": "Pachuca",
                "away_team": "Toluca",
                "scores": None,
                "last_update": None,
            },
        ]

    monkeypatch.setattr(provider, "_request_json", fake_request_json)

    records = provider.fetch_results_for_dates(["2026-05-02", "2026-05-03"])

    assert requested_days_from == [3]
    assert len(records) == 1
    assert records[0]["external_id"] == "09237654b3417ce61e3c553356ca0a8b"
    assert records[0]["home_score"] == 3
    assert records[0]["away_score"] == 3
    assert records[0]["is_official"] is True
    assert records[0]["status"] == "completed"
    assert records[0]["source_match_date"] == "2026-05-03"
