from __future__ import annotations

import argparse
import csv
from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime, time, timedelta
from pathlib import Path
from typing import Any

from sqlalchemy import and_, select

from app.core.database import SessionLocal
from app.core.datetime import MEXICO_CITY_TZ
from app.core.team_matching import build_team_code_lookup, mexico_city_match_date, resolve_team_code
from app.models.entities import Match, MatchResult, MatchStatus, Matchday, MatchdayStatus, Season, Team

IMPORT_PROVIDER = "csv_history"


@dataclass
class HistoryRow:
    external_id: str
    season_code: str
    matchday_number: int
    match_date: datetime
    home_team_code: str
    away_team_code: str
    home_score: int
    away_score: int


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
    parser = argparse.ArgumentParser(description="Importa historial de partidos y resultados desde CSV.")
    parser.add_argument("csv_path", help="Ruta al archivo CSV.")
    parser.add_argument("--apply", action="store_true", help="Escribe cambios en la base. Sin esto solo hace dry-run.")
    return parser.parse_args()


def parse_csv(path: Path) -> list[HistoryRow]:
    rows: list[HistoryRow] = []
    with path.open("r", encoding="utf-8-sig", newline="") as file:
        reader = csv.DictReader(file)
        for raw in reader:
            season_code = (raw.get("Season") or "").strip()
            matchday_raw = (raw.get("MatchDay") or "").strip()
            match_date_raw = (raw.get("Date") or "").strip()
            home_team_raw = (raw.get("Home Team") or "").strip().upper()
            away_team_raw = (raw.get("Away Team") or "").strip().upper()
            home_score_raw = (raw.get("Home Score") or "").strip()
            away_score_raw = (raw.get("Away Score") or "").strip()
            if not season_code or not matchday_raw or not match_date_raw or not home_team_raw or not away_team_raw:
                continue
            if home_score_raw == "" or away_score_raw == "":
                continue
            external_id = (raw.get("Event ID") or "").strip() or synthetic_external_id(
                season_code,
                int(matchday_raw),
                match_date_raw,
                home_team_raw,
                away_team_raw,
            )
            rows.append(
                HistoryRow(
                    external_id=external_id,
                    season_code=season_code,
                    matchday_number=int(matchday_raw),
                    match_date=datetime.strptime(match_date_raw, "%m/%d/%y"),
                    home_team_code=home_team_raw,
                    away_team_code=away_team_raw,
                    home_score=int(home_score_raw),
                    away_score=int(away_score_raw),
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


def match_kickoff(match_date: datetime, offset_minutes: int = 0) -> datetime:
    local_dt = datetime.combine(match_date.date(), time(12, 0), tzinfo=MEXICO_CITY_TZ) + timedelta(minutes=offset_minutes)
    return local_dt.astimezone(UTC)


def find_or_create_season(db, season_code: str) -> tuple[Season, bool]:
    name, slug = season_name_and_slug(season_code)
    season = db.scalar(select(Season).where(Season.slug == slug))
    created = False
    if season is None:
        season = Season(name=name, slug=slug, is_active=False)
        db.add(season)
        db.flush()
        created = True
    return season, created


def find_or_create_matchday(
    db,
    season: Season,
    matchday_number: int,
    rows: list[HistoryRow],
) -> tuple[Matchday, bool]:
    matchday = db.scalar(
        select(Matchday).where(
            Matchday.season_id == season.id,
            Matchday.number == matchday_number,
        )
    )
    created = False
    first_date = min(row.match_date for row in rows).date()
    last_date = max(row.match_date for row in rows).date()
    starts_at = datetime.combine(first_date, time(0, 0), tzinfo=MEXICO_CITY_TZ).astimezone(UTC)
    ends_at = datetime.combine(last_date, time(23, 59), tzinfo=MEXICO_CITY_TZ).astimezone(UTC)

    if matchday is None:
        matchday = Matchday(
            season_id=season.id,
            number=matchday_number,
            name=f"Jornada {matchday_number}",
            default_lock_offset_minutes=10,
            status=MatchdayStatus.PUBLISHED,
            starts_at=starts_at,
            ends_at=ends_at,
        )
        db.add(matchday)
        db.flush()
        created = True
    else:
        matchday.name = matchday.name or f"Jornada {matchday_number}"
        matchday.status = MatchdayStatus.PUBLISHED
        matchday.starts_at = min(matchday.starts_at, starts_at)
        matchday.ends_at = max(matchday.ends_at, ends_at)
        db.add(matchday)
        db.flush()

    return matchday, created


def load_team_maps(db) -> tuple[dict[str, Team], dict[str, str], set[str]]:
    teams = list(db.scalars(select(Team).order_by(Team.name.asc())))
    by_code = {team.short_name.upper(): team for team in teams}
    lookup = build_team_code_lookup(teams)
    codes = set(by_code.keys())
    return by_code, lookup, codes


def find_existing_match(
    db,
    matchday_id: str,
    external_id: str,
    home_team_id: str,
    away_team_id: str,
    match_date_iso: str,
) -> Match | None:
    match = db.scalar(select(Match).where(Match.external_id == external_id))
    if match is not None:
        return match

    candidates = list(
        db.scalars(
            select(Match).where(
                Match.matchday_id == matchday_id,
                Match.home_team_id == home_team_id,
                Match.away_team_id == away_team_id,
            )
        )
    )
    for candidate in candidates:
        if mexico_city_match_date(candidate.kickoff_at) == match_date_iso:
            return candidate
    return None


def main() -> int:
    args = parse_args()
    csv_path = Path(args.csv_path).expanduser()
    if not csv_path.exists():
        log(f"CSV no encontrado: {csv_path}")
        return 1

    log(f"Leyendo CSV: {csv_path}")
    rows = parse_csv(csv_path)
    if not rows:
        log("No se encontraron filas validas en el CSV.")
        return 1
    log(f"Filas detectadas: {len(rows)}")

    log("Abriendo sesion con la base...")
    db = SessionLocal()
    try:
        log("Cargando catalogo de equipos...")
        teams_by_code, team_lookup, actual_codes = load_team_maps(db)
        log(f"Equipos disponibles: {len(teams_by_code)}")
        grouped_rows: dict[str, dict[int, list[HistoryRow]]] = defaultdict(lambda: defaultdict(list))
        for row in rows:
            grouped_rows[row.season_code][row.matchday_number].append(row)
        log(f"Temporadas detectadas en CSV: {len(grouped_rows)}")

        created_seasons = 0
        created_matchdays = 0
        created_matches = 0
        updated_matches = 0
        created_results = 0
        updated_results = 0
        skipped_manual_results = 0
        unresolved_rows: list[dict[str, Any]] = []

        for season_code, by_matchday in grouped_rows.items():
            log(f"Procesando temporada {season_code}...")
            season, created = find_or_create_season(db, season_code)
            if created:
                created_seasons += 1

            season_matchdays: list[Matchday] = []
            for matchday_number in sorted(by_matchday):
                log(f"  Jornada {matchday_number}: {len(by_matchday[matchday_number])} partidos")
                matchday_rows = by_matchday[matchday_number]
                matchday, matchday_created = find_or_create_matchday(db, season, matchday_number, matchday_rows)
                if matchday_created:
                    created_matchdays += 1
                season_matchdays.append(matchday)

                day_offsets: dict[str, int] = defaultdict(int)
                for row in sorted(matchday_rows, key=lambda item: (item.match_date, item.home_team_code, item.away_team_code)):
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

                    match_date_iso = row.match_date.date().isoformat()
                    match = find_existing_match(
                        db,
                        matchday.id,
                        row.external_id,
                        home_team.id,
                        away_team.id,
                        match_date_iso,
                    )

                    if match is None:
                        offset_key = match_date_iso
                        kickoff_at = match_kickoff(row.match_date, day_offsets[offset_key] * 5)
                        day_offsets[offset_key] += 1
                        match = Match(
                            matchday_id=matchday.id,
                            external_id=row.external_id,
                            home_team_id=home_team.id,
                            away_team_id=away_team.id,
                            kickoff_at=kickoff_at,
                            picks_lock_at=kickoff_at - timedelta(minutes=10),
                            venue=None,
                            status=MatchStatus.FINAL,
                        )
                        db.add(match)
                        db.flush()
                        created_matches += 1
                    else:
                        match.external_id = match.external_id or row.external_id
                        match.status = MatchStatus.FINAL
                        db.add(match)
                        db.flush()
                        updated_matches += 1

                    result = db.scalar(select(MatchResult).where(MatchResult.match_id == match.id))
                    if result is None:
                        result = MatchResult(
                            match_id=match.id,
                            home_score=row.home_score,
                            away_score=row.away_score,
                            is_official=True,
                            source_provider_name=IMPORT_PROVIDER,
                            source_external_id=row.external_id,
                            source_updated_at=match.kickoff_at,
                            last_synced_at=datetime.now(UTC),
                            is_manual_override=False,
                        )
                        db.add(result)
                        created_results += 1
                    else:
                        if result.is_manual_override:
                            skipped_manual_results += 1
                            continue
                        result.home_score = row.home_score
                        result.away_score = row.away_score
                        result.is_official = True
                        result.source_provider_name = IMPORT_PROVIDER
                        result.source_external_id = row.external_id
                        result.source_updated_at = match.kickoff_at
                        result.last_synced_at = datetime.now(UTC)
                        db.add(result)
                        updated_results += 1

            if args.apply and season_matchdays:
                ordered_matchdays = sorted(season_matchdays, key=lambda item: item.number)
                if season.start_matchday_id is None:
                    season.start_matchday_id = ordered_matchdays[0].id
                if season.end_matchday_id is None:
                    season.end_matchday_id = ordered_matchdays[-1].id
                db.add(season)

        if args.apply:
            log("Aplicando cambios a la base...")
            db.commit()
        else:
            log("Dry-run: haciendo rollback de prueba...")
            db.rollback()

        log("IMPORT SUMMARY")
        log(f"mode={'apply' if args.apply else 'dry-run'}")
        log(f"csv_path={csv_path}")
        log(f"rows={len(rows)}")
        log(f"created_seasons={created_seasons}")
        log(f"created_matchdays={created_matchdays}")
        log(f"created_matches={created_matches}")
        log(f"updated_matches={updated_matches}")
        log(f"created_results={created_results}")
        log(f"updated_results={updated_results}")
        log(f"skipped_manual_results={skipped_manual_results}")
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
