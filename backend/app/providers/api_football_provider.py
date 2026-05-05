from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, date, datetime, timedelta

import httpx

from app.core.config import Settings
from app.core.match_keys import build_match_key
from app.core.team_matching import mexico_city_match_date


class ApiFootballProvider:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.name = "api_football_v3"

    def fetch_matches(self) -> Sequence[dict]:
        return []

    def fetch_odds(self) -> Sequence[dict]:
        return []

    def fetch_results(self) -> Sequence[dict]:
        today = datetime.now(UTC).date()
        start_date = today - timedelta(days=max(self.settings.api_football_results_lookback_days, 1))
        end_date = today + timedelta(days=1)
        return self._fetch_results_between(start_date, end_date)

    def fetch_results_for_dates(self, dates: Sequence[str]) -> Sequence[dict]:
        parsed_dates = sorted({_parse_date(value) for value in dates if _parse_date(value) is not None})
        if len(parsed_dates) == 0:
            return self.fetch_results()
        return self._fetch_results_between(parsed_dates[0], parsed_dates[-1])

    def _fetch_results_between(self, start_date: date, end_date: date) -> Sequence[dict]:
        normalized_records: list[dict] = []
        seen_fixture_ids: set[str] = set()
        for season in self._candidate_seasons(start_date, end_date):
            fixtures = self._fetch_fixtures_for_season(season, start_date, end_date)
            for fixture in fixtures:
                record = _normalize_fixture(fixture)
                fixture_id = _coerce_text(record.get("external_id"))
                if fixture_id and fixture_id in seen_fixture_ids:
                    continue
                if fixture_id:
                    seen_fixture_ids.add(fixture_id)
                normalized_records.append(record)
            if len(normalized_records) > 0:
                break
        return normalized_records

    def _candidate_seasons(self, start_date: date, end_date: date) -> list[int]:
        if self.settings.api_football_season is not None:
            return [self.settings.api_football_season]

        candidates: list[int] = []
        for candidate in (end_date.year, end_date.year - 1, start_date.year, start_date.year - 1):
            if candidate not in candidates:
                candidates.append(candidate)
        return candidates

    def _fetch_fixtures_for_season(self, season: int, start_date: date, end_date: date) -> list[dict]:
        payload = self._request_json(
            "/fixtures",
            {
                "league": self.settings.api_football_league_id.strip(),
                "season": season,
                "from": start_date.isoformat(),
                "to": end_date.isoformat(),
                "timezone": self.settings.api_football_timezone,
                "status": self.settings.api_football_results_statuses,
            },
        )
        return _unwrap_response(payload)

    def _request_json(self, path: str, params: dict[str, object]) -> dict:
        headers = {
            "Accept": "application/json",
            self.settings.api_football_header_name.strip(): self.settings.api_football_key.strip(),
        }
        host_header = self.settings.api_football_host_header.strip()
        if host_header:
            headers["x-rapidapi-host"] = host_header

        with httpx.Client(
            base_url=self.settings.api_football_base_url.rstrip("/"),
            timeout=self.settings.api_football_timeout_seconds,
        ) as client:
            response = client.get(path, params=params, headers=headers)
            response.raise_for_status()
            payload = response.json()

        error_message = _extract_error_message(payload)
        if error_message is not None:
            lowered = error_message.lower()
            if "missing application key" in lowered or "invalid key" in lowered or "token" in lowered:
                raise RuntimeError("API-Football rechazo la API key configurada.")
            raise RuntimeError(f"API-Football devolvio un error: {error_message}")

        return payload if isinstance(payload, dict) else {}


def _unwrap_response(payload: object) -> list[dict]:
    if not isinstance(payload, dict):
        return []
    response = payload.get("response")
    if not isinstance(response, list):
        return []
    return [fixture for fixture in response if isinstance(fixture, dict)]


def _normalize_fixture(fixture: dict) -> dict:
    fixture_data = fixture.get("fixture") if isinstance(fixture.get("fixture"), dict) else {}
    teams = fixture.get("teams") if isinstance(fixture.get("teams"), dict) else {}
    goals = fixture.get("goals") if isinstance(fixture.get("goals"), dict) else {}
    score = fixture.get("score") if isinstance(fixture.get("score"), dict) else {}
    status = fixture_data.get("status") if isinstance(fixture_data.get("status"), dict) else {}

    kickoff_at = _parse_datetime(fixture_data.get("date"))
    home_team_name = _coerce_text((teams.get("home") or {}).get("name") if isinstance(teams.get("home"), dict) else None)
    away_team_name = _coerce_text((teams.get("away") or {}).get("name") if isinstance(teams.get("away"), dict) else None)
    status_short = _coerce_text(status.get("short"))
    status_long = _coerce_text(status.get("long"))
    home_score, away_score = _select_scores(status_short, goals, score)

    match_key = None
    if kickoff_at is not None and home_team_name and away_team_name:
        match_key = build_match_key(_slugish(home_team_name), _slugish(away_team_name), kickoff_at)

    return {
        "external_id": _coerce_text(fixture_data.get("id")),
        "external_match_id": _coerce_text(fixture_data.get("id")),
        "match_key": match_key,
        "home_team_name": home_team_name,
        "away_team_name": away_team_name,
        "source_match_date": mexico_city_match_date(kickoff_at) if kickoff_at is not None else None,
        "kickoff_at": kickoff_at.isoformat().replace("+00:00", "Z") if kickoff_at is not None else None,
        "home_score": home_score,
        "away_score": away_score,
        "status": status_short or status_long,
        "is_official": _is_finished_status(status_short) and home_score is not None and away_score is not None,
        "source_updated_at": kickoff_at.isoformat().replace("+00:00", "Z") if kickoff_at is not None else None,
        "payload": fixture,
    }


def _select_scores(status_short: str | None, goals: dict, score: dict) -> tuple[int | None, int | None]:
    if status_short == "AET":
        extra_time = score.get("extratime") if isinstance(score.get("extratime"), dict) else {}
        return _coerce_int(extra_time.get("home")), _coerce_int(extra_time.get("away"))

    if status_short == "PEN":
        extra_time = score.get("extratime") if isinstance(score.get("extratime"), dict) else {}
        full_time = score.get("fulltime") if isinstance(score.get("fulltime"), dict) else {}
        home_score = _coerce_int(extra_time.get("home"))
        away_score = _coerce_int(extra_time.get("away"))
        if home_score is not None and away_score is not None:
            return home_score, away_score
        return _coerce_int(full_time.get("home")), _coerce_int(full_time.get("away"))

    full_time = score.get("fulltime") if isinstance(score.get("fulltime"), dict) else {}
    home_score = _coerce_int(full_time.get("home"))
    away_score = _coerce_int(full_time.get("away"))
    if home_score is not None and away_score is not None:
        return home_score, away_score
    return _coerce_int(goals.get("home")), _coerce_int(goals.get("away"))


def _extract_error_message(payload: object) -> str | None:
    if not isinstance(payload, dict):
        return None
    errors = payload.get("errors")
    if errors in (None, {}, []):
        return None
    if isinstance(errors, str):
        text = errors.strip()
        return text or None
    if isinstance(errors, list):
        parts = [str(item).strip() for item in errors if str(item).strip()]
        return " | ".join(parts) or None
    if isinstance(errors, dict):
        parts = [str(value).strip() for value in errors.values() if str(value).strip()]
        return " | ".join(parts) or None
    return str(errors).strip() or None


def _is_finished_status(status_short: str | None) -> bool:
    return (status_short or "").upper() in {"FT", "AET", "PEN"}


def _parse_date(value: str | None) -> date | None:
    if value is None:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def _parse_datetime(value: object) -> datetime | None:
    text = _coerce_text(value)
    if text is None:
        return None
    normalized = text.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def _coerce_text(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _coerce_int(value: object) -> int | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _slugish(value: str | None) -> str | None:
    if value is None:
        return None
    return value.strip().lower().replace(".", "").replace(" ", "-")
