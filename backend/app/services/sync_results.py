import json
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.datetime import ensure_utc
from app.core.match_keys import build_match_key
from app.core.team_matching import build_team_code_lookup, mexico_city_match_date, resolve_team_code
from app.models.entities import Match, MatchResult, MatchStatus, RawMatchResult, SyncLog, SyncStatus, Team
from app.providers.base import SportsDataProvider


def _sync_match_status_with_result(match: Match, is_official: bool) -> None:
    if is_official:
        match.status = MatchStatus.FINAL
    elif match.status == MatchStatus.FINAL:
        match.status = MatchStatus.SCHEDULED


def sync_results(db: Session, provider: SportsDataProvider, *, matchday_id: str | None = None) -> dict[str, str | int]:
    started_at = datetime.now(UTC)
    sync_log = SyncLog(
        provider_name=provider.name,
        resource_type="results",
        status=SyncStatus.SUCCESS,
        records_processed=0,
        started_at=started_at,
        finished_at=started_at,
    )
    db.add(sync_log)
    db.flush()

    target_dates = _build_target_dates(db, matchday_id)
    fetch_results_for_dates = getattr(provider, "fetch_results_for_dates", None)
    if callable(fetch_results_for_dates) and len(target_dates) > 0:
        records = list(fetch_results_for_dates(target_dates))
        if len(records) == 0:
            records = list(provider.fetch_results())
    else:
        records = list(provider.fetch_results())
    if len(records) == 0 and provider.name == "mock":
        records = _build_demo_results(db)

    matches_stmt = select(Match).order_by(Match.kickoff_at.asc())
    if matchday_id is not None:
        matches_stmt = matches_stmt.where(Match.matchday_id == matchday_id)
    matches = list(db.scalars(matches_stmt))
    results_by_match_id = {
        result.match_id: result for result in db.scalars(select(MatchResult))
    }
    teams_by_id = {team.id: team for team in db.scalars(select(Team))}
    team_code_lookup = build_team_code_lookup(list(teams_by_id.values()))
    actual_team_codes = {team.short_name.upper() for team in teams_by_id.values()}
    matches_by_id = {match.id: match for match in matches}
    matches_by_external_id = {
        match.external_id: match for match in matches if match.external_id
    }
    matches_by_key = {
        _build_db_match_key(match, teams_by_id): match for match in matches
    }
    matches_by_identity = {
        identity_key: match
        for match in matches
        if (identity_key := _build_identity_key(match, teams_by_id)) is not None
    }

    applied_count = 0
    for record in records:
        match = _resolve_match(
            record,
            matches_by_id,
            matches_by_external_id,
            matches_by_key,
            matches_by_identity,
            team_code_lookup,
            actual_team_codes,
        )
        source_updated_at = _coerce_datetime(record.get("source_updated_at"))
        raw_row = RawMatchResult(
            sync_log_id=sync_log.id,
            provider_name=provider.name,
            external_result_id=_coerce_text(record.get("external_id")) or _coerce_text(record.get("id")),
            external_match_id=_coerce_text(record.get("external_match_id")) or _coerce_text(record.get("match_id")),
            match_key=_coerce_text(record.get("match_key")),
            mapped_match_id=match.id if match is not None else None,
            home_score=_coerce_int(record.get("home_score")),
            away_score=_coerce_int(record.get("away_score")),
            result_status=_coerce_text(record.get("status")) or _coerce_text(record.get("result_status")),
            is_official=_coerce_bool(record.get("is_official"), default=True),
            payload_json=json.dumps(record.get("payload", record), ensure_ascii=True, default=str),
            source_updated_at=source_updated_at,
            applied_at=None,
        )
        db.add(raw_row)

        if match is None:
            continue

        home_score = _coerce_int(record.get("home_score"))
        away_score = _coerce_int(record.get("away_score"))
        if home_score is None or away_score is None:
            continue

        result = results_by_match_id.get(match.id)
        if result is None:
            result = MatchResult(match_id=match.id)
            results_by_match_id[match.id] = result
        elif result.is_manual_override:
            continue

        result.home_score = home_score
        result.away_score = away_score
        result.is_official = _coerce_bool(record.get("is_official"), default=True)
        result.source_provider_name = provider.name
        result.source_external_id = _coerce_text(record.get("external_id")) or _coerce_text(record.get("id"))
        result.source_updated_at = source_updated_at
        result.last_synced_at = datetime.now(UTC)
        result.is_manual_override = False
        result.updated_by_profile_id = None
        _sync_match_status_with_result(match, result.is_official)

        db.add(match)
        db.add(result)
        raw_row.applied_at = datetime.now(UTC)
        db.add(raw_row)
        applied_count += 1

    sync_log.records_processed = applied_count
    sync_log.finished_at = datetime.now(UTC)
    db.add(sync_log)
    db.commit()
    return {
        "provider_name": provider.name,
        "resource_type": "results",
        "records_processed": applied_count,
        "status": "success",
    }


def _build_target_dates(db: Session, matchday_id: str | None) -> list[str]:
    if not matchday_id:
        return []
    matches = list(
        db.scalars(
            select(Match)
            .where(Match.matchday_id == matchday_id)
            .order_by(Match.kickoff_at.asc())
        )
    )
    return sorted({mexico_city_match_date(match.kickoff_at) for match in matches})


def _build_db_match_key(match: Match, teams_by_id: dict[str, Team]) -> str:
    home_team = teams_by_id.get(match.home_team_id)
    away_team = teams_by_id.get(match.away_team_id)
    return build_match_key(
        home_team.slug if home_team else None,
        away_team.slug if away_team else None,
        match.kickoff_at,
    )


def _resolve_match(
    record: dict,
    matches_by_id: dict[str, Match],
    matches_by_external_id: dict[str, Match],
    matches_by_key: dict[str, Match],
    matches_by_identity: dict[tuple[str, str, str], Match],
    team_code_lookup: dict[str, str],
    actual_team_codes: set[str],
) -> Match | None:
    match_id = _coerce_text(record.get("match_id"))
    if match_id and match_id in matches_by_id:
        return matches_by_id[match_id]

    external_id = (
        _coerce_text(record.get("external_match_id"))
        or _coerce_text(record.get("external_id"))
        or _coerce_text(record.get("id"))
    )
    if external_id and external_id in matches_by_external_id:
        return matches_by_external_id[external_id]

    match_key = _coerce_text(record.get("match_key"))
    if match_key and match_key in matches_by_key:
        return matches_by_key[match_key]

    identity_key = _build_record_identity_key(record, team_code_lookup, actual_team_codes)
    if identity_key is not None and identity_key in matches_by_identity:
        return matches_by_identity[identity_key]

    return None


def _build_identity_key(match: Match, teams_by_id: dict[str, Team]) -> tuple[str, str, str] | None:
    home_team = teams_by_id.get(match.home_team_id)
    away_team = teams_by_id.get(match.away_team_id)
    if home_team is None or away_team is None:
        return None
    return (
        home_team.short_name.upper(),
        away_team.short_name.upper(),
        mexico_city_match_date(match.kickoff_at),
    )


def _build_record_identity_key(
    record: dict,
    team_code_lookup: dict[str, str],
    actual_team_codes: set[str],
) -> tuple[str, str, str] | None:
    source_match_date = _coerce_text(record.get("source_match_date"))
    kickoff_at = _coerce_datetime(record.get("kickoff_at"))
    home_team_name = _coerce_text(record.get("home_team_name"))
    away_team_name = _coerce_text(record.get("away_team_name"))
    if (source_match_date is None and kickoff_at is None) or home_team_name is None or away_team_name is None:
        return None
    home_code = resolve_team_code(home_team_name, team_code_lookup, actual_team_codes)
    away_code = resolve_team_code(away_team_name, team_code_lookup, actual_team_codes)
    if home_code is None or away_code is None:
        return None
    return (
        home_code,
        away_code,
        mexico_city_match_date(kickoff_at) if kickoff_at is not None else source_match_date,
    )


def _build_demo_results(db: Session) -> list[dict]:
    now = datetime.now(UTC)
    rows = db.execute(
        select(Match, MatchResult)
        .outerjoin(MatchResult, MatchResult.match_id == Match.id)
        .where(Match.kickoff_at <= now)
        .order_by(Match.kickoff_at.asc())
    ).all()

    demo_records: list[dict] = []
    for match, existing_result in rows:
        if existing_result is not None and existing_result.is_official:
            continue

        seed = sum(ord(char) for char in f"{match.home_team_id}{match.away_team_id}{match.id}")
        home_score = seed % 4
        away_score = (seed // 3) % 4
        if home_score == away_score:
            away_score = (away_score + 1) % 4

        demo_records.append(
            {
                "match_id": match.id,
                "home_score": home_score,
                "away_score": away_score,
                "is_official": True,
                "payload": {
                    "mode": "demo",
                    "match_id": match.id,
                    "home_score": home_score,
                    "away_score": away_score,
                },
            }
        )

    return demo_records


def _coerce_text(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _coerce_int(value: object) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return int(value)
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _coerce_bool(value: object, *, default: bool) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    normalized = str(value).strip().lower()
    if normalized in {"1", "true", "yes", "y", "si"}:
        return True
    if normalized in {"0", "false", "no", "n"}:
        return False
    return default


def _coerce_datetime(value: object) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return ensure_utc(value)
    text = str(value).strip()
    if not text:
        return None
    try:
        return ensure_utc(datetime.fromisoformat(text.replace("Z", "+00:00")))
    except ValueError:
        return None
