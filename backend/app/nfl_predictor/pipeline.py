"""Entrenamiento semanal, calibración temporal y exportación auditable."""

import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import skellam
from sklearn.metrics import accuracy_score, brier_score_loss, log_loss

from . import legacy_model as model


def poisson_win(lh, la):
    tie = skellam.pmf(0, mu1=lh, mu2=la)
    return np.clip((1 - skellam.cdf(0, mu1=lh, mu2=la)) / (1 - tie), 1e-6, 1 - 1e-6)


def fit(train):
    pois = model.fit_poisson(train)
    pipe, cols = model.make_logit_pipeline()
    # Medianas calculadas SOLO en entrenamiento; 0 para columnas sin observaciones.
    med = train.reindex(columns=cols).median().fillna(0.0)
    pipe.fit(
        train.reindex(columns=cols).fillna(med), (train.home_points > train.away_points).astype(int)
    )
    return pois, pipe, cols, med


def predict_components(fitted, rows):
    pois, pipe, cols, med = fitted
    lh, la = model.predict_poisson(pois, rows)
    p_logit = pipe.predict_proba(rows.reindex(columns=cols).fillna(med))[:, 1]
    return lh, la, p_logit, poisson_win(lh, la)


def run(games, targets):
    predictions = []
    for season, week in targets:
        current = games[(games.season == season) & (games.week == week)].copy()
        if current.empty:
            raise ValueError(f"No hay calendario para temporada {season}, semana {week}.")
        cutoff = current.feature_cutoff.min()
        train = games[(games.date < cutoff)].dropna(subset=["home_points", "away_points"]).copy()
        train = train[train.home_points != train.away_points]
        if len(train) < 50 or (train.home_points > train.away_points).nunique() < 2:
            raise ValueError(
                f"{season} W{week}: se necesitan al menos 50 partidos previos y victorias de ambos lados."
            )
        # Calibración de semanas completas reservadas fuera del ajuste de los modelos.
        last_pairs = train[["season", "week"]].drop_duplicates().tail(4)
        cal_mask = pd.MultiIndex.from_frame(train[["season", "week"]]).isin(
            pd.MultiIndex.from_frame(last_pairs)
        )
        calibration = train[cal_mask]
        earlier = train[~cal_mask]
        alpha = 0.6
        tau = 1.0
        if (
            len(earlier) >= 50
            and len(calibration) >= 20
            and (earlier.home_points > earlier.away_points).nunique() == 2
            and (calibration.home_points > calibration.away_points).nunique() == 2
        ):
            cf = fit(earlier)
            _, _, pl, pp = predict_components(cf, calibration)
            truth = (calibration.home_points > calibration.away_points).astype(int)
            alpha = float(model.tune_alpha(truth, pl, pp))
            tau = model.tune_temperature(truth, alpha * pl + (1 - alpha) * pp)
        fitted = fit(train)
        lh, la, pl, pp = predict_components(fitted, current)
        current["lambda_home"] = lh
        current["lambda_away"] = la
        current["p_home_logit"] = pl
        current["p_home_poisson"] = pp
        current["p_home_ensemble"] = np.clip(
            model.temp_scale_prob(alpha * pl + (1 - alpha) * pp, tau), 1e-4, 1 - 1e-4
        )
        current["p_ml_push"] = skellam.pmf(0, mu1=lh, mu2=la)
        current["p_home_cover"], current["p_spread_push"], current["p_away_cover"] = (
            model.cover_probs_skellam(lh, la, current.spread_close)
        )
        current["p_over"], current["p_total_push"], current["p_under"] = model.totals_probs_poisson(
            lh, la, current.total_close
        )
        current.loc[
            current.spread_close.isna(), ["p_home_cover", "p_spread_push", "p_away_cover"]
        ] = np.nan
        current.loc[current.total_close.isna(), ["p_over", "p_total_push", "p_under"]] = np.nan
        current["alpha_used"] = alpha
        current["tau_used"] = tau
        current["training_games"] = len(train)
        current["training_cutoff"] = cutoff
        predictions.append(current)
        print(
            f"{season} W{week}: {len(current)} pronósticos, {len(train)} partidos previos; alpha={alpha:.2f}, tau={tau:.2f}"
        )
    return pd.concat(predictions, ignore_index=True)


def decimal_odds(odds):
    if pd.isna(odds) or not np.isfinite(float(odds)):
        return np.nan
    o = float(odds)
    if o <= -100:
        return 1 + 100 / abs(o)
    if o >= 100:
        return 1 + o / 100
    if 1 < o <= 20:
        return o
    return np.nan


def betting_table(preds):
    bets = []
    for _, r in preds.iterrows():
        tie = float(r.p_ml_push)
        selections = [
            ("ML", r.home_team, None, r.home_ml, r.p_home_ensemble * (1 - tie), tie),
            ("ML", r.away_team, None, r.away_ml, (1 - r.p_home_ensemble) * (1 - tie), tie),
            (
                "ATS",
                r.home_team,
                r.spread_close,
                r.home_spread_odds,
                r.p_home_cover,
                r.p_spread_push,
            ),
            (
                "ATS",
                r.away_team,
                -r.spread_close,
                r.away_spread_odds,
                r.p_away_cover,
                r.p_spread_push,
            ),
            ("TOTAL", "Over", r.total_close, r.over_odds, r.p_over, r.p_total_push),
            ("TOTAL", "Under", r.total_close, r.under_odds, r.p_under, r.p_total_push),
        ]
        for market, side, line, odds, pwin, ppush in selections:
            dec = decimal_odds(odds)
            ev = (
                pwin * (dec - 1) - (1 - pwin - ppush)
                if pd.notna(dec) and pd.notna(pwin)
                else np.nan
            )
            bets.append(
                {
                    "Game_ID": str(r.Game_ID),
                    "Fecha": r.date,
                    "Local": r.home_team,
                    "Visitante": r.away_team,
                    "Mercado": market,
                    "Seleccion": side,
                    "Linea": line,
                    "Momio": odds,
                    "Cuota_decimal": dec,
                    "Prob_ganar": pwin,
                    "Prob_push": ppush,
                    "EV_por_unidad": ev,
                    "Estado": "Sin línea/momio"
                    if pd.isna(ev)
                    else ("EV positivo modelo" if ev > 0 else "Sin ventaja modelo"),
                }
            )
    return pd.DataFrame(bets)


def export(preds, output_dir, metadata):
    output = Path(output_dir)
    output.mkdir(parents=True, exist_ok=True)
    tag = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    stem = output / f"nfl_predicciones_{tag}"
    report = model.build_report(preds)
    bets = betting_table(preds)
    metrics = {}
    scored = preds.dropna(subset=["home_points", "away_points"])
    scored = scored[scored.home_points != scored.away_points]
    if len(scored):
        truth = (scored.home_points > scored.away_points).astype(int)
        metrics = {
            "partidos": len(scored),
            "accuracy_ml": float(accuracy_score(truth, scored.p_home_ensemble >= 0.5)),
            "brier_ml": float(brier_score_loss(truth, scored.p_home_ensemble)),
            "log_loss_ml": float(log_loss(truth, scored.p_home_ensemble, labels=[0, 1])),
        }
    # Mismo corte temporal en reporte y auditoría; no convierte IDs de proveedor a enteros.
    report.to_csv(stem.with_suffix(".csv"), index=False)
    with pd.ExcelWriter(stem.with_suffix(".xlsx"), engine="openpyxl") as writer:
        for name, frame in [
            ("Predicciones", report),
            ("Apuestas", bets),
            ("Auditoria", preds),
            (
                "Ejecucion",
                pd.DataFrame(
                    [{"campo": k, "valor": str(v)} for k, v in {**metadata, **metrics}.items()]
                ),
            ),
        ]:
            frame.to_excel(writer, sheet_name=name, index=False)
            ws = writer.sheets[name]
            ws.freeze_panes = "A2"
            ws.auto_filter.ref = ws.dimensions
            for col in ws.columns:
                ws.column_dimensions[col[0].column_letter].width = min(
                    36, max(14, len(str(col[0].value)) + 2)
                )
            for row in ws:
                for cell in row:
                    if cell.data_type == "f":
                        cell.data_type = "s"  # Tratar textos de entrada como datos.
    stem.with_suffix(".json").write_text(
        json.dumps({**metadata, "metrics": metrics, "rows": len(preds)}, indent=2, default=str)
    )
    return stem.with_suffix(".xlsx")
