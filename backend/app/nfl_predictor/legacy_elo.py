# Adaptado de ELO_NFL_V5_.py. Ver PROVENANCE.json.

import numpy as np
import pandas as pd

K = 20
BASE_ELO = 1500
REQUIRE_ML = True
PRINT_DELTAS = False


def _to_float_or_nan(x):
    try:
        if isinstance(x, str):
            x = x.strip()
            if x.startswith("+"):
                x = x[1:]
        return float(x)
    except Exception:
        return np.nan


def odds_to_prob_auto(odds):
    """
    Detecta si la cuota es americana o decimal y regresa prob. con vig.
    Reglas:
      - o < 0           -> americano negativo
      - 1.01 <= o <= 20 -> decimal típica (1.01 a 20)
      - o >= 100        -> americano positivo (p.ej. +110 guardado como 110)
      - (0 < o < 1.01) o valores imposibles -> NaN
    """
    o = _to_float_or_nan(odds)
    if np.isnan(o):
        return np.nan
    if o < 0:
        return -o / (-o + 100.0)
    if 1.01 <= o <= 20.0:
        return 1.0 / o
    if o >= 100:
        return 100.0 / (o + 100.0)
    return np.nan


def unvig_two_way(p_home_raw, p_away_raw):
    """Quita vigorish en un mercado de dos vías, normalizando a suma=1."""
    if np.isnan(p_home_raw) and np.isnan(p_away_raw):
        return (np.nan, np.nan)
    if np.isnan(p_home_raw) and (not np.isnan(p_away_raw)):
        return (1.0 - p_away_raw, p_away_raw)
    if np.isnan(p_away_raw) and (not np.isnan(p_home_raw)):
        return (p_home_raw, 1.0 - p_home_raw)
    s = p_home_raw + p_away_raw
    if s <= 0:
        return (np.nan, np.nan)
    return (p_home_raw / s, p_away_raw / s)


def _get_home_away_moneylines(row):
    """
    Devuelve (home_ml, away_ml) leyendo primero las columnas exactas que
    listaste y con fallback a variantes comunes.
    """
    home_ml = row.get("Home_Moneyline", np.nan)
    away_ml = row.get("Away_Moneline", np.nan)
    if pd.isna(away_ml) and "Away_Moneyline" in row.index:
        away_ml = row.get("Away_Moneyline", np.nan)
    return (home_ml, away_ml)


def calculate_eola_market_only(
    games_df, k=K, base_elo=BASE_ELO, require_ml=REQUIRE_ML, print_deltas=PRINT_DELTAS
):
    print("Calculating EOLA (market-only, as-of) ...")
    teams = pd.unique(games_df[["Home_Team", "Away_Team"]].values.ravel("K"))
    elo = {team: base_elo for team in teams}
    history = []
    for _, row in games_df.iterrows():
        home = row["Home_Team"]
        away = row["Away_Team"]
        hs = row["Home_Score"]
        as_ = row["Away_Score"]
        home_elo = elo.get(home, base_elo)
        away_elo = elo.get(away, base_elo)
        (raw_home_ml, raw_away_ml) = _get_home_away_moneylines(row)
        ph_raw = odds_to_prob_auto(raw_home_ml)
        pa_raw = odds_to_prob_auto(raw_away_ml)
        (ph_mkt, pa_mkt) = unvig_two_way(ph_raw, pa_raw)
        if np.isnan(ph_mkt) or np.isnan(pa_mkt):
            if require_ml:
                raise ValueError(
                    f"Falta/Inválida moneyline en {row['Date'].date()} {home} vs {away} (Home_Moneyline={raw_home_ml}, Away_Moneline={raw_away_ml})"
                )
            else:
                expected_home = 1.0 / (1.0 + 10.0 ** ((away_elo - home_elo) / 400.0))
                expected_source = "ELO (fallback)"
        else:
            expected_home = float(ph_mkt)
            expected_source = "Market"
        expected_away = 1.0 - expected_home
        if hs > as_:
            (score_home, score_away) = (1.0, 0.0)
        elif hs < as_:
            (score_home, score_away) = (0.0, 1.0)
        else:
            (score_home, score_away) = (0.5, 0.5)
        delta_home = k * (score_home - expected_home)
        delta_away = k * (score_away - expected_away)
        new_home_elo = home_elo + delta_home
        new_away_elo = away_elo + delta_away
        elo[home] = new_home_elo
        elo[away] = new_away_elo
        if print_deltas:
            print(
                f"{row['Date'].date()}  {home} {hs}–{as_} {away}  exp_home={expected_home:.3f} [{expected_source}]  Δhome={delta_home:+.2f}  Δaway={delta_away:+.2f}  ELO_home={new_home_elo:.1f}  ELO_away={new_away_elo:.1f}"
            )
        history.append(
            {
                "Date": row["Date"],
                "Year": row["Year"],
                "Month": row["Month"],
                "Day": row["Day"],
                "Game_Type": row.get("Game_Type", np.nan),
                "Team": home,
                "Opponent": away,
                "Is_Home": True,
                "ELO": new_home_elo,
                "Expected_Source": expected_source,
                "Expected_Home": expected_home,
                "Home_Score": hs,
                "Away_Score": as_,
                "Home_Moneyline": raw_home_ml,
                "Away_Moneline": raw_away_ml,
                "Home_Spread": row.get("Home_Spread", np.nan),
                "Away_Spread": row.get("Away_Spread", np.nan),
                "total_line": row.get("total_line", np.nan),
            }
        )
        history.append(
            {
                "Date": row["Date"],
                "Year": row["Year"],
                "Month": row["Month"],
                "Day": row["Day"],
                "Game_Type": row.get("Game_Type", np.nan),
                "Team": away,
                "Opponent": home,
                "Is_Home": False,
                "ELO": new_away_elo,
                "Expected_Source": expected_source,
                "Expected_Home": expected_home,
                "Home_Score": hs,
                "Away_Score": as_,
                "Home_Moneyline": raw_home_ml,
                "Away_Moneline": raw_away_ml,
                "Home_Spread": row.get("Home_Spread", np.nan),
                "Away_Spread": row.get("Away_Spread", np.nan),
                "total_line": row.get("total_line", np.nan),
            }
        )
    return pd.DataFrame(history)


def build_daily_snapshots(elo_history_df):
    """
    Genera un snapshot diario as-of:
    - Para cada fecha, obtiene el último ELO disponible por equipo a esa fecha (carry-forward).
    - Devuelve tabla larga: [Date, Team, ELO_asof]
    """
    df = elo_history_df[["Date", "Team", "ELO"]].copy()
    piv = df.pivot_table(index="Date", columns="Team", values="ELO", aggfunc="last").sort_index()
    piv = piv.ffill()
    long = piv.reset_index().melt(id_vars="Date", var_name="Team", value_name="ELO_asof").dropna()
    long["Year"] = long["Date"].dt.year
    long["Month"] = long["Date"].dt.month
    long["Day"] = long["Date"].dt.day
    return long[["Year", "Month", "Day", "Date", "Team", "ELO_asof"]]
