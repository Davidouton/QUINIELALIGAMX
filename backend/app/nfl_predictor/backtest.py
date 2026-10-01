"""Walk-forward replay of the production engine using the historical workbook inputs."""

import argparse
import hashlib
import json
from pathlib import Path
from tempfile import TemporaryDirectory

import pandas as pd

from . import data, pipeline
from .report import MARKETS, calculated, number, save_report, settle
from .store import connection


def selections(pred, bases):
    tie = number(pred.p_ml_push)
    home_ml = pred.p_home_ensemble >= 0.5
    home_ats = pred.p_home_cover >= pred.p_away_cover
    over = pred.p_over >= pred.p_under
    entries = [
        (
            "ML",
            "H" if home_ml else "A",
            None,
            pred.home_ml if home_ml else pred.away_ml,
            (pred.p_home_ensemble if home_ml else 1 - pred.p_home_ensemble) * (1 - tie),
            tie,
        ),
    ]
    for key, choose_home in [("ATS", home_ats), ("CONTRA_ATS", not home_ats)]:
        entries.append(
            (
                key,
                "H" if choose_home else "A",
                pred.spread_close if choose_home else -pred.spread_close,
                pred.home_spread_odds if choose_home else pred.away_spread_odds,
                pred.p_home_cover if choose_home else pred.p_away_cover,
                pred.p_spread_push,
            )
        )
    for key, choose_over in [("TOTAL", over), ("CONTRA_TOTAL", not over)]:
        entries.append(
            (
                key,
                "O" if choose_over else "U",
                pred.total_close,
                pred.over_odds if choose_over else pred.under_odds,
                pred.p_over if choose_over else pred.p_under,
                pred.p_total_push,
            )
        )
    rows = []
    for key, side, line, price, probability, push in entries:
        line = number(line)
        outcome = settle(key, side, line, number(pred.home_points), number(pred.away_points))
        values = calculated(
            number(probability),
            number(push),
            number(pipeline.decimal_odds(price)),
            bases[key],
            outcome,
        )
        rows.append(
            dict(
                game_id=str(pred.Game_ID),
                season=int(pred.season),
                week=int(pred.week),
                date=pred.date.date().isoformat(),
                home=pred.home_team,
                away=pred.away_team,
                home_score=number(pred.home_points),
                away_score=number(pred.away_points),
                market=key,
                selection=pred.home_team
                if side == "H"
                else pred.away_team
                if side == "A"
                else "Over"
                if side == "O"
                else "Under",
                line=line,
                base=bases[key],
                corrected=values,
                training_games=int(pred.training_games),
                training_cutoff=pred.training_cutoff.isoformat(),
                alpha=number(pred.alpha_used),
                tau=number(pred.tau_used),
            )
        )
    return rows


def replay(workbook, metrics, output):
    from openpyxl import load_workbook

    book = load_workbook(workbook, read_only=True, data_only=True)
    bases = {key: number(book["NFL2025"][spec[-1]].value) for key, spec in MARKETS.items()}
    book.close()
    with TemporaryDirectory(prefix="nfl-backtest-") as tmp:
        master = pd.read_excel(workbook, sheet_name="NFL22232425")
        missing_year = master["Year"].isna() & master["Month"].isin([1, 2, 9, 10, 11, 12])
        season_year = master["Season"].astype(str).str.extract(r"(\d{4})")[0].astype(float)
        master.loc[missing_year, "Year"] = season_year[missing_year] + (
            master.loc[missing_year, "Month"] <= 2
        ).astype(int)
        source = Path(tmp) / "games.csv"
        master.to_csv(source, index=False)
        games = data.load_games(source)
    games["Game_ID"] = (
        games.date.dt.strftime("%Y%m%d") + "_" + games.home_team + "_" + games.away_team
    )
    games = games.sort_values(["date", "Game_ID"]).reset_index(drop=True)
    targets = [
        (int(s), int(w))
        for s, w in games[["season", "week"]].drop_duplicates().itertuples(index=False, name=None)
    ]
    prepared = data.prepare(games, metrics, targets)
    rows, skipped = [], []
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    fingerprint = hashlib.sha256(
        Path(workbook).read_bytes()
        + Path(metrics).read_bytes()
        + b"".join(
            Path(__file__).with_name(f).read_bytes()
            for f in [
                "backtest.py",
                "data.py",
                "pipeline.py",
                "legacy_model.py",
                "legacy_elo.py",
                "report.py",
            ]
        )
    ).hexdigest()
    for season, week in targets:
        cutoff = prepared.loc[
            (prepared.season == season) & (prepared.week == week), "feature_cutoff"
        ].min()
        train = prepared[
            (prepared.date < cutoff)
            & prepared.home_points.notna()
            & prepared.away_points.notna()
            & (prepared.home_points != prepared.away_points)
        ]
        if len(train) < 50 or (train.home_points > train.away_points).nunique() < 2:
            skipped.append(
                dict(
                    season=season,
                    week=week,
                    reason="Menos de 50 partidos previos / clases insuficientes",
                )
            )
            continue
        cache = output / f"{fingerprint[:16]}-{season}-{week}.json"
        if cache.exists():
            batch = json.loads(cache.read_text())
        else:
            preds = pipeline.run(prepared, [(season, week)])
            batch = [row for _, pred in preds.iterrows() for row in selections(pred, bases)]
            cache.write_text(json.dumps(batch, allow_nan=False))
        rows.extend(batch)
    metadata = dict(
        filename="Motor NFL · evaluación histórica semanal",
        kind="walk_forward",
        rows=len(rows),
        fingerprint=fingerprint,
        recovered_calendar_years=int(missing_year.sum()),
        skipped_weeks=skipped,
        bases=bases,
        odds_caveat="Líneas históricas del archivo, sin hora de captura verificada; no equivalen a cuotas disponibles al inicio de la jornada.",
        strategy="Lado de mayor probabilidad; contras el opuesto. Kelly completo sobre base fija por mercado; sin capitalización ni límite de exposición conjunta.",
    )
    result = dict(rows=rows, metadata=metadata)
    (output / "engine-report.json").write_text(json.dumps(result, allow_nan=False))
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("workbook", type=Path)
    parser.add_argument("--metrics", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--publish", action="store_true")
    args = parser.parse_args()
    result = replay(args.workbook, args.metrics, args.output)
    if args.publish:
        with connection() as store:
            store.conn.execute(Path(__file__).with_name("report_schema.sql").read_text())
            save_report(store, result["rows"], result["metadata"], "engine")
    print(json.dumps(result["metadata"], ensure_ascii=False))


if __name__ == "__main__":
    main()
