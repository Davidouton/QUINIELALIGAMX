#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import unicodedata
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any

import httpx
from sqlalchemy import text

from app.core.database import engine
from app.core.datetime import MEXICO_CITY_TZ, ensure_utc

RAW_TABLE_NAME = "lmx_odds_5d"
PROVIDER_NAME = "the_odds_api"
DRAW_ALIASES = {"draw", "tie", "empate"}
TEAM_CODE_MAP = {
    "club america": "AME",
    "america": "AME",
    "guadalajara": "GDL",
    "chivas": "GDL",
    "guadalajara chivas": "GDL",
    "cruz azul": "CAZ",
    "pumas unam": "PUM",
    "unam": "PUM",
    "pumas": "PUM",
    "toluca": "TOL",
    "monterrey": "MTY",
    "rayados": "MTY",
    "cf monterrey": "MTY",
    "tigres uanl": "TIG",
    "tigres": "TIG",
    "pachuca": "PAC",
    "leon": "LEO",
    "leon fc": "LEO",
    "santos laguna": "SAN",
    "santos": "SAN",
    "atlas": "ATL",
    "queretaro": "QRO",
    "queretaro fc": "QRO",
    "necaxa": "NEC",
    "puebla": "PUE",
    "mazatlan fc": "MAZ",
    "mazatlan": "MAZ",
    "fc juarez": "JUA",
    "juarez": "JUA",
    "bravos": "JUA",
    "club tijuana": "TIJ",
    "tijuana": "TIJ",
    "xolos": "TIJ",
    "atletico san luis": "SLP",
    "san luis": "SLP",
}

CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS public.lmx_odds_5d (
  id BIGSERIAL PRIMARY KEY,
  pulled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  snapshot_date DATE NOT NULL,
  window_start DATE NOT NULL,
  window_end DATE NOT NULL,
  provider_name TEXT NOT NULL DEFAULT 'the_odds_api',
  fixture_id TEXT NOT NULL,
  match_date TIMESTAMPTZ NOT NULL,
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  home_code TEXT,
  away_code TEXT,
  source_match_key TEXT,
  bookmaker_name TEXT NOT NULL,
  ml_home NUMERIC(10,3),
  ml_draw NUMERIC(10,3),
  ml_away NUMERIC(10,3),
  spread_home_line NUMERIC(10,3),
  spread_home_odds NUMERIC(10,3),
  spread_away_line NUMERIC(10,3),
  spread_away_odds NUMERIC(10,3),
  total_line NUMERIC(10,3),
  over_value NUMERIC(10,3),
  under_value NUMERIC(10,3),
  btts_yes NUMERIC(10,3),
  over_1_5 NUMERIC(10,3),
  over_2_5 NUMERIC(10,3),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (snapshot_date, fixture_id, bookmaker_name)
)
"""

ALTER_TABLE_STATEMENTS = (
    "ALTER TABLE public.lmx_odds_5d ALTER COLUMN fixture_id TYPE TEXT USING fixture_id::text",
    "ALTER TABLE public.lmx_odds_5d ADD COLUMN IF NOT EXISTS provider_name TEXT NOT NULL DEFAULT 'the_odds_api'",
    "ALTER TABLE public.lmx_odds_5d ADD COLUMN IF NOT EXISTS home_code TEXT",
    "ALTER TABLE public.lmx_odds_5d ADD COLUMN IF NOT EXISTS away_code TEXT",
    "ALTER TABLE public.lmx_odds_5d ADD COLUMN IF NOT EXISTS source_match_key TEXT",
    "ALTER TABLE public.lmx_odds_5d ADD COLUMN IF NOT EXISTS spread_home_line NUMERIC(10,3)",
    "ALTER TABLE public.lmx_odds_5d ADD COLUMN IF NOT EXISTS spread_home_odds NUMERIC(10,3)",
    "ALTER TABLE public.lmx_odds_5d ADD COLUMN IF NOT EXISTS spread_away_line NUMERIC(10,3)",
    "ALTER TABLE public.lmx_odds_5d ADD COLUMN IF NOT EXISTS spread_away_odds NUMERIC(10,3)",
    "ALTER TABLE public.lmx_odds_5d ADD COLUMN IF NOT EXISTS total_line NUMERIC(10,3)",
    "ALTER TABLE public.lmx_odds_5d ADD COLUMN IF NOT EXISTS over_value NUMERIC(10,3)",
    "ALTER TABLE public.lmx_odds_5d ADD COLUMN IF NOT EXISTS under_value NUMERIC(10,3)",
)

CREATE_INDEX_STATEMENTS = (
    "CREATE INDEX IF NOT EXISTS idx_lmx_odds_5d_match_date ON public.lmx_odds_5d (match_date)",
    "CREATE INDEX IF NOT EXISTS idx_lmx_odds_5d_fixture_id ON public.lmx_odds_5d (fixture_id)",
    "CREATE INDEX IF NOT EXISTS idx_lmx_odds_5d_source_match_key ON public.lmx_odds_5d (source_match_key)",
)

UPSERT_SQL = """
INSERT INTO public.lmx_odds_5d (
  snapshot_date,
  window_start,
  window_end,
  provider_name,
  fixture_id,
  match_date,
  home_team,
  away_team,
  home_code,
  away_code,
  source_match_key,
  bookmaker_name,
  ml_home,
  ml_draw,
  ml_away,
  spread_home_line,
  spread_home_odds,
  spread_away_line,
  spread_away_odds,
  total_line,
  over_value,
  under_value,
  updated_at
) VALUES (
  :snapshot_date,
  :window_start,
  :window_end,
  :provider_name,
  :fixture_id,
  :match_date,
  :home_team,
  :away_team,
  :home_code,
  :away_code,
  :source_match_key,
  :bookmaker_name,
  :ml_home,
  :ml_draw,
  :ml_away,
  :spread_home_line,
  :spread_home_odds,
  :spread_away_line,
  :spread_away_odds,
  :total_line,
  :over_value,
  :under_value,
  NOW()
)
ON CONFLICT (snapshot_date, fixture_id, bookmaker_name)
DO UPDATE SET
  window_start = EXCLUDED.window_start,
  window_end = EXCLUDED.window_end,
  provider_name = EXCLUDED.provider_name,
  match_date = EXCLUDED.match_date,
  home_team = EXCLUDED.home_team,
  away_team = EXCLUDED.away_team,
  home_code = EXCLUDED.home_code,
  away_code = EXCLUDED.away_code,
  source_match_key = EXCLUDED.source_match_key,
  ml_home = EXCLUDED.ml_home,
  ml_draw = EXCLUDED.ml_draw,
  ml_away = EXCLUDED.ml_away,
  spread_home_line = EXCLUDED.spread_home_line,
  spread_home_odds = EXCLUDED.spread_home_odds,
  spread_away_line = EXCLUDED.spread_away_line,
  spread_away_odds = EXCLUDED.spread_away_odds,
  total_line = EXCLUDED.total_line,
  over_value = EXCLUDED.over_value,
  under_value = EXCLUDED.under_value,
  updated_at = NOW()
"""


@dataclass
class Settings:
    api_key: str
    base_url: str
    sport: str
    regions: str
    markets: str
    odds_format: str
    bookmaker_key: str
    lookahead_days: int
    timeout_seconds: float


def normalize_text(value: str | None) -> str:
    normalized = unicodedata.normalize("NFKD", (value or "").strip().lower())
    ascii_only = normalized.encode("ascii", "ignore").decode("ascii")
    return " ".join(ascii_only.split())


def map_team_code(name: str | None) -> str | None:
    return TEAM_CODE_MAP.get(normalize_text(name))


def parse_iso_datetime(value: str) -> datetime:
    return ensure_utc(datetime.fromisoformat(value.replace("Z", "+00:00")))


def to_decimal(value: Any) -> Decimal | None:
    if value is None:
        return None
    return Decimal(str(value))


def build_source_match_key(home_code: str | None, away_code: str | None, match_date: datetime) -> str | None:
    if not home_code or not away_code:
        return None
    local_date = ensure_utc(match_date).astimezone(MEXICO_CITY_TZ).date().isoformat()
    return f"{home_code}-{away_code}-{local_date}"


def get_required_env(*keys: str) -> str:
    for key in keys:
        value = os.getenv(key)
        if value:
            return value
    joined = " / ".join(keys)
    raise RuntimeError(f"Falta configurar {joined} para jalar The Odds API.")


def load_settings() -> Settings:
    return Settings(
        api_key=get_required_env("THE_ODDS_API_KEY", "ODDS_API_KEY"),
        base_url=os.getenv("THE_ODDS_API_BASE_URL", "https://api.the-odds-api.com/v4").rstrip("/"),
        sport=os.getenv("THE_ODDS_API_SPORT", "soccer_mexico_ligamx"),
        regions=os.getenv("THE_ODDS_API_REGIONS", "us"),
        markets=os.getenv("THE_ODDS_API_MARKETS", "h2h,spreads,totals"),
        odds_format=os.getenv("THE_ODDS_API_ODDS_FORMAT", "american"),
        bookmaker_key=os.getenv("THE_ODDS_API_BOOKMAKER", "draftkings").strip().lower(),
        lookahead_days=max(int(os.getenv("ODDS_LOOKAHEAD_DAYS", "5")), 1),
        timeout_seconds=max(float(os.getenv("ODDS_REQUEST_TIMEOUT_SECONDS", "30")), 5.0),
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Pull raw Liga MX odds from The Odds API")
    parser.add_argument("--table", default=RAW_TABLE_NAME, help="Raw odds table name in public schema.")
    return parser.parse_args()


def fetch_events(settings: Settings) -> tuple[list[dict[str, Any]], str | None, str | None]:
    url = f"{settings.base_url}/sports/{settings.sport}/odds"
    params = {
        "apiKey": settings.api_key,
        "regions": settings.regions,
        "markets": settings.markets,
        "oddsFormat": settings.odds_format,
        "bookmakers": settings.bookmaker_key,
    }

    with httpx.Client(timeout=settings.timeout_seconds, follow_redirects=True) as client:
        response = client.get(url, params=params)
        if response.status_code >= 400:
            try:
                payload = response.json()
            except json.JSONDecodeError:
                payload = {}

            error_code = str(payload.get("error_code") or "").strip().upper()
            message = str(payload.get("message") or response.text or "The Odds API request failed.").strip()
            if error_code == "OUT_OF_USAGE_CREDITS":
                raise RuntimeError("ODDS-API sin creditos. El plan actual ya consumio su cuota.")
            if response.status_code == 401:
                raise RuntimeError(f"ODDS-API rechazo la peticion: {message}")
            raise RuntimeError(f"ODDS-API error {response.status_code}: {message}")
        return (
            response.json(),
            response.headers.get("x-requests-used"),
            response.headers.get("x-requests-remaining"),
        )


def extract_market_values(event: dict[str, Any], bookmaker_key: str) -> dict[str, Decimal | None]:
    values: dict[str, Decimal | None] = {
        "ml_home": None,
        "ml_draw": None,
        "ml_away": None,
        "spread_home_line": None,
        "spread_home_odds": None,
        "spread_away_line": None,
        "spread_away_odds": None,
        "total_line": None,
        "over_value": None,
        "under_value": None,
    }

    bookmaker = next(
        (candidate for candidate in event.get("bookmakers", []) if candidate.get("key") == bookmaker_key),
        None,
    )
    if bookmaker is None:
        return values

    home_name = str(event.get("home_team") or "").strip()
    away_name = str(event.get("away_team") or "").strip()

    for market in bookmaker.get("markets", []):
        market_key = market.get("key")
        outcomes = market.get("outcomes", [])

        if market_key == "h2h":
            for outcome in outcomes:
                name = str(outcome.get("name") or "").strip()
                price = to_decimal(outcome.get("price"))
                normalized = normalize_text(name)
                if normalized in DRAW_ALIASES:
                    values["ml_draw"] = price
                elif normalize_text(name) == normalize_text(home_name):
                    values["ml_home"] = price
                elif normalize_text(name) == normalize_text(away_name):
                    values["ml_away"] = price

        elif market_key == "spreads":
            for outcome in outcomes:
                name = str(outcome.get("name") or "").strip()
                point = to_decimal(outcome.get("point"))
                price = to_decimal(outcome.get("price"))
                if normalize_text(name) == normalize_text(home_name):
                    values["spread_home_line"] = point
                    values["spread_home_odds"] = price
                elif normalize_text(name) == normalize_text(away_name):
                    values["spread_away_line"] = point
                    values["spread_away_odds"] = price

        elif market_key == "totals":
            for outcome in outcomes:
                name = str(outcome.get("name") or "").strip().lower()
                point = to_decimal(outcome.get("point"))
                price = to_decimal(outcome.get("price"))
                if point is not None:
                    values["total_line"] = point
                if name == "over":
                    values["over_value"] = price
                elif name == "under":
                    values["under_value"] = price

    return values


def build_rows(settings: Settings, events: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], set[str], date]:
    now_local = datetime.now(MEXICO_CITY_TZ)
    snapshot_date = now_local.date()
    window_start = snapshot_date
    window_end = snapshot_date + timedelta(days=settings.lookahead_days)
    rows: list[dict[str, Any]] = []
    unmapped_teams: set[str] = set()

    for event in events:
        event_id = event.get("id")
        home_team = str(event.get("home_team") or "").strip()
        away_team = str(event.get("away_team") or "").strip()
        if not event_id or not home_team or not away_team or not event.get("commence_time"):
            continue

        match_date = parse_iso_datetime(str(event["commence_time"]))
        local_date = match_date.astimezone(MEXICO_CITY_TZ).date()
        if local_date < window_start or local_date > window_end:
            continue

        home_code = map_team_code(home_team)
        away_code = map_team_code(away_team)
        if home_code is None:
            unmapped_teams.add(home_team)
        if away_code is None:
            unmapped_teams.add(away_team)

        market_values = extract_market_values(event, settings.bookmaker_key)
        source_match_key = build_source_match_key(home_code, away_code, match_date)
        rows.append(
            {
                "snapshot_date": snapshot_date,
                "window_start": window_start,
                "window_end": window_end,
                "provider_name": PROVIDER_NAME,
                "fixture_id": str(event_id),
                "match_date": match_date,
                "home_team": home_team,
                "away_team": away_team,
                "home_code": home_code,
                "away_code": away_code,
                "source_match_key": source_match_key,
                "bookmaker_name": settings.bookmaker_key,
                **market_values,
            }
        )

    return rows, unmapped_teams, snapshot_date


def ensure_raw_table(table_name: str) -> None:
    if table_name != RAW_TABLE_NAME:
        raise RuntimeError(f"Tabla raw no soportada: {table_name}")

    with engine.begin() as connection:
        connection.execute(text(CREATE_TABLE_SQL))
        for statement in ALTER_TABLE_STATEMENTS:
            connection.execute(text(statement))
        for statement in CREATE_INDEX_STATEMENTS:
            connection.execute(text(statement))


def replace_snapshot_rows(table_name: str, snapshot_date: date, bookmaker_key: str, rows: list[dict[str, Any]]) -> int:
    with engine.begin() as connection:
        connection.execute(
            text(
                f"""
                DELETE FROM public.{table_name}
                WHERE snapshot_date = :snapshot_date
                  AND provider_name = :provider_name
                  AND bookmaker_name = :bookmaker_name
                """
            ),
            {
                "snapshot_date": snapshot_date,
                "provider_name": PROVIDER_NAME,
                "bookmaker_name": bookmaker_key,
            },
        )
        for row in rows:
            connection.execute(text(UPSERT_SQL), row)

        return int(
            connection.execute(
                text(
                    f"""
                    SELECT COUNT(*)
                    FROM public.{table_name}
                    WHERE snapshot_date = :snapshot_date
                      AND provider_name = :provider_name
                      AND bookmaker_name = :bookmaker_name
                    """
                ),
                {
                    "snapshot_date": snapshot_date,
                    "provider_name": PROVIDER_NAME,
                    "bookmaker_name": bookmaker_key,
                },
            ).scalar_one()
        )


def main() -> int:
    args = parse_args()
    settings = load_settings()
    events, credits_used, credits_remaining = fetch_events(settings)
    rows, unmapped_teams, snapshot_date = build_rows(settings, events)
    ensure_raw_table(args.table)
    raw_rows_processed = replace_snapshot_rows(args.table, snapshot_date, settings.bookmaker_key, rows)

    print(
        f"Raw odds pull complete for snapshot {snapshot_date.isoformat()}: "
        f"{raw_rows_processed} rows upserted for {settings.bookmaker_key}. "
        f"Credits used={credits_used or 'n/a'}, remaining={credits_remaining or 'n/a'}."
    )
    if unmapped_teams:
        print("Unmapped teams: " + ", ".join(sorted(unmapped_teams)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
