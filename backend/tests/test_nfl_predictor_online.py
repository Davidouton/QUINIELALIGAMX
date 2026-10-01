from contextlib import contextmanager

import pandas as pd
import pytest

from app.api.v1.routes import nfl_predictor as route
from app.nfl_predictor import online


def schedule():
    return pd.DataFrame(
        [
            dict(
                season=2026,
                week=4,
                game_type="REG",
                gameday="2026-10-01",
                gametime="20:15",
                home_team="LA",
                away_team="SF",
                home_score=None,
                away_score=None,
                spread_line=3.5,
                home_moneyline=-180,
                away_moneyline=160,
                total_line=45.5,
            )
        ]
    )


def test_schedule_handicap_timezone_identity():
    row = online.normalize_schedule(schedule())[0]
    assert row["spread_close"] == -3.5
    assert row["Game_ID"] == "2026_04_SF_LAR"
    assert pd.Timestamp(row["kickoff_at"]) == pd.Timestamp("2026-10-02T00:15:00Z")
    assert row["home_points"] is None


def test_missing_kickoff_is_not_guessed():
    raw = schedule()
    raw["gametime"] = None
    assert online.normalize_schedule(raw)[0]["kickoff_at"] is None


def event(updated="2026-09-30T12:00:00Z"):
    return dict(
        id="odds1",
        commence_time="2026-10-02T00:15:00Z",
        home_team="Los Angeles Rams",
        away_team="San Francisco 49ers",
        bookmakers=[
            dict(
                key="draftkings",
                last_update=updated,
                markets=[
                    dict(
                        key="h2h",
                        outcomes=[
                            dict(name="Los Angeles Rams", price=-150),
                            dict(name="San Francisco 49ers", price=130),
                        ],
                    )
                ],
            )
        ],
    )


def test_odds_missing_market_not_replaced_by_old_price():
    frame = online.load_frame(online.normalize_schedule(schedule()))
    result, snapshots = online.overlay_odds(
        frame, [event()], pd.Timestamp("2026-09-30T12:00:00Z"), "draftkings"
    )
    assert len(snapshots) == 1
    assert result.iloc[0].home_ml == -150
    assert pd.isna(result.iloc[0].spread_close)
    assert pd.isna(result.iloc[0].total_close)


def test_started_game_and_stale_quote_are_excluded():
    frame = online.load_frame(online.normalize_schedule(schedule()))
    assert not online.overlay_odds(
        frame, [event()], pd.Timestamp("2026-10-03T12:00:00Z"), "draftkings"
    )[1]
    assert not online.overlay_odds(
        frame, [event("2026-09-01T00:00:00Z")], pd.Timestamp("2026-09-30T12:00:00Z"), "draftkings"
    )[1]


class FakeStore:
    def __init__(self):
        self.status = None
        self.unlocked = False
        self.published = False

    def lock(self):
        return True

    def unlock(self):
        self.unlocked = True

    def start(self, r):
        self.status = "running"

    def progress(self, r, s):
        pass

    def finish(self, r, s, d):
        self.status = s

    def games(self):
        return online.normalize_schedule(schedule())


def test_pipeline_failure_never_publishes(monkeypatch):
    store = FakeStore()

    def fail(s):
        raise RuntimeError("provider unavailable")

    monkeypatch.setattr(online, "sync_schedule", fail)
    with pytest.raises(RuntimeError):
        online.execute(store, pd.Timestamp("2026-09-30T12:00:00Z"))
    assert store.status == "failed" and store.unlocked and not store.published


def test_no_upcoming_games_skips_odds_request(monkeypatch):
    store = FakeStore()
    monkeypatch.setattr(online, "sync_schedule", lambda s: 1)

    def fail():
        pytest.fail("should not consume odds quota")

    monkeypatch.setattr(online, "fetch_odds", fail)
    online.execute(store, pd.Timestamp("2027-09-01T12:00:00Z"))
    assert store.status == "skipped" and store.unlocked


def test_authenticated_dashboard(client, monkeypatch):
    class Fake:
        def dashboard(self, s, w):
            return {"predictions": [], "runs": [], "periods": [{"season": s, "week": w}]}

    @contextmanager
    def connect():
        yield Fake()

    monkeypatch.setattr(route, "connection", connect)
    response = client.get("/api/v1/nfl-predictor?season=2026&week=4")
    assert response.status_code == 200
    assert response.json()["periods"] == [{"season": 2026, "week": 4}]
    assert client.get("/api/v1/nfl-predictor?week=99").status_code == 422


def test_missing_schema_has_useful_error(client, monkeypatch):
    import psycopg

    @contextmanager
    def connect():
        raise psycopg.errors.UndefinedTable()
        yield

    monkeypatch.setattr(route, "connection", connect)
    response = client.get("/api/v1/nfl-predictor")
    assert response.status_code == 503
    assert "pendiente" in response.json()["detail"]


def test_anonymous_cannot_read_predictions(client):
    from app.api.deps import get_current_profile
    from app.main import app

    app.dependency_overrides.pop(get_current_profile, None)
    assert client.get("/api/v1/nfl-predictor").status_code in (401, 403)
