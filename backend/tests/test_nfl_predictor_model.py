import numpy as np
import pandas as pd
import pytest

from app.nfl_predictor import data, pipeline, sources
from app.nfl_predictor import legacy_model as model


def fixtures():
    dates = pd.to_datetime(["2025-09-01", "2025-09-08", "2025-09-15"])
    return pd.DataFrame(
        {
            "date": dates,
            "season": 2025,
            "week": [1, 2, 3],
            "home_team": ["KC", "BUF", "KC"],
            "away_team": ["BUF", "KC", "BUF"],
            "home_points": [24.0, 17.0, np.nan],
            "away_points": [21.0, 28.0, np.nan],
            "home_ml": -110.0,
            "away_ml": -110.0,
            "spread_close": -3.0,
            "total_close": 45.0,
        }
    )


def test_same_day_results_never_enter_features_and_future_has_history():
    games = fixtures()
    prepared = data.prepare(games, None, [(2025, 2), (2025, 3)])
    assert prepared.loc[0, "home_elo_pre"] == 1500
    assert prepared.loc[1, "away_elo_pre"] == 1510
    assert prepared.loc[2, "home_pf_ma"] == 26
    changed = games.copy()
    changed.loc[1, ["home_points", "away_points"]] = [99.0, 0.0]
    again = data.prepare(changed, None, [(2025, 2), (2025, 3)])
    cols = ["home_elo_pre", "away_elo_pre", "home_pf_ma", "away_pf_ma"]
    pd.testing.assert_series_equal(prepared.loc[1, cols], again.loc[1, cols])


def test_aliases():
    assert [data.team_name(t) for t in ["ARZ", "LAS", "NYY", "LA", "OAK", "JAC"]] == [
        "ARI",
        "LV",
        "NYJ",
        "LAR",
        "LV",
        "JAX",
    ]


def test_epa_future_join_and_season_boundary(tmp_path):
    metrics = [
        "off_epa_per_play",
        "def_epa_allowed_per_play",
        "off_success_rate",
        "def_success_rate_allowed",
        "off_pass_epa_per_play",
        "off_rush_epa_per_play",
        "off_pass_success_rate",
        "off_rush_success_rate",
    ]
    raw = pd.DataFrame(
        {
            "team": ["KC", "KC"],
            "season": [2025, 2025],
            "game_date": ["2025-09-01", "2025-09-08 00:00:00"],
            **{k: [0.2, 0.6] for k in metrics},
        }
    )
    path = tmp_path / "epa.csv"
    raw.to_csv(path, index=False)
    hist = data.epa_history(path)
    games = fixtures()
    games["feature_cutoff"] = games.date
    joined = data.attach_prior(games, hist, ["off_epa_per_play_asof"], season_bound=True)
    assert joined.loc[2, "home_off_epa_per_play_asof"] == pytest.approx(0.4)
    games.loc[2, "season"] = 2026
    joined = data.attach_prior(games, hist, ["off_epa_per_play_asof"], season_bound=True)
    assert pd.isna(joined.loc[2, "home_off_epa_per_play_asof"])


@pytest.mark.parametrize("line", [-3.0, -3.5, 0.0, 7.0])
def test_spread_probabilities_include_push(line):
    win, push, lose = model.cover_probs_skellam(
        np.array([24.0]), np.array([21.0]), np.array([line])
    )
    assert (win + push + lose)[0] == pytest.approx(1)
    assert push[0] >= 0
    if line % 1:
        assert push[0] == 0


def test_total_probabilities_include_push():
    over, push, under = model.totals_probs_poisson(
        np.array([24.0]), np.array([21.0]), np.array([45.0])
    )
    assert (over + push + under)[0] == pytest.approx(1)
    assert push[0] > 0


@pytest.mark.parametrize(
    "odds,expected", [(-110, 1 + 100 / 110), (150, 2.5), (1.91, 1.91), (100, 2.0)]
)
def test_odds(odds, expected):
    assert pipeline.decimal_odds(odds) == pytest.approx(expected)


def test_missing_key_is_clear(monkeypatch, tmp_path):
    monkeypatch.delenv("ODDS_API_KEY", raising=False)
    with pytest.raises(ValueError, match="ODDS_API_KEY"):
        sources.odds(tmp_path / "odds.csv")


def test_missing_calendar():
    with pytest.raises(ValueError, match="No hay calendario"):
        pipeline.run(fixtures(), [(2026, 1)])


def test_export_and_push_ev(tmp_path):
    row = fixtures().iloc[[0]].copy()
    values = {
        "Game_ID": "provider-id",
        "lambda_home": 24.0,
        "lambda_away": 21.0,
        "p_home_ensemble": 0.6,
        "p_ml_push": 0.1,
        "p_home_cover": 0.5,
        "p_spread_push": 0.1,
        "p_away_cover": 0.4,
        "p_over": 0.4,
        "p_total_push": 0.1,
        "p_under": 0.5,
        "alpha_used": 0.6,
        "tau_used": 1.0,
        "home_spread_odds": 100.0,
        "away_spread_odds": 100.0,
        "over_odds": 100.0,
        "under_odds": 100.0,
    }
    for key, value in values.items():
        row[key] = value
    bets = pipeline.betting_table(row)
    assert bets.iloc[2].EV_por_unidad == pytest.approx(0.1)
    path = pipeline.export(row, tmp_path, {"test": True})
    assert pd.ExcelFile(path).sheet_names == ["Predicciones", "Apuestas", "Auditoria", "Ejecucion"]
    assert len(pd.read_excel(path, sheet_name="Apuestas")) == 6
    row["p_home_cover"] = np.nan
    row["p_away_cover"] = np.nan
    assert model.build_report(row).iloc[0]["Cover_Prediction (H,A)"] == ""
