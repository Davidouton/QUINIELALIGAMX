"""Scheduled pipeline: provider data -> Supabase -> models -> web, without Excel."""

import argparse
import io
import os
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import requests

from . import data, pipeline, sources
from . import legacy_model as model
from .store import connection, records

SCHEDULE_URL = "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv"
MARKETS = [
    "home_ml",
    "away_ml",
    "spread_close",
    "total_close",
    "home_spread_odds",
    "away_spread_odds",
    "over_odds",
    "under_odds",
]


def canonical_id(r):
    return f"{int(r['season'])}_{int(r['week']):02d}_{data.team_name(r['away_team'])}_{data.team_name(r['home_team'])}"


def normalize_schedule(raw):
    required = {
        "season",
        "week",
        "gameday",
        "gametime",
        "home_team",
        "away_team",
        "home_score",
        "away_score",
        "spread_line",
    }
    if required - set(raw):
        raise ValueError("El calendario del proveedor cambió de formato.")
    frame = raw.rename(
        columns={
            "gameday": "date",
            "home_score": "home_points",
            "away_score": "away_points",
            "home_moneyline": "home_ml",
            "away_moneyline": "away_ml",
            "total_line": "total_close",
        }
    ).copy()
    frame = frame[
        (frame.season >= 2018) & frame.game_type.isin(["REG", "WC", "DIV", "CON", "SB"])
    ].copy()
    for col in ["home_team", "away_team"]:
        frame[col] = frame[col].map(data.team_name)
    frame["date"] = pd.to_datetime(frame.date)
    # nflverse spread_line is the predicted HOME margin; model expects HOME handicap.
    frame["spread_close"] = -pd.to_numeric(frame.spread_line, errors="coerce")
    times = pd.to_datetime(
        frame.date.dt.strftime("%Y-%m-%d") + " " + frame.gametime.fillna(""), errors="coerce"
    )
    # A missing kickoff must not become midnight and silently enter automated predictions.
    times = times.where(frame.gametime.notna())
    frame["kickoff_at"] = times.dt.tz_localize(
        "America/New_York", ambiguous="NaT", nonexistent="NaT"
    ).dt.tz_convert("UTC")
    frame["Game_ID"] = frame.apply(canonical_id, axis=1)
    for col in MARKETS:
        if col not in frame:
            frame[col] = np.nan
    return records(
        frame[
            [
                "Game_ID",
                "season",
                "week",
                "game_type",
                "date",
                "kickoff_at",
                "home_team",
                "away_team",
                "home_points",
                "away_points",
            ]
            + MARKETS
        ]
    )


def sync_schedule(store):
    resp = requests.get(SCHEDULE_URL, timeout=(15, 90))
    resp.raise_for_status()
    incoming = normalize_schedule(pd.read_csv(io.StringIO(resp.text)))
    existing = {r["Game_ID"]: r for r in store.games()}
    merged = []
    for r in incoming:
        old = existing.get(r["Game_ID"], {})
        # Provider missing fields never erase imported historical lines or scores.
        value = {**old, **{k: v for k, v in r.items() if v is not None}}
        for key in ["home_points", "away_points"] + MARKETS:
            value.setdefault(key, None)
        merged.append(value)
    store.save_games(merged)
    return len(merged)


def load_frame(rows):
    if not rows:
        raise ValueError("No hay partidos en Supabase.")
    frame = pd.DataFrame(rows)
    frame["date"] = pd.to_datetime(frame.date, format="ISO8601").dt.tz_localize(None).dt.normalize()
    for col in ["home_points", "away_points"] + MARKETS:
        frame[col] = pd.to_numeric(frame.get(col, np.nan), errors="coerce")
    frame["p_home_ml_fair"] = [
        model.remove_vig(model.implied_prob_auto(h), model.implied_prob_auto(a))[0]
        for h, a in zip(frame.home_ml, frame.away_ml)
    ]
    return frame.sort_values("date").reset_index(drop=True)


def future_games(frame, now):
    kickoff = pd.to_datetime(frame.kickoff_at, utc=True, errors="coerce")
    return frame[kickoff.gt(now) & frame.home_points.isna() & frame.away_points.isna()]


def overlay_odds(frame, events, now, bookmaker):
    result = frame.copy()
    snapshots = []
    for event in events:
        kickoff = pd.Timestamp(event["commence_time"])
        if kickoff <= now:
            continue
        home = data.team_name(event["home_team"])
        away = data.team_name(event["away_team"])
        eligible = future_games(result, now)
        candidates = eligible[(eligible.home_team == home) & (eligible.away_team == away)]
        distance = (pd.to_datetime(candidates.kickoff_at, utc=True) - kickoff).abs()
        candidates = candidates[distance <= pd.Timedelta(hours=36)]
        if len(candidates) != 1:
            continue
        index = candidates.index[0]
        bk = next((b for b in event.get("bookmakers", []) if b["key"] == bookmaker), None)
        if not bk:
            continue
        updated = pd.to_datetime(bk.get("last_update"), utc=True, errors="coerce")
        if (
            pd.isna(updated)
            or now - updated > pd.Timedelta(hours=24)
            or updated > now + pd.Timedelta(minutes=5)
        ):
            continue
        quote = {k: None for k in MARKETS}
        for market in bk.get("markets", []):
            outcomes = market.get("outcomes", [])
            if market["key"] in ("h2h", "spreads"):
                for o in outcomes:
                    side = (
                        "home"
                        if o["name"] == event["home_team"]
                        else "away"
                        if o["name"] == event["away_team"]
                        else None
                    )
                    if not side:
                        continue
                    if market["key"] == "h2h":
                        quote[side + "_ml"] = o["price"]
                    else:
                        quote[side + "_spread_odds"] = o["price"]
                        if side == "home":
                            quote["spread_close"] = o["point"]
            if market["key"] == "totals":
                over = next((o for o in outcomes if o["name"] == "Over"), None)
                under = next((o for o in outcomes if o["name"] == "Under"), None)
                if over and under and over["point"] == under["point"]:
                    quote.update(
                        total_close=over["point"],
                        over_odds=over["price"],
                        under_odds=under["price"],
                    )
        # Never present a missing current market as a fresh quote from an older source.
        for key, value in quote.items():
            result.loc[index, key] = np.nan if value is None else value
        captured = now.isoformat()
        result.loc[index, "odds_captured_at"] = captured
        result.loc[index, "bookmaker"] = bookmaker
        snapshots.append(
            dict(
                quote,
                Game_ID=str(result.loc[index, "Game_ID"]),
                captured_at=captured,
                bookmaker=bookmaker,
                provider_updated_at=bk.get("last_update"),
                event_id=event["id"],
            )
        )
    result["p_home_ml_fair"] = [
        model.remove_vig(model.implied_prob_auto(h), model.implied_prob_auto(a))[0]
        for h, a in zip(result.home_ml, result.away_ml)
    ]
    return result, snapshots


def fetch_odds():
    from app.core.config import get_settings

    settings = get_settings()
    key = os.environ.get("ODDS_API_KEY") or settings.the_odds_api_key
    bookmaker = os.environ.get("NFL_BOOKMAKER") or settings.the_odds_api_bookmaker
    if not key:
        raise ValueError("Falta ODDS_API_KEY para obtener líneas actuales.")
    try:
        response = requests.get(
            "https://api.the-odds-api.com/v4/sports/americanfootball_nfl/odds",
            params={
                "apiKey": key,
                "regions": "us",
                "markets": "h2h,spreads,totals",
                "oddsFormat": "american",
                "bookmakers": bookmaker,
            },
            timeout=(15, 60),
        )
    except requests.RequestException:
        raise ValueError("No se pudo conectar con el proveedor de líneas.") from None
    if response.status_code != 200:
        raise ValueError(f"Proveedor de líneas: HTTP {response.status_code}.")
    return response.json(), bookmaker


def refresh_metrics(store, season, tmp):
    sources.download_pbp([season], tmp, refresh=True)
    dest = tmp / "metrics.csv"
    sources.metrics([season], tmp, dest)
    frame = pd.read_csv(dest)
    store.save_metrics(records(frame))
    return len(frame)


def execute(store, now=None):
    now = pd.Timestamp(now or datetime.now(timezone.utc))
    if not store.lock():
        raise ValueError("Ya hay un pipeline ejecutándose.")
    run_id = str(uuid.uuid4())
    stage = "starting"
    try:
        store.start(run_id)
        stage = "schedule"
        store.progress(run_id, stage)
        count = sync_schedule(store)
        games = load_frame(store.games())
        future = future_games(games, now)
        # Off-season: keep results updated but avoid spending Odds API quota unnecessarily.
        future = future[pd.to_datetime(future.kickoff_at, utc=True) < now + pd.Timedelta(days=10)]
        if future.empty:
            store.finish(
                run_id,
                "skipped",
                {"reason": "Sin partidos programados en los próximos 10 días.", "games": count},
            )
            return run_id
        earliest = future.sort_values("date").iloc[0]
        season, week = int(earliest.season), int(earliest.week)
        stage = "play_by_play"
        store.progress(run_id, stage)
        with tempfile.TemporaryDirectory(prefix="nfp-") as temp:
            tmp = Path(temp)
            # First week has no PBP yet; previous seasons must be seeded once.
            played = games[
                (games.season == season) & games.home_points.notna() & games.away_points.notna()
            ]
            if len(played):
                refresh_metrics(store, season, tmp)
            metrics = store.metrics()
            if not metrics:
                raise ValueError(
                    "Faltan métricas históricas: ejecuta seed una vez antes de activar el pipeline."
                )
            pd.DataFrame(metrics).to_csv(tmp / "all_metrics.csv", index=False)
            stage = "odds"
            store.progress(run_id, stage)
            events, bookmaker = fetch_odds()
            games, snapshots = overlay_odds(games, events, now, bookmaker)
            store.save_odds(run_id, snapshots)
            quoted = {r["Game_ID"] for r in snapshots}
            stage = "predict"
            store.progress(run_id, stage)
            prepared = data.prepare(games, tmp / "all_metrics.csv", [(season, week)])
            # Recheck time after downloads; do not publish new predictions for live games.
            candidates = future_games(prepared, pd.Timestamp.now(tz="UTC"))
            ids = (
                set(candidates[(candidates.season == season) & (candidates.week == week)].Game_ID)
                & quoted
            )
            if not ids:
                raise ValueError("No hay líneas actuales para partidos pendientes de la jornada.")
            preds = pipeline.run(prepared, [(season, week)])
            preds = preds[preds.Game_ID.isin(ids)].copy()
            preds = preds[pd.to_datetime(preds.kickoff_at, utc=True) > pd.Timestamp.now(tz="UTC")]
            if preds.empty:
                raise ValueError(
                    "Los partidos comenzaron durante el cálculo; no se publicó una predicción nueva."
                )
            coverage = {
                c: float(preds[c].notna().mean())
                for c in ["home_off_epa_per_play_asof", "away_off_epa_per_play_asof"]
            }
            details = {
                "season": season,
                "week": week,
                "games": len(preds),
                "bookmaker": bookmaker,
                "epa_coverage": coverage,
                "model": "elo-epa-poisson-logit-v1",
                "odds_at": now.isoformat(),
                "metrics_last_game": str(pd.DataFrame(metrics).game_date.max()),
            }
            store.publish(run_id, preds, pipeline.betting_table(preds), details)
        return run_id
    except Exception as exc:
        # Do not persist provider URLs, database passwords or exception text in public responses/logs.
        store.finish(run_id, "failed", {"stage": stage, "error_type": type(exc).__name__})
        raise
    finally:
        store.unlock()


def seed(store, games_path, metrics_path):
    if not store.lock():
        raise ValueError("Hay otro proceso activo.")
    try:
        games = data.load_games(games_path)
        games["Game_ID"] = games.apply(canonical_id, axis=1)
        existing = {r["Game_ID"]: r for r in store.games()}
        rows = []
        for r in records(games):
            # Rerunning seed must not overwrite later online results.
            if r["Game_ID"] not in existing:
                rows.append(r)
        store.save_games(rows)
        raw = pd.read_csv(metrics_path)
        known = {(r["season"], r["game_id"], r["team"]) for r in store.metrics()}
        store.save_metrics(
            [r for r in records(raw) if (r["season"], r["game_id"], r["team"]) not in known]
        )
        print(f"Importados {len(rows)} partidos nuevos y {len(raw)} filas de métricas.")
    finally:
        store.unlock()


def main():
    parser = argparse.ArgumentParser(description="NFL Predictor online")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("migrate")
    sub.add_parser("run")
    p = sub.add_parser("seed")
    p.add_argument("--games", type=Path, required=True)
    p.add_argument("--metrics", type=Path, required=True)
    args = parser.parse_args()
    try:
        with connection() as store:
            if args.command == "migrate":
                store.migrate()
                print("Esquema NFL online aplicado.")
            elif args.command == "seed":
                seed(store, args.games, args.metrics)
            else:
                print("Ejecución:", execute(store))
    except Exception as exc:
        print(
            f"Pipeline no completado ({type(exc).__name__}). Revisa configuración y etapa en nfp_runs."
        )
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()
