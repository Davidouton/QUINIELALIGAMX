# Adaptado de NFL_METRICAS.py. Ver PROVENANCE.json.
import re
from pathlib import Path

import numpy as np
import pandas as pd
import statsmodels.api as sm
from scipy.stats import poisson, skellam
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import log_loss
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler


def _coerce_float_odds(x):
    """Intenta convertir odds que pueden venir con coma decimal '1,83' -> 1.83."""
    if pd.isna(x):
        return np.nan
    s = str(x).strip()
    if re.fullmatch("-?\\d+,\\d+", s):
        s = s.replace(",", ".")
    try:
        return float(s)
    except:
        return np.nan


def implied_prob_auto(odds):
    """
    Detecta y convierte automáticamente:
      - Americano (+120, -150)  -> prob = 100/(o+100) o (-o)/(-o+100)
      - Decimal (1.83, 2.10)    -> prob = 1/o
    Heurística:
      - o <= -100 o o >= 100  -> americano
      - 1.01 <= o < 100       -> decimal
      - otro rango            -> NaN (no válido)
    """
    o = _coerce_float_odds(odds)
    if pd.isna(o):
        return np.nan
    if o <= -100 or o >= 100:
        if o < 0:
            return -o / (-o + 100.0)
        else:
            return 100.0 / (o + 100.0)
    if o >= 1.01:
        return 1.0 / o
    return np.nan


def remove_vig(p_a, p_b):
    if pd.isna(p_a) or pd.isna(p_b) or p_a <= 0 or (p_b <= 0):
        return (np.nan, np.nan)
    s = p_a + p_b
    return (p_a / s, p_b / s)


def _norm_colname(s: str) -> str:
    return re.sub("[^a-z0-9]+", "", str(s).lower())


def _parse_first_year(x):
    if pd.isna(x):
        return np.nan
    s = str(x)
    m = re.search("(\\d{4})", s)
    if m:
        return float(m.group(1))
    m2 = re.search("\\d+", s)
    return float(m2.group()) if m2 else np.nan


def _parse_first_int(x):
    if pd.isna(x):
        return np.nan
    m = re.search("\\d+", str(x))
    return float(m.group()) if m else np.nan


def load_games(data_path: str) -> pd.DataFrame:
    p = Path(data_path)
    if not p.exists():
        raise FileNotFoundError(f"No existe el dataset en: {data_path}")
    df = None
    suf = p.suffix.lower()
    if suf in {".xlsx", ".xls"}:
        try:
            df = pd.read_excel(p, engine="openpyxl")
        except Exception:
            df = pd.read_excel(p)
    else:
        last_err = None
        for enc in ("utf-8-sig", "utf-8", "latin1", "cp1252"):
            try:
                df = pd.read_csv(p, encoding=enc)
                break
            except Exception as e:
                last_err = e
        if df is None:
            raise ValueError(
                f"No pude leer el archivo como CSV con encodings comunes (utf-8-sig, utf-8, latin1, cp1252). Último error: {last_err}"
            )
    df.columns = [str(c).replace("\ufeff", "").strip() for c in df.columns]
    by_norm = {_norm_colname(c): c for c in df.columns}
    expected = {
        "Season": "season",
        "Week": "week",
        "Game_Type": "game_type",
        "Month": "month",
        "Day": "day",
        "Year": "year",
        "Home_Team": "home_team",
        "Away_Team": "away_team",
        "Home_Score": "home_points",
        "Away_Score": "away_points",
        "Home_Spread": "spread_close",
        "total_line": "total_close",
        "Home_Moneyline": "home_ml",
        "Away_Moneyline": "away_ml",
        "Home_Spread_Odds": "home_spread_odds",
        "Away_Spread_Odds": "away_spread_odds",
        "Over_Odds": "over_odds",
        "Under_Odds": "under_odds",
        "Away_Moneline": "away_moneyline",
        "Game_ID": "Game_ID",
    }
    rename_real = {}
    for src, dst in expected.items():
        key = _norm_colname(src)
        if key in by_norm:
            rename_real[by_norm[key]] = dst
    df = df.rename(columns=rename_real)
    if "away_moneyline" in df.columns and "away_ml" not in df.columns:
        df = df.rename(columns={"away_moneyline": "away_ml"})
    if set(["year", "month", "day"]).issubset(df.columns):
        df["date"] = pd.to_datetime(
            dict(
                year=pd.to_numeric(df["year"], errors="coerce"),
                month=pd.to_numeric(df["month"], errors="coerce"),
                day=pd.to_numeric(df["day"], errors="coerce"),
            ),
            errors="coerce",
        )
    elif "date" in df.columns:
        df["date"] = pd.to_datetime(df["date"], errors="coerce")
        df["year"] = df["date"].dt.year
        df["month"] = df["date"].dt.month
        df["day"] = df["date"].dt.day
    else:
        raise ValueError("Faltan Year/Month/Day o 'date' para construir la fecha.")
    for c in ["home_points", "away_points", "year", "month", "day"]:
        if c in df.columns:
            df[c] = pd.to_numeric(df[c], errors="coerce")
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
        if c in df.columns:
            df[c] = df[c].apply(_coerce_float_odds)
    if "total_close" in df.columns:
        df.loc[df["total_close"] <= 0, "total_close"] = np.nan
        df.loc[(df["total_close"] < 20) | (df["total_close"] > 90), "total_close"] = np.nan
    if "spread_close" in df.columns:
        df.loc[np.abs(df["spread_close"]) > 40, "spread_close"] = np.nan
    if "season" in df.columns and df["season"].dtype == object:
        df["season"] = df["season"].apply(_parse_first_year)
    if "week" in df.columns and df["week"].dtype == object:
        df["week"] = df["week"].apply(_parse_first_int)
    df["season"] = pd.to_numeric(df.get("season", np.nan), errors="coerce")
    df["week"] = pd.to_numeric(df.get("week", np.nan), errors="coerce")
    if "season" in df.columns and df["season"].notna().sum() == 0:
        df["season"] = np.where(df["month"] <= 2, df["year"] - 1, df["year"]).astype("Int64")
    if "home_ml" in df.columns and "away_ml" in df.columns:
        df["p_home_ml_imp"] = df["home_ml"].apply(implied_prob_auto)
        df["p_away_ml_imp"] = df["away_ml"].apply(implied_prob_auto)
        df[["p_home_ml_fair", "p_away_ml_fair"]] = df.apply(
            lambda r: pd.Series(remove_vig(r["p_home_ml_imp"], r["p_away_ml_imp"])), axis=1
        )
    else:
        df["p_home_ml_fair"] = np.nan
        df["p_away_ml_fair"] = np.nan
    df["home_win"] = (
        pd.to_numeric(df.get("home_points", np.nan), errors="coerce")
        > pd.to_numeric(df.get("away_points", np.nan), errors="coerce")
    ).astype("Int64")
    df = df.sort_values("date").reset_index(drop=True)
    try:
        seasons_list = sorted({int(x) for x in df["season"].dropna().unique()})
    except Exception:
        seasons_list = list(df["season"].dropna().unique())[:10]
    print(f"[INFO] Seasons detectadas: {seasons_list[:12]}")
    print(
        f"[INFO] Weeks detectadas (muestra): {(sorted(set([int(x) for x in df['week'].dropna().unique()]))[:12] if 'week' in df.columns else 'N/A')}"
    )
    print(f"[INFO] Rango de fechas: {df['date'].min()}  →  {df['date'].max()}")
    return df


def _detect_col(cols, candidates):
    for c in candidates:
        if c in cols:
            return c
        for col in cols:
            if str(col).lower() == str(c).lower():
                return col
    return None


def load_elo(elo_path: str) -> pd.DataFrame:
    p = Path(elo_path)
    if not p.exists():
        raise FileNotFoundError(f"ELO: no existe el archivo en {elo_path}")
    if p.suffix.lower() in {".xlsx", ".xls"}:
        try:
            elo = pd.read_excel(p, engine="openpyxl")
        except Exception:
            elo = pd.read_excel(p)
    else:
        elo = None
        last_err = None
        for enc in ("utf-8-sig", "utf-8", "latin1", "cp1252"):
            try:
                elo = pd.read_csv(p, encoding=enc)
                break
            except Exception as e:
                last_err = e
        if elo is None:
            raise ValueError(
                f"ELO: no pude leer CSV con encodings comunes. Último error: {last_err}"
            )
    elo.columns = [str(c).replace("\ufeff", "").strip() for c in elo.columns]
    colmap_lower = {c.lower(): c for c in elo.columns}

    def pick(cands: set):
        """Devuelve el nombre ORIGINAL de la primera columna cuyo lower matchea."""
        for c in cands:
            if c in colmap_lower:
                return colmap_lower[c]
        return None

    date_col = pick({"date", "game_date", "gamedate"})
    if date_col is not None:
        elo["date"] = pd.to_datetime(elo[date_col], errors="coerce")
    else:
        y = pick({"year", "season_year"})
        m = pick({"month"})
        d = pick({"day"})
        if y and m and d:
            elo["date"] = pd.to_datetime(
                dict(
                    year=pd.to_numeric(elo[y], errors="coerce"),
                    month=pd.to_numeric(elo[m], errors="coerce"),
                    day=pd.to_numeric(elo[d], errors="coerce"),
                ),
                errors="coerce",
            )
    team_col = pick({"team", "team_name", "teamname", "equipo", "franchise", "club"})
    rating_aliases = {
        "elo",
        "elo_pre",
        "elorating",
        "elo rating",
        "rating",
        "power",
        "power_rating",
        "pr",
        "elo_adj",
        "elo_pre_game",
        "elo_asof",
        "elo_as_of",
        "elo-asof",
        "elo-as-of",
        "elo_as-of",
        "elo-as_of",
        "eloasof",
    }
    rating_col = pick(rating_aliases)
    if team_col is None or rating_col is None:
        home_team = pick({"home_team", "home team", "local"})
        away_team = pick({"away_team", "away team", "visitante"})
        home_elo = pick({"home_elo", "elo_home", "home elo", "elo local"})
        away_elo = pick({"away_elo", "elo_away", "away elo", "elo visitante"})
        if "date" in elo.columns and home_team and away_team and (home_elo or away_elo):
            rows = []
            for _, r in elo.iterrows():
                dt = pd.to_datetime(r["date"], errors="coerce")
                if pd.notna(dt):
                    if home_team and home_elo and pd.notna(r.get(home_team, np.nan)):
                        rows.append(
                            {
                                "date": dt,
                                "team": r[home_team],
                                "elo": pd.to_numeric(r.get(home_elo, np.nan), errors="coerce"),
                            }
                        )
                    if away_team and away_elo and pd.notna(r.get(away_team, np.nan)):
                        rows.append(
                            {
                                "date": dt,
                                "team": r[away_team],
                                "elo": pd.to_numeric(r.get(away_elo, np.nan), errors="coerce"),
                            }
                        )
            elo_long = pd.DataFrame(rows).dropna(subset=["date", "team"])
            elo_long = (
                elo_long.sort_values(["team", "date"])
                .drop_duplicates(["team", "date"], keep="last")
                .reset_index(drop=True)
            )
            if not elo_long.empty:
                return elo_long
    if "date" not in elo.columns:
        sample = ", ".join(list(elo.columns)[:40])
        raise ValueError(f"ELO: falta 'date' o (Year,Month,Day). Columnas disponibles: {sample}")
    if team_col is None:
        sample = ", ".join(list(elo.columns)[:40])
        raise ValueError(
            f"ELO: falta columna de equipo (ej. Team / team / TeamName). Columnas disponibles: {sample}"
        )
    if rating_col is None:
        if "rating" in colmap_lower:
            rating_col = colmap_lower["rating"]
        else:
            sample = ", ".join(list(elo.columns)[:40])
            raise ValueError(
                f"ELO: falta columna de rating (ej. Elo / elo / Rating / power / PR / ELO_asof). Columnas disponibles: {sample}"
            )
    out = elo.rename(columns={team_col: "team", rating_col: "elo"})[["date", "team", "elo"]].copy()
    out["date"] = pd.to_datetime(out["date"], errors="coerce")
    out["elo"] = pd.to_numeric(out["elo"], errors="coerce")
    out = (
        out.dropna(subset=["date", "team"])
        .sort_values(["team", "date"])
        .drop_duplicates(["team", "date"], keep="last")
        .reset_index(drop=True)
    )
    return out


def load_epa_asof(epa_path: str) -> pd.DataFrame:
    """
    Lee el CSV generado a partir de la PBP (nfl_team_epa_sr_asof.csv).
    Espera columnas como:
      - date, team
      - *_asof (off_epa_per_play_asof, def_epa_allowed_per_play_asof, etc.)
    """
    p = Path(epa_path)
    if not p.exists():
        raise FileNotFoundError(f"EPA: no existe el archivo en {epa_path}")
    epa = pd.read_csv(p)
    epa.columns = [str(c).replace("\ufeff", "").strip() for c in epa.columns]
    team_col = None
    for c in epa.columns:
        if c.lower() == "team":
            team_col = c
            break
    if team_col is None:
        raise ValueError("EPA: falta columna 'team'.")
    if "date" in epa.columns:
        epa["date"] = pd.to_datetime(epa["date"], errors="coerce")
    elif "game_date" in epa.columns:
        epa["date"] = pd.to_datetime(epa["game_date"], errors="coerce")
    elif set(["Year", "Month", "Day"]).issubset(epa.columns):
        epa["date"] = pd.to_datetime(
            dict(
                year=pd.to_numeric(epa["Year"], errors="coerce"),
                month=pd.to_numeric(epa["Month"], errors="coerce"),
                day=pd.to_numeric(epa["Day"], errors="coerce"),
            ),
            errors="coerce",
        )
    else:
        raise ValueError("EPA: falta 'date'/'game_date' o Year/Month/Day.")
    epa = epa.rename(columns={team_col: "team"})
    epa["date"] = pd.to_datetime(epa["date"], errors="coerce")
    epa = epa.dropna(subset=["date", "team"])
    metric_cols = [c for c in epa.columns if c.endswith("_asof")]
    keep = ["date", "team"] + metric_cols
    epa = epa[keep].copy().sort_values(["team", "date"]).reset_index(drop=True)
    return epa


def add_epa_diff_features(g: pd.DataFrame) -> pd.DataFrame:
    """
    Crea features tipo:
      - epa_off_diff = home_off_epa_per_play_asof - away_...
      - epa_def_diff, sr_off_diff, epa_pass_diff, epa_rush_diff, sr_pass_diff
    """
    g = g.copy()
    base_pairs = [
        ("off_epa_per_play_asof", "epa_off_diff"),
        ("def_epa_allowed_per_play_asof", "epa_def_diff"),
        ("off_success_rate_asof", "sr_off_diff"),
        ("off_pass_epa_per_play_asof", "epa_pass_diff"),
        ("off_rush_epa_per_play_asof", "epa_rush_diff"),
        ("off_pass_success_rate_asof", "sr_pass_diff"),
    ]
    for base_name, diff_name in base_pairs:
        h_col = f"home_{base_name}"
        a_col = f"away_{base_name}"
        if h_col not in g.columns:
            g[h_col] = np.nan
        if a_col not in g.columns:
            g[a_col] = np.nan
        g[diff_name] = g[h_col] - g[a_col]
    return g


def debug_market_usage(df, season, week):
    w = df[(df["season"] == season) & (df["week"] == week)].copy()
    if w.empty:
        print(f"[MARKET] No hay juegos para {season}-W{week}")
        return
    n_sp = w["spread_close"].notna().sum() if "spread_close" in w.columns else 0
    n_to = w["total_close"].notna().sum() if "total_close" in w.columns else 0
    ml_ok = ("home_ml" in w.columns and w["home_ml"].notna().any()) and (
        "away_ml" in w.columns and w["away_ml"].notna().any()
    )
    print(
        f"[MARKET] {season}-W{int(week)} → spreads válidos: {n_sp}, totals válidos: {n_to}, moneylines presentes: {ml_ok}"
    )
    try:
        print(
            w[
                {
                    "date",
                    "away_team",
                    "home_team",
                    "spread_close",
                    "total_close",
                    "home_ml",
                    "away_ml",
                }
            ]
            .sort_values("date")
            .to_string(index=False)
        )
    except Exception:
        pass


def fit_poisson(train_df: pd.DataFrame):
    base_cols = [
        "elo_diff",
        "spread_close",
        "total_close",
        "home_pf_ma",
        "home_pa_ma",
        "away_pf_ma",
        "away_pa_ma",
        "home_wr_ma",
        "away_wr_ma",
    ]
    epa_cols = [
        "epa_off_diff",
        "epa_def_diff",
        "sr_off_diff",
        "epa_pass_diff",
        "epa_rush_diff",
        "sr_pass_diff",
    ]
    feat_cols = [c for c in base_cols + epa_cols if c in train_df.columns]
    X = train_df[feat_cols].copy()
    med = X.median(numeric_only=True).fillna(0.0)
    X = sm.add_constant(X.fillna(med), has_constant="add")
    feature_cols = X.columns.tolist()
    y_home = train_df["home_points"].astype(int)
    y_away = train_df["away_points"].astype(int)
    m_home = sm.GLM(y_home, X, family=sm.families.Poisson()).fit()
    m_away = sm.GLM(y_away, X, family=sm.families.Poisson()).fit()
    return (m_home, m_away, med, feature_cols)


def _anchor_vectors(t_model, m_model, total_close, spread_close, w_t=0.45, w_m=0.25):
    total_close = np.asarray(total_close, dtype=float)
    spread_close = np.asarray(spread_close, dtype=float)
    t_star = t_model.copy()
    m_star = m_model.copy()
    mask_t = np.isfinite(total_close)
    mask_m = np.isfinite(spread_close)
    t_star[mask_t] = (1 - w_t) * t_model[mask_t] + w_t * total_close[mask_t]
    m_mkt = np.zeros_like(m_model)
    m_mkt[mask_m] = -spread_close[mask_m]
    m_star[mask_m] = (1 - w_m) * m_model[mask_m] + w_m * m_mkt[mask_m]
    return (t_star, m_star)


def anchor_lambdas_to_market(lh, la, total_close, spread_close, w_t=0.45, w_m=0.25):
    lh = np.asarray(lh, dtype=float)
    la = np.asarray(la, dtype=float)
    t_model = lh + la
    m_model = lh - la
    (t_star, m_star) = _anchor_vectors(t_model, m_model, total_close, spread_close, w_t, w_m)
    lh_star = np.maximum(0.01, 0.5 * (t_star + m_star))
    la_star = np.maximum(0.01, 0.5 * (t_star - m_star))
    return (lh_star, la_star)


def predict_poisson(models, df_pred: pd.DataFrame, anchor=True, wt=0.45, wm=0.25):
    (m_home, m_away, med, cols) = models
    if "elo_diff" not in df_pred.columns and {"home_elo_pre", "away_elo_pre"}.issubset(
        df_pred.columns
    ):
        df_pred = df_pred.copy()
        df_pred["elo_diff"] = df_pred["home_elo_pre"] - df_pred["away_elo_pre"]
    feat_cols = [c for c in cols if c != "const"]
    X_raw = df_pred.reindex(columns=feat_cols).copy()
    X_raw = X_raw.fillna(med)
    X = sm.add_constant(X_raw, has_constant="add").reindex(columns=cols, fill_value=0)
    lh = m_home.predict(X).clip(lower=0.01).values
    la = m_away.predict(X).clip(lower=0.01).values
    if anchor:
        (lh, la) = anchor_lambdas_to_market(
            lh,
            la,
            df_pred.get("total_close", pd.Series(index=df_pred.index, dtype=float)).values,
            df_pred.get("spread_close", pd.Series(index=df_pred.index, dtype=float)).values,
            wt,
            wm,
        )
    return (lh, la)


def make_logit_pipeline():
    num_cols = [
        "elo_diff",
        "spread_close",
        "total_close",
        "home_pf_ma",
        "home_pa_ma",
        "away_pf_ma",
        "away_pa_ma",
        "home_wr_ma",
        "away_wr_ma",
        "p_home_ml_fair",
        "epa_off_diff",
        "epa_def_diff",
        "sr_off_diff",
        "epa_pass_diff",
        "epa_rush_diff",
        "sr_pass_diff",
    ]
    pipe = Pipeline(
        [
            ("imp", SimpleImputer(strategy="median")),
            ("sc", StandardScaler()),
            ("clf", LogisticRegression(solver="lbfgs", max_iter=600, C=0.25)),
        ]
    )
    return (pipe, num_cols)


def tune_alpha(y, p_logit, p_poisson):
    grid = np.linspace(0.0, 0.85, 86)
    (best_a, best_ll) = (0.6, np.inf)
    for a in grid:
        p = np.clip(a * p_logit + (1 - a) * p_poisson, 1e-06, 1 - 1e-06)
        ll = log_loss(y, p)
        if ll < best_ll:
            (best_ll, best_a) = (ll, a)
    return best_a


def _logit_clip(p, eps=1e-06):
    p = np.clip(np.asarray(p, dtype=float), eps, 1 - eps)
    return np.log(p / (1 - p))


def temp_scale_prob(p, tau):
    L = _logit_clip(p)
    return 1.0 / (1.0 + np.exp(-L / max(tau, 0.001)))


def tune_temperature(y, p):
    if len(p) < 20:
        return 1.0
    taus = np.concatenate([np.linspace(0.8, 2.0, 25), np.linspace(2.0, 5.0, 16)])
    (best_tau, best_ll) = (1.0, np.inf)
    for t in taus:
        pc = np.clip(temp_scale_prob(p, t), 1e-06, 1 - 1e-06)
        ll = log_loss(y, pc)
        if ll < best_ll:
            (best_ll, best_tau) = (ll, t)
    return float(best_tau)


def cover_probs_skellam(lh, la, spread_home):
    lh = np.asarray(lh, dtype=float)
    la = np.asarray(la, dtype=float)
    s = np.asarray(spread_home, dtype=float)
    n = len(lh)
    p_home = np.zeros(n)
    p_push = np.zeros(n)
    p_away = np.zeros(n)
    for i in range(n):
        x = -s[i]
        if np.isfinite(x) and abs(x - np.round(x)) < 1e-09:
            k = int(round(x))
            p_push[i] = skellam.pmf(k, mu1=lh[i], mu2=la[i])
            p_home[i] = 1 - skellam.cdf(k, mu1=lh[i], mu2=la[i])
            p_away[i] = skellam.cdf(k - 1, mu1=lh[i], mu2=la[i])
        else:
            thr = int(np.floor(x)) if np.isfinite(x) else 0
            p_push[i] = 0.0
            p_home[i] = 1 - skellam.cdf(thr, mu1=lh[i], mu2=la[i])
            p_away[i] = 1 - p_home[i]
    return (p_home, p_push, p_away)


def totals_probs_poisson(lh, la, total_line):
    lh = np.asarray(lh, dtype=float)
    la = np.asarray(la, dtype=float)
    t = np.asarray(total_line, dtype=float)
    mu = lh + la
    n = len(mu)
    p_over = np.zeros(n)
    p_push = np.zeros(n)
    p_under = np.zeros(n)
    for i in range(n):
        if np.isfinite(t[i]) and abs(t[i] - np.round(t[i])) < 1e-09:
            T = int(round(t[i]))
            p_push[i] = poisson.pmf(T, mu[i])
            p_over[i] = 1 - poisson.cdf(T, mu[i])
            p_under[i] = poisson.cdf(T - 1, mu[i])
        else:
            thr = int(np.floor(t[i])) if np.isfinite(t[i]) else 0
            p_push[i] = 0.0
            p_over[i] = 1 - poisson.cdf(thr, mu[i])
            p_under[i] = 1 - p_over[i]
    return (p_over, p_push, p_under)


def get_preweek_train(df, season, week):
    base = df[df["home_points"].notna() & df["away_points"].notna()].copy()
    mask = (base["season"] < season) | (base["season"] == season) & (base["week"] < week)
    return base[mask]


def build_report(preds: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for _, r in preds.sort_values(["date", "home_team"]).iterrows():
        dt = pd.to_datetime(r["date"])
        date_cell = dt.strftime("%m/%d/%y")
        p_home = float(r["p_home_ensemble"])
        win_side = "H" if p_home >= 0.5 else "A"
        win_prob = p_home if win_side == "H" else 1 - p_home
        phc = float(r["p_home_cover"])
        psp = float(r["p_spread_push"])
        pac = float(r["p_away_cover"])
        (cover_side, cover_prob) = ("H", phc) if phc >= pac else ("A", pac)
        pov = float(r["p_over"])
        ptp = float(r["p_total_push"])
        pun = float(r["p_under"])
        (total_side, total_prob) = ("O", pov) if pov >= pun else ("U", pun)
        if not np.isfinite(phc):
            cover_side = ""
        if not np.isfinite(pov):
            total_side = ""
        rows.append(
            {
                "Game_ID": r.get("Game_ID", np.nan),
                "Date": date_cell,
                "Week": int(r["week"]) if pd.notna(r["week"]) else "",
                "Home Team": r["home_team"],
                "Away Team": r["away_team"],
                "Win_Prediction (H,A)": win_side,
                "Win_Probability": round(win_prob, 4),
                "Cover_Prediction (H,A)": cover_side,
                "Cover_Probability": round(cover_prob, 4),
                "Cover_Push_Probability": round(psp, 4),
                "Total_Points_Cover (O,U)": total_side,
                "Total_Probability": round(total_prob, 4),
                "Total_Push_Probability": round(ptp, 4),
                "Lambda_Home": round(float(r["lambda_home"]), 2)
                if pd.notna(r["lambda_home"])
                else "",
                "Lambda_Away": round(float(r["lambda_away"]), 2)
                if pd.notna(r["lambda_away"])
                else "",
                "Alpha_Used": round(float(r["alpha_used"]), 3) if pd.notna(r["alpha_used"]) else "",
                "Tau_Used": round(float(r["tau_used"]), 3) if pd.notna(r["tau_used"]) else "",
            }
        )
    rep = pd.DataFrame(rows)
    if "Game_ID" in rep.columns:
        rep = rep.sort_values("Game_ID", key=lambda s: s.astype(str)).reset_index(drop=True)
        cols = ["Game_ID"] + [c for c in rep.columns if c != "Game_ID"]
        rep = rep[cols]
    return rep
