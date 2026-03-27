from __future__ import annotations

import argparse
import csv
from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

from sqlalchemy import select

from app.core.database import SessionLocal
from app.core.team_matching import build_team_code_lookup, mexico_city_match_date, resolve_team_code
from app.models.entities import Match, Matchday, Odds, Season, Team

IMPORT_PROVIDER = "csv_history"


@dataclass
class HistoryOddsRow:
    external_id: str
    season_code: str
    matchday_number: int
    match_date: datetime
    home_team_code: str
    away_team_code: str
    home_value: Decimal | None
    draw_value: Decimal | None
    away_value: Decimal | None


def log(message: str) -> None:
    print(message, flush=True)


def synthetic_external_id(
    season_code: str,
    matchday_number: int,
    match_date: str,
    home_team_code: str,
    away_team_code: str,
) -> str:
    return f"csv-{season_code.lower()}-j{matchday_number}-{match_date.replace('/', '-')}-{home_team_code.lower()}-{away_team_code.lower()}"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Importa odds historicos desde CSV a la tabla odds.")
    parser.add_argument("csv_path", help="Ruta al archivo CSV.")
    parser.add_argument("--apply", action="store_true", help="Escribe cambios en la base. Sin esto solo hace dry-run.")
    return parser.parse_args()


def coerce_decimal(value: str) -> Decimal | None:
    stripped = value.strip()
    if stripped == "":
      return None
    return Decimal(stripped)


def parse_csv(path: Path) -> list[HistoryOddsRow]:
    rows: list[HistoryOddsRow] = []
    with path.open("r", encoding="utf-8-sig", newline="") as file:
        reader = csv.DictReader(file)
        for raw in reader:
            season_code = (raw.get("Season") or "").strip()
            matchday_raw = (raw.get("MatchDay") or "").strip()
            match_date_raw = (raw.get("Date") or "").strip()
            home_team_raw = (raw.get("Home Team") or "").strip().upper()
            away_team_raw = (raw.get("Away Team") or "").strip().upper()
            if not season_code or not matchday_raw or not match_date_raw or not home_team_raw or not away_team_raw:
                continue

            home_value = coerce_decimal(raw.get("Home ML") or "")
            draw_value = coerce_decimal(raw.get("Draw ML") or "")
            away_value = coerce_decimal(raw.get("Away ML") or "")
            if home_value is None or draw_value is None or away_value is None:
                continue

            external_id = (raw.get("Event ID") or "").strip() or synthetic_external_id(
                season_code,
                int(matchday_raw),
                match_date_raw,
                home_team_raw,
                away_team_raw,
            )
            rows.append(
                HistoryOddsRow(
                    external_id=external_id,
                    season_code=season_code,
                    matchday_number=int(matchday_raw),
                    match_date=datetime.strptime(match_date_raw, "%m/%d/%y"),
                    home_team_code=home_team_raw,
                    away_team_code=away_team_raw,
                    home_value=home_value,
                    draw_value=draw_value,
                    away_value=away_value,
                )
            )
    return rows


def season_name_and_slug(season_code: str) -> tuple[str, str]:
    code = season_code.strip().upper()
    if len(code) == 4 and code[:2] in {"CL", "AP"} and code[2:].isdigit():
        year = 2000 + int(code[2:])
        if code.startswith("CL"):
            return f"Clausura {year}", f"clausura-{year}"
        return f"Apertura {year}", f"apertura-{year}"
    normalized = code.lower().replace("_", "-")
    return code, normalized


def load_team_maps(db) -> tuple[dict[str, Team], dict[str, str], set[str]]:
    teams = list(db.scalars(select(Team).order_by(Team.name.asc())))
    by_code = {team.short_name.upper(): team for team in teams}
    lookup = build_team_code_lookup(teams)
    codes = set(by_code.keys())
    return by_code, lookup, codes


def find_match(
    db,
    season_slug: str,
    matchday_number: int,
    external_id: str,
    home_team_id: str,
    away_team_id: str,
    match_date_iso: str,
) -> Match | None:
    match = db.scalar(select(Match).where(Match.external_id == external_id))
    if match is not None:
        return match

    season = db.scalar(select(Season).where(Season.slug == season_slug))
    if season is None:
        return None

    matchday = db.scalar(
        select(Matchday).where(
            Matchday.season_id == season.id,
            Matchday.number == matchday_number,
        )
    )
    if matchday is None:
        return None

    candidates = list(
        db.scalars(
            select(Match).where(
                Match.matchday_id == matchday.id,
                Match.home_team_id == home_team_id,
                Match.away_team_id == away_team_id,
            )
        )
    )
    for candidate in candidates:
        if mexico_city_match_date(candidate.kickoff_at) == match_date_iso:
            return candidate
    return None


def upsert_odds(
    db,
    match: Match,
    row: HistoryOddsRow,
) -> tuple[bool, bool]:
    existing = db.scalar(
        select(Odds).where(
            Odds.match_id == match.id,
            Odds.provider_name == IMPORT_PROVIDER,
        )
    )
    created = existing is None
    odds = existing or Odds(match_id=match.id, provider_name=IMPORT_PROVIDER)
    odds.home_value = row.home_value
    odds.draw_value = row.draw_value
    odds.away_value = row.away_value
    odds.synced_at = datetime.now(UTC)
    db.add(odds)
    return created, not created


def main() -> int:
    args = parse_args()
    csv_path = Path(args.csv_path).expanduser()
    if not csv_path.exists():
        log(f"CSV no encontrado: {csv_path}")
        return 1

    log(f"Leyendo CSV: {csv_path}")
    rows = parse_csv(csv_path)
    if not rows:
        log("No se encontraron filas con odds validos en el CSV.")
        return 1
    log(f"Filas con odds detectadas: {len(rows)}")

    db = SessionLocal()
    try:
        log("Cargando catalogo de equipos...")
        teams_by_code, team_lookup, actual_codes = load_team_maps(db)
        log(f"Equipos disponibles: {len(teams_by_code)}")

        created_odds = 0
        updated_odds = 0
        unresolved_rows: list[dict[str, Any]] = []
        grouped_counts: dict[str, dict[int, int]] = defaultdict(lambda: defaultdict(int))

        for row in rows:
            grouped_counts[row.season_code][row.matchday_number] += 1
            season_name, season_slug = season_name_and_slug(row.season_code)
            resolved_home_code = resolve_team_code(row.home_team_code, team_lookup, actual_codes)
            resolved_away_code = resolve_team_code(row.away_team_code, team_lookup, actual_codes)
            home_team = teams_by_code.get(resolved_home_code or "")
            away_team = teams_by_code.get(resolved_away_code or "")

            if home_team is None or away_team is None:
                unresolved_rows.append(
                    {
                        "external_id": row.external_id,
                        "season": row.season_code,
                        "matchday": row.matchday_number,
                        "date": row.match_date.date().isoformat(),
                        "home_team": row.home_team_code,
                        "away_team": row.away_team_code,
                        "reason": "Equipo no resuelto",
                    }
                )
                continue

            match = find_match(
                db,
                season_slug,
                row.matchday_number,
                row.external_id,
                home_team.id,
                away_team.id,
                row.match_date.date().isoformat(),
            )
            if match is None:
                unresolved_rows.append(
                    {
                        "external_id": row.external_id,
                        "season": season_name,
                        "matchday": row.matchday_number,
                        "date": row.match_date.date().isoformat(),
                        "home_team": row.home_team_code,
                        "away_team": row.away_team_code,
                        "reason": "Partido no encontrado",
                    }
                )
                continue

            created, updated = upsert_odds(db, match, row)
            if created:
                created_odds += 1
            if updated:
                updated_odds += 1

        if args.apply:
            log("Aplicando cambios a la base...")
            db.commit()
        else:
            log("Dry-run: haciendo rollback de prueba...")
            db.rollback()

        log("ODDS IMPORT SUMMARY")
        log(f"mode={'apply' if args.apply else 'dry-run'}")
        log(f"csv_path={csv_path}")
        log(f"rows={len(rows)}")
        for season_code in sorted(grouped_counts):
            log(f"season={season_code}")
            for matchday_number in sorted(grouped_counts[season_code]):
                log(f"  Jornada {matchday_number}: {grouped_counts[season_code][matchday_number]} odds")
        log(f"created_odds={created_odds}")
        log(f"updated_odds={updated_odds}")
        log(f"unresolved_rows={len(unresolved_rows)}")

        if unresolved_rows:
            log("")
            log("UNRESOLVED")
            for item in unresolved_rows[:20]:
                log(str(item))
            if len(unresolved_rows) > 20:
                log(f"... y {len(unresolved_rows) - 20} mas")

        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
