"""Carga local y variables disponibles antes de cada partido."""

import json
from pathlib import Path

import numpy as np
import pandas as pd

from . import legacy_elo
from . import legacy_model as model

TEAM_MAP = json.loads(Path(__file__).with_name("teams.json").read_text())
ALIASES = {
    "LA": "LAR",
    "STL": "LAR",
    "OAK": "LV",
    "SD": "LAC",
    "JAC": "JAX",
    "WSH": "WAS",
    "ARZ": "ARI",
    "LAS": "LV",
    "NYY": "NYJ",
}


def team_name(value):
    name = str(value).strip()
    return ALIASES.get(TEAM_MAP.get(name, name).upper(), TEAM_MAP.get(name, name).upper())


def load_games(path):
    games = model.load_games(str(path))
    placeholders = (
        games[["date", "week", "home_team", "away_team", "home_points", "away_points"]]
        .isna()
        .all(axis=1)
    )
    if placeholders.any():
        print(f"Ignorando {int(placeholders.sum())} filas de plantilla sin partido.")
        games = games.loc[~placeholders].copy()
    if games[["home_team", "away_team"]].isna().any().any():
        raise ValueError("Hay partidos sin equipo local o visitante.")
    for c in ["home_team", "away_team"]:
        games[c] = games[c].map(team_name)
    required = ["date", "season", "week", "home_team", "away_team", "home_points", "away_points"]
    if games[required[:3]].isna().any().any():
        raise ValueError("Hay fechas, temporadas o semanas vacías o inválidas en el master.")
    if games.duplicated(["date", "home_team", "away_team"]).any():
        raise ValueError("El master contiene partidos duplicados por fecha/equipos.")
    if (games["home_team"] == games["away_team"]).any():
        raise ValueError("Hay partidos con el mismo equipo local y visitante.")
    for c in [
        "spread_close",
        "total_close",
        "home_ml",
        "away_ml",
        "home_spread_odds",
        "away_spread_odds",
        "over_odds",
        "under_odds",
    ]:
        if c not in games:
            games[c] = np.nan
    if "Game_ID" not in games:
        games["Game_ID"] = (
            games["date"].dt.strftime("%Y%m%d") + "_" + games.home_team + "_" + games.away_team
        )
    return games.reset_index(drop=True)


def elo_history(games):
    g = games.dropna(subset=["home_points", "away_points"]).copy()
    g = g.rename(
        columns={
            "date": "Date",
            "home_team": "Home_Team",
            "away_team": "Away_Team",
            "home_points": "Home_Score",
            "away_points": "Away_Score",
            "home_ml": "Home_Moneyline",
            "away_ml": "Away_Moneline",
        }
    )
    for col in ["Year", "Month", "Day"]:
        g[col] = getattr(g.Date.dt, col.lower())
    if g.empty:
        raise ValueError("No hay resultados históricos para calcular ELO.")
    history = legacy_elo.calculate_eola_market_only(g.sort_values("Date"), require_ml=True)
    return history.rename(columns={"Date": "date", "Team": "team", "ELO": "elo"})[
        ["date", "team", "elo"]
    ]


def attach_prior(games, history, columns, default=None, season_bound=False):
    """Une el último registro estrictamente anterior al corte; conserva 1 fila por partido."""
    g = games.copy()
    for side in ["home", "away"]:
        for col in columns:
            g[f"{side}_{col}"] = np.nan
        for team, indexes in g.groupby(f"{side}_team").groups.items():
            left = pd.DataFrame(
                {"cutoff": g.loc[indexes, "feature_cutoff"], "_row": indexes}
            ).sort_values("cutoff")
            right = history[history.team == team].sort_values("date")
            if right.empty:
                continue
            extra = ["season"] if season_bound else []
            merged = pd.merge_asof(
                left,
                right[["date"] + columns + extra],
                left_on="cutoff",
                right_on="date",
                direction="backward",
                allow_exact_matches=False,
            )
            if season_bound:
                good = merged.season.to_numpy() == g.loc[merged._row, "season"].to_numpy()
                merged.loc[~good, columns] = np.nan
            g.loc[merged._row, [f"{side}_{c}" for c in columns]] = merged[columns].to_numpy()
        if default is not None:
            for col in columns:
                g[f"{side}_{col}"] = g[f"{side}_{col}"].fillna(default)
    return g


def rolling_history(games, lookback):
    played = games.dropna(subset=["home_points", "away_points"])
    parts = []
    for side, other in [("home", "away"), ("away", "home")]:
        part = played[["date", f"{side}_team", f"{side}_points", f"{other}_points"]].copy()
        part.columns = ["date", "team", "pf", "pa"]
        parts.append(part)
    long = pd.concat(parts).sort_values(["team", "date"])
    long["wr"] = np.where(long.pf > long.pa, 1.0, np.where(long.pf == long.pa, 0.5, 0.0))
    for c in ["pf", "pa", "wr"]:
        long[f"{c}_ma"] = long.groupby("team")[c].transform(
            lambda s: (
                s.rolling(lookback, min_periods=1).mean() if lookback else s.expanding().mean()
            )
        )
    return long[["date", "team", "pf_ma", "pa_ma", "wr_ma"]]


def epa_history(path):
    epa = pd.read_csv(path)
    epa["team"] = epa.team.map(team_name)
    epa["date"] = pd.to_datetime(epa["game_date"], format="ISO8601")
    if epa.duplicated(["date", "team"]).any():
        raise ValueError("EPA tiene equipos/fechas duplicados.")
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
    epa = epa.sort_values(["team", "season", "date"])
    # Estados después del juego; attach_prior los une únicamente a juegos posteriores.
    for m in metrics:
        if m not in epa:
            raise ValueError(f"Falta {m} en EPA. Ejecuta metrics con el play-by-play original.")
        epa[m + "_asof"] = epa.groupby(["team", "season"])[m].transform(
            lambda s: s.expanding().mean()
        )
    return epa[["date", "team", "season"] + [m + "_asof" for m in metrics]]


def prepare(games, epa_path, targets, lookback=10):
    g = games.copy()
    g["feature_cutoff"] = g.date
    # Todas las predicciones de una semana usan datos anteriores al primer juego.
    for season, week in targets:
        mask = (g.season == season) & (g.week == week)
        g.loc[mask, "feature_cutoff"] = g.loc[mask, "date"].min()
    g = attach_prior(g, elo_history(games), ["elo"], default=1500.0)
    g = g.rename(columns={"home_elo": "home_elo_pre", "away_elo": "away_elo_pre"})
    g = attach_prior(g, rolling_history(games, lookback), ["pf_ma", "pa_ma", "wr_ma"])
    if epa_path is not None:
        epa = epa_history(epa_path)
        g = attach_prior(g, epa, [c for c in epa if c.endswith("_asof")], season_bound=True)
    g = model.add_epa_diff_features(g)
    g["elo_diff"] = g.home_elo_pre - g.away_elo_pre
    return g


def merge_odds(games, path):
    odds = pd.read_csv(path)
    odds["date"] = pd.to_datetime(odds.date).dt.normalize()
    odds["home_team"] = odds.home.map(team_name)
    odds["away_team"] = odds.away.map(team_name)
    keys = ["date", "home_team", "away_team"]
    if odds.duplicated(keys).any():
        raise ValueError("El archivo de líneas contiene partidos duplicados.")
    mapping = {
        "ML_home": "home_ml",
        "ML_away": "away_ml",
        "SP_home_line": "spread_close",
        "Total_line": "total_close",
        "SP_home_odds": "home_spread_odds",
        "SP_away_odds": "away_spread_odds",
        "Over_odds": "over_odds",
        "Under_odds": "under_odds",
    }
    updates = odds.rename(columns=mapping)[keys + list(mapping.values())]
    merged = games.merge(
        updates, on=keys, how="left", suffixes=("", "_new"), validate="one_to_one", indicator=True
    )
    matched = int((merged._merge == "both").sum())
    if not matched:
        raise ValueError(
            "Ninguna línea coincide con fecha y equipos del master. Agrega primero el calendario al master."
        )
    print(
        f"Líneas: {matched} partidos coincidentes; {len(odds) - matched} eventos sin calendario en el master."
    )
    for col in mapping.values():
        merged[col] = merged.pop(col + "_new").combine_first(merged[col])
    merged["p_home_ml_fair"] = [
        model.remove_vig(model.implied_prob_auto(h), model.implied_prob_auto(a))[0]
        for h, a in zip(merged.home_ml, merged.away_ml)
    ]
    return merged.drop(columns="_merge")
