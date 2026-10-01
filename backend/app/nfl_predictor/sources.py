"""Descargas explícitas y preparación del play-by-play, sin claves embebidas."""

import json
import os
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import requests

from . import legacy_pbp
from .data import TEAM_MAP


def download_pbp(years, directory, refresh=False):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    for year in years:
        target = directory / f"play_by_play_{year}.csv.gz"
        if target.exists() and not refresh:
            print(f"Ya existe: {target}")
            continue
        url = f"https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_{year}.csv.gz"
        temp = target.with_suffix(".gz.part")
        try:
            with requests.get(url, stream=True, timeout=(15, 120)) as response:
                response.raise_for_status()
                with temp.open("wb") as f:
                    for chunk in response.iter_content(1024 * 1024):
                        f.write(chunk)
            # Validar cabecera gzip antes de publicar el archivo.
            with temp.open("rb") as f:
                if f.read(2) != b"\x1f\x8b":
                    raise ValueError("La descarga no es gzip.")
            temp.replace(target)
        finally:
            temp.unlink(missing_ok=True)
        print(target)


def metrics(years, directory, output, fallback_directory=None):
    needed = {
        "season",
        "week",
        "season_type",
        "game_id",
        "game_date",
        "home_team",
        "away_team",
        "posteam",
        "defteam",
        "epa",
        "success",
        "pass",
        "rush",
        "play_type",
        "qb_kneel",
        "qb_spike",
    }
    games = []
    for year in years:
        path = Path(directory) / f"play_by_play_{year}.csv.gz"
        if not path.exists() and fallback_directory:
            path = Path(fallback_directory) / path.name
        if not path.exists():
            raise FileNotFoundError(f"Falta PBP {year}: {path}")
        pbp = pd.read_csv(path, usecols=lambda c: c in needed, low_memory=False)
        required = needed - {"qb_kneel", "qb_spike"}
        if required - set(pbp):
            raise ValueError(f"PBP {year}: faltan columnas {sorted(required - set(pbp))}")
        pbp["game_date"] = pd.to_datetime(pbp.game_date)
        mask = (pbp.play_type.isin(["run", "pass"])) | (pbp["pass"] == 1) | (pbp.rush == 1)
        for col in ["qb_kneel", "qb_spike"]:
            if col in pbp:
                mask &= pbp[col].fillna(0) != 1
        pbp = pbp[mask].dropna(subset=["posteam", "defteam", "epa"])
        # Incluye playoffs; el cálculo se mantiene agrupado por temporada.
        games.append(legacy_pbp.build_team_game_stats(pbp))
        print(f"{year}: {len(pbp):,} jugadas, {len(games[-1])} filas equipo/partido")
    result = legacy_pbp.add_asof_features(pd.concat(games, ignore_index=True))
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists():
        previous = pd.read_csv(output)
        previous = previous[~previous.season.isin(years)]
        result = pd.concat([previous, result], ignore_index=True)
    result["game_date"] = pd.to_datetime(result["game_date"], format="ISO8601").dt.strftime(
        "%Y-%m-%d"
    )
    temporary = output.with_suffix(".csv.part")
    result.to_csv(temporary, index=False)
    temporary.replace(output)
    return output


def odds(output, bookmaker="draftkings"):
    key = os.environ.get("ODDS_API_KEY", "").strip()
    if not key:
        raise ValueError("Configura ODDS_API_KEY en tu entorno para descargar líneas.")
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
        raise ValueError("No se pudo conectar con The Odds API. Revisa tu conexión.") from None
    if response.status_code != 200:
        raise ValueError(
            f"The Odds API respondió HTTP {response.status_code}. Revisa la clave y la cuota."
        )
    rows = []
    for event in response.json():
        dt = pd.Timestamp(event["commence_time"]).tz_convert("America/Mexico_City")
        row = {
            "game_id": event["id"],
            "date": dt.strftime("%Y-%m-%d"),
            "home": TEAM_MAP.get(event["home_team"], event["home_team"]),
            "away": TEAM_MAP.get(event["away_team"], event["away_team"]),
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        }
        for col in [
            "ML_home",
            "ML_away",
            "SP_home_line",
            "SP_home_odds",
            "SP_away_line",
            "SP_away_odds",
            "Total_line",
            "Over_odds",
            "Under_odds",
        ]:
            row[col] = None
        for bk in event.get("bookmakers", []):
            if bk["key"] != bookmaker:
                continue
            for market in bk.get("markets", []):
                for o in market.get("outcomes", []):
                    side = (
                        "home"
                        if o["name"] == event["home_team"]
                        else "away"
                        if o["name"] == event["away_team"]
                        else None
                    )
                    if market["key"] == "h2h" and side:
                        row[f"ML_{side}"] = o["price"]
                    if market["key"] == "spreads" and side:
                        row[f"SP_{side}_line"] = o["point"]
                        row[f"SP_{side}_odds"] = o["price"]
                    if market["key"] == "totals" and o["name"] in ["Over", "Under"]:
                        row["Total_line"] = o["point"]
                        row[o["name"] + "_odds"] = o["price"]
        rows.append(row)
    if not rows:
        raise ValueError("El proveedor no devolvió eventos NFL.")
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    pd.DataFrame(rows).to_csv(output, index=False)
    output.with_suffix(".json").write_text(
        json.dumps(
            {
                "bookmaker": bookmaker,
                "fetched_at": datetime.now(timezone.utc).isoformat(),
                "events": len(rows),
            },
            indent=2,
        )
    )
    return output
