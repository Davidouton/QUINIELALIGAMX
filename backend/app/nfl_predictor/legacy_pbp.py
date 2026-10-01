# Adaptado de Metadata.py. Ver PROVENANCE.json.

import numpy as np
import pandas as pd


def build_team_game_stats(pbp):
    off_group = pbp.groupby(["season", "season_type", "week", "game_id", "posteam"], dropna=False)
    off = off_group.agg(
        off_plays=("epa", "size"),
        off_epa_sum=("epa", "sum"),
        off_epa_per_play=("epa", "mean"),
        off_success_rate=("success", "mean"),
        off_pass_plays=("pass", lambda s: int((s == 1).sum())),
        off_rush_plays=("rush", lambda s: int((s == 1).sum())),
    ).reset_index()

    def epa_mean_where(mask_col):
        return lambda df: df.loc[df[mask_col] == 1, "epa"].mean()

    def sr_mean_where(mask_col):
        return lambda df: df.loc[df[mask_col] == 1, "success"].mean()

    off_detail = (
        pbp.groupby(["season", "season_type", "week", "game_id", "posteam"], dropna=False)
        .apply(
            lambda g: pd.Series(
                {
                    "off_pass_epa_per_play": epa_mean_where("pass")(g),
                    "off_rush_epa_per_play": epa_mean_where("rush")(g),
                    "off_pass_success_rate": sr_mean_where("pass")(g),
                    "off_rush_success_rate": sr_mean_where("rush")(g),
                }
            ),
            include_groups=False,
        )
        .reset_index()
    )
    off = off.merge(
        off_detail, on=["season", "season_type", "week", "game_id", "posteam"], how="left"
    )
    off = off.rename(columns={"posteam": "team"})
    def_group = pbp.groupby(["season", "season_type", "week", "game_id", "defteam"], dropna=False)
    df_def = def_group.agg(
        def_plays=("epa", "size"),
        def_epa_allowed_sum=("epa", "sum"),
        def_epa_allowed_per_play=("epa", "mean"),
        def_success_rate_allowed=("success", "mean"),
    ).reset_index()
    df_def = df_def.rename(columns={"defteam": "team"})
    team_game = pd.merge(
        off,
        df_def,
        on=["season", "season_type", "week", "game_id", "team"],
        how="outer",
        validate="one_to_one",
    )
    games_meta = pbp.groupby("game_id", as_index=False).agg(
        season=("season", "first"),
        season_type=("season_type", "first"),
        week=("week", "first"),
        game_date=("game_date", "first"),
        home_team=("home_team", "first"),
        away_team=("away_team", "first"),
    )
    team_game = team_game.merge(
        games_meta, on=["season", "season_type", "week", "game_id"], how="left"
    )
    team_game["is_home"] = np.where(
        team_game["team"] == team_game["home_team"],
        True,
        np.where(team_game["team"] == team_game["away_team"], False, np.nan),
    )
    team_game["Year"] = team_game["game_date"].dt.year
    team_game["Month"] = team_game["game_date"].dt.month
    team_game["Day"] = team_game["game_date"].dt.day
    team_game = team_game.sort_values(["season", "team", "game_date", "week"]).reset_index(
        drop=True
    )
    return team_game


def add_asof_features(team_game):
    df = team_game.copy()
    df = df.sort_values(["team", "season", "game_date", "week"]).reset_index(drop=True)
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
    for m in metrics:
        if m not in df.columns:
            df[m] = np.nan

    for m in metrics:
        df[f"{m}_asof"] = df.groupby(["team", "season"])[m].transform(
            lambda s: s.expanding(min_periods=1).mean().shift(1)
        )
    df["games_played_season"] = df.groupby(["team", "season"]).cumcount()
    return df
