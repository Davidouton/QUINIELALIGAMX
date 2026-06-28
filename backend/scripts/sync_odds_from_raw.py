#!/usr/bin/env python3
from __future__ import annotations

import argparse
import re
from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime, time
from decimal import Decimal
from typing import Any

from sqlalchemy import Select, inspect, select, text
from sqlalchemy.orm import Session

from app.core.database import SessionLocal, engine
from app.core.datetime import MEXICO_CITY_TZ, ensure_utc
from app.core.team_matching import EQUIVALENT_TEAM_CODES, TEAM_CODE_ALIASES, normalize_text
from app.models.entities import Match, MatchStatus, Matchday, MatchdayStatus, Odds, Season, Team, TournamentFormat

RAW_TABLE_NAME = "lmx_odds_5d"
LEGACY_PROVIDER_NAME = "api_football"


@dataclass
class RawOddsRow:
    provider_name: str
    sport_key: str | None
    bookmaker_name: str
    fixture_id: str | None
    match_date: datetime
    home_team: str
    away_team: str
    home_code: str | None
    away_code: str | None
    source_match_key: str | None
    home_value: Decimal | None
    draw_value: Decimal | None
    away_value: Decimal | None
    spread_home_line: str | None
    spread_home_odds: str | None
    spread_away_line: str | None
    spread_away_odds: str | None
    total_line: str | None
    over_value: str | None
    under_value: str | None


def coerce_decimal(value: Any) -> Decimal | None:
    if value is None:
        return None
    if isinstance(value, Decimal):
        return value
    if isinstance(value, int | float):
        return Decimal(str(value))
    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return None
        return Decimal(stripped)
    return Decimal(str(value))


def decimal_to_string(value: Any) -> str | None:
    decimal_value = coerce_decimal(value)
    if decimal_value is None:
        return None
    return format(decimal_value, "f")


def build_source_match_key(home_code: str | None, away_code: str | None, match_date: datetime) -> str | None:
    if not home_code or not away_code:
        return None
    mexico_city_date = ensure_utc(match_date).astimezone(MEXICO_CITY_TZ).date().isoformat()
    return f"{home_code}-{away_code}-{mexico_city_date}"


def fallback_team_code(name: str) -> str:
    compact = re.sub(r"[^a-z]", "", normalize_text(name))
    code = compact[:3].upper()
    return code or "TMP"


def mexico_city_day_bounds(match_date: datetime) -> tuple[datetime, datetime]:
    local_day = ensure_utc(match_date).astimezone(MEXICO_CITY_TZ).date()
    start_at = datetime.combine(local_day, time.min, tzinfo=MEXICO_CITY_TZ).astimezone(UTC)
    end_at = datetime.combine(local_day, time.max, tzinfo=MEXICO_CITY_TZ).astimezone(UTC)
    return start_at, end_at


def load_team_lookup(db: Session) -> dict[str, str]:
    lookup: dict[str, str] = {}
    teams = list(db.scalars(select(Team).order_by(Team.name.asc())))
    actual_codes = {team.short_name.upper() for team in teams}
    for team in teams:
      # short_name is the canonical code we want back.
        code = team.short_name.upper()
        lookup[normalize_text(team.short_name)] = code
        lookup[normalize_text(team.name)] = code
        lookup[normalize_text(team.slug)] = code

    for alias, code in TEAM_CODE_ALIASES.items():
        resolved_code = next(
            (candidate for candidate in EQUIVALENT_TEAM_CODES.get(code, (code,)) if candidate in actual_codes),
            code,
        )
        lookup.setdefault(normalize_text(alias), resolved_code)
    return lookup


def load_team_registry(db: Session) -> tuple[dict[str, Team], dict[str, Team]]:
    by_code: dict[str, Team] = {}
    by_name: dict[str, Team] = {}

    teams = list(db.scalars(select(Team).order_by(Team.name.asc())))
    for team in teams:
        by_code[team.short_name.upper()] = team
        by_name[normalize_text(team.name)] = team
        by_name[normalize_text(team.slug)] = team
        by_name[normalize_text(team.short_name)] = team

    return by_code, by_name


def resolve_team_code(name: str, lookup: dict[str, str]) -> str | None:
    return lookup.get(normalize_text(name))


def find_team(
    team_name: str,
    team_code: str | None,
    by_code: dict[str, Team],
    by_name: dict[str, Team],
) -> Team | None:
    normalized_name = normalize_text(team_name)
    normalized_code = (team_code or fallback_team_code(team_name)).upper()

    for candidate in EQUIVALENT_TEAM_CODES.get(normalized_code, (normalized_code,)):
        team = by_code.get(candidate)
        if team is not None:
            return team
    return by_name.get(normalized_name)


def ensure_active_season(db: Session, reference_date: datetime, sport_key: str | None = None) -> tuple[Season, bool]:
    if sport_key == "soccer_fifa_world_cup":
        world_cup = db.scalar(
            select(Season)
            .where(Season.tournament_format == TournamentFormat.WORLD_CUP)
            .order_by(Season.is_active.desc(), Season.created_at.desc())
        )
        if world_cup is not None:
            return world_cup, False

        year = ensure_utc(reference_date).astimezone(MEXICO_CITY_TZ).year
        season = Season(
            name=f"Mundial {year}",
            slug=f"mundial-{year}",
            tournament_format=TournamentFormat.WORLD_CUP,
            is_active=False,
        )
        db.add(season)
        db.flush()
        return season, True

    active = db.scalar(select(Season).where(Season.is_active.is_(True)).order_by(Season.created_at.desc()))
    if active is not None:
        return active, False

    year = ensure_utc(reference_date).astimezone(MEXICO_CITY_TZ).year
    season = Season(
        name=f"Temporada {year}",
        slug=f"temporada-{year}",
        is_active=True,
    )
    db.add(season)
    db.flush()
    return season, True


def ensure_snapshot_matchday(
    db: Session,
    season: Season,
    raw_rows: list[RawOddsRow],
) -> tuple[Matchday, bool]:
    min_match_date = min(ensure_utc(row.match_date) for row in raw_rows)
    max_match_date = max(ensure_utc(row.match_date) for row in raw_rows)
    starts_at, _ = mexico_city_day_bounds(min_match_date)
    _, ends_at = mexico_city_day_bounds(max_match_date)

    existing_matchdays = list(
        db.scalars(
            select(Matchday)
            .where(Matchday.season_id == season.id)
            .order_by(Matchday.number.asc())
        )
    )
    for matchday in existing_matchdays:
        if ensure_utc(matchday.starts_at) <= min_match_date and ensure_utc(matchday.ends_at) >= max_match_date:
            return matchday, False

    next_number = max((matchday.number for matchday in existing_matchdays), default=0) + 1
    has_active = any(matchday.status == MatchdayStatus.ACTIVE for matchday in existing_matchdays)
    matchday = Matchday(
        season_id=season.id,
        number=next_number,
        name=f"Auto Odds {starts_at.astimezone(MEXICO_CITY_TZ).date().isoformat()}",
        default_lock_offset_minutes=10,
        status=MatchdayStatus.DRAFT if has_active else MatchdayStatus.ACTIVE,
        starts_at=starts_at,
        ends_at=ends_at,
    )
    db.add(matchday)
    db.flush()
    return matchday, True


def get_latest_snapshot_date(table_name: str) -> str | None:
    with engine.begin() as connection:
        result = connection.execute(text(f"SELECT MAX(snapshot_date)::text FROM public.{table_name}"))
        return result.scalar_one_or_none()


def load_raw_rows(
    table_name: str,
    snapshot_date: str | None,
    lookup: dict[str, str],
    sport_key: str | None = None,
) -> list[RawOddsRow]:
    inspector = inspect(engine)
    column_names = {column["name"] for column in inspector.get_columns(table_name, schema="public")}

    optional_columns = {
        "provider_name": "provider_name",
        "sport_key": "sport_key",
        "home_code": "home_code",
        "away_code": "away_code",
        "source_match_key": "source_match_key",
        "spread_home_line": "spread_home_line",
        "spread_home_odds": "spread_home_odds",
        "spread_away_line": "spread_away_line",
        "spread_away_odds": "spread_away_odds",
        "total_line": "total_line",
        "over_value": "over_value",
        "under_value": "under_value",
        "over_2_5": "over_2_5",
    }

    select_parts = [
        "bookmaker_name",
        "fixture_id",
        "match_date",
        "home_team",
        "away_team",
        "ml_home",
        "ml_draw",
        "ml_away",
    ]
    for column_name, alias in optional_columns.items():
        if column_name in column_names:
            select_parts.append(f"{column_name} AS {alias}")
        else:
            fallback = f"'{LEGACY_PROVIDER_NAME}'" if column_name == "provider_name" else "NULL"
            select_parts.append(f"{fallback} AS {alias}")

    query = f"SELECT {', '.join(select_parts)} FROM public.{table_name}"
    params: dict[str, Any] = {}
    if snapshot_date:
        query += " WHERE snapshot_date = :snapshot_date"
        params["snapshot_date"] = snapshot_date
    if sport_key and "sport_key" in column_names:
        query += " AND sport_key = :sport_key" if params else " WHERE sport_key = :sport_key"
        params["sport_key"] = sport_key
    query += " ORDER BY match_date ASC, home_team ASC, away_team ASC"

    rows: list[RawOddsRow] = []
    with engine.begin() as connection:
        result = connection.execute(text(query), params).mappings()
        for row in result:
            resolved_home_code = resolve_team_code(str(row["home_team"]), lookup)
            resolved_away_code = resolve_team_code(str(row["away_team"]), lookup)
            home_code = resolved_home_code or row["home_code"]
            away_code = resolved_away_code or row["away_code"]
            source_match_key = row["source_match_key"] or build_source_match_key(home_code, away_code, row["match_date"])
            over_value = row["over_value"] or row["over_2_5"]
            rows.append(
                RawOddsRow(
                    provider_name=str(row["provider_name"]),
                    sport_key=str(row["sport_key"]) if row["sport_key"] is not None else None,
                    bookmaker_name=str(row["bookmaker_name"]),
                    fixture_id=str(row["fixture_id"]) if row["fixture_id"] is not None else None,
                    match_date=row["match_date"],
                    home_team=str(row["home_team"]),
                    away_team=str(row["away_team"]),
                    home_code=home_code,
                    away_code=away_code,
                    source_match_key=source_match_key,
                    home_value=coerce_decimal(row["ml_home"]) if "ml_home" in row else None,
                    draw_value=coerce_decimal(row["ml_draw"]) if "ml_draw" in row else None,
                    away_value=coerce_decimal(row["ml_away"]) if "ml_away" in row else None,
                    spread_home_line=decimal_to_string(row["spread_home_line"]),
                    spread_home_odds=decimal_to_string(row["spread_home_odds"]),
                    spread_away_line=decimal_to_string(row["spread_away_line"]),
                    spread_away_odds=decimal_to_string(row["spread_away_odds"]),
                    total_line=decimal_to_string(row["total_line"]),
                    over_value=decimal_to_string(over_value),
                    under_value=decimal_to_string(row["under_value"]),
                )
            )
    return rows


def build_match_lookup(db: Session) -> dict[str, list[Match]]:
    from sqlalchemy.orm import aliased

    HomeTeam = aliased(Team)
    AwayTeam = aliased(Team)
    stmt: Select[tuple[Match, Team, Team]] = (
        select(Match, HomeTeam, AwayTeam)
        .join(HomeTeam, HomeTeam.id == Match.home_team_id)
        .join(AwayTeam, AwayTeam.id == Match.away_team_id)
        .order_by(Match.kickoff_at.asc())
    )
    lookup: dict[str, list[Match]] = defaultdict(list)
    for match, home, away in db.execute(stmt).all():
        key = build_source_match_key(home.short_name.upper(), away.short_name.upper(), match.kickoff_at)
        if key:
            lookup[key].append(match)
    return lookup


def find_match_by_external_id(db: Session, fixture_id: str | None) -> Match | None:
    if not fixture_id:
        return None
    return db.scalar(select(Match).where(Match.external_id == str(fixture_id)))


def create_match_from_row(db: Session, matchday: Matchday, home_team: Team, away_team: Team, row: RawOddsRow) -> Match:
    kickoff_at = ensure_utc(row.match_date)
    match = Match(
        matchday_id=matchday.id,
        external_id=str(row.fixture_id) if row.fixture_id is not None else None,
        home_team_id=home_team.id,
        away_team_id=away_team.id,
        kickoff_at=kickoff_at,
        picks_lock_at=kickoff_at,
        venue=home_team.home_venue,
        status=MatchStatus.SCHEDULED,
    )
    db.add(match)
    db.flush()
    return match


def upsert_match_odds(db: Session, match: Match, row: RawOddsRow) -> None:
    provider_key = f"{row.provider_name}:{row.bookmaker_name}"
    existing = db.scalar(
        select(Odds).where(Odds.match_id == match.id, Odds.provider_name == provider_key)
    )
    if existing is None:
        existing = Odds(match_id=match.id, provider_name=provider_key)

    existing.home_value = row.home_value
    existing.draw_value = row.draw_value
    existing.away_value = row.away_value
    existing.spread_home_line = row.spread_home_line
    existing.spread_home_odds = row.spread_home_odds
    existing.spread_away_line = row.spread_away_line
    existing.spread_away_odds = row.spread_away_odds
    existing.total_line = row.total_line
    existing.over_value = row.over_value
    existing.under_value = row.under_value
    existing.synced_at = datetime.now(UTC)
    db.add(existing)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Sync raw odds rows into QuinielaMaestra odds table")
    parser.add_argument("--snapshot-date", help="Snapshot date in YYYY-MM-DD. Defaults to latest snapshot.")
    parser.add_argument("--sport-key", help="Only sync raw rows for this The Odds API sport key.")
    parser.add_argument("--table", default=RAW_TABLE_NAME, help="Raw odds table name in public schema.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    snapshot_date = args.snapshot_date or get_latest_snapshot_date(args.table)
    if snapshot_date is None:
        print("No raw odds snapshot found.")
        return 0

    with SessionLocal() as db:
        lookup = load_team_lookup(db)
        raw_rows = load_raw_rows(args.table, snapshot_date, lookup, sport_key=args.sport_key)
        if not raw_rows:
            print(f"No raw odds rows found for snapshot {snapshot_date}.")
            return 0

        season, created_season = ensure_active_season(db, raw_rows[0].match_date, sport_key=args.sport_key)
        matchday, created_matchday = ensure_snapshot_matchday(db, season, raw_rows)
        teams_by_code, teams_by_name = load_team_registry(db)
        match_lookup = build_match_lookup(db)
        matched = 0
        unmatched = 0
        missing_teams = 0
        created_matches = 0

        for row in raw_rows:
            if not row.source_match_key:
                unmatched += 1
                continue

            home_team = find_team(
                row.home_team,
                row.home_code,
                teams_by_code,
                teams_by_name,
            )
            away_team = find_team(
                row.away_team,
                row.away_code,
                teams_by_code,
                teams_by_name,
            )
            if home_team is None or away_team is None:
                unmatched += 1
                missing_teams += 1
                continue

            candidates = match_lookup.get(row.source_match_key, [])
            if not candidates and row.fixture_id:
                existing_by_external_id = find_match_by_external_id(db, row.fixture_id)
                if existing_by_external_id is not None:
                    match_lookup[row.source_match_key].append(existing_by_external_id)
                    candidates = [existing_by_external_id]
            if not candidates:
                created_match = create_match_from_row(db, matchday, home_team, away_team, row)
                match_lookup[row.source_match_key].append(created_match)
                candidates = [created_match]
                created_matches += 1

            upsert_match_odds(db, candidates[0], row)
            matched += 1
        db.commit()

    print(
        f"Odds sync complete for snapshot {snapshot_date}: "
        f"{matched} matched, {unmatched} unmatched, "
        f"{missing_teams} missing teams, {created_matches} matches created, "
        f"{1 if created_matchday else 0} matchdays created, "
        f"{1 if created_season else 0} seasons created."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
