from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, date, datetime

import httpx

from app.core.config import Settings
from app.core.match_keys import build_match_key
from app.core.team_matching import mexico_city_match_date


class TheOddsScoresProvider:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.name = "the_odds_api_scores"

    def fetch_matches(self) -> Sequence[dict]:
        return []

    def fetch_odds(self) -> Sequence[dict]:
        return []

    def fetch_results(self) -> Sequence[dict]:
        days_from = max(1, min(self.settings.the_odds_api_results_days_from, 3))
        return self._fetch_scores(days_from)

    def fetch_results_for_dates(self, dates: Sequence[str]) -> Sequence[dict]:
        parsed_dates = sorted({_parse_date(value) for value in dates if _parse_date(value) is not None})
        if len(parsed_dates) == 0:
            return self.fetch_results()

        today = datetime.now(UTC).date()
        oldest = parsed_dates[0]
        delta_days = (today - oldest).days
        if delta_days < 0:
            days_from = 1
        else:
            days_from = max(1, min(delta_days + 1, 3))
        return self._fetch_scores(days_from)

    def _fetch_scores(self, days_from: int) -> Sequence[dict]:
        payload = self._request_json(
            f"/sports/{self.settings.the_odds_api_sport}/scores/",
            {
                "apiKey": self.settings.the_odds_api_key.strip(),
                "daysFrom": max(1, min(days_from, 3)),
                "dateFormat": "iso",
            },
        )
        return [_normalize_score_event(event) for event in payload if _is_completed_event(event)]

    def _request_json(self, path: str, params: dict[str, object]) -> list[dict]:
        with httpx.Client(
            base_url=self.settings.the_odds_api_base_url.rstrip("/"),
            timeout=self.settings.the_odds_api_timeout_seconds,
        ) as client:
            response = client.get(path, params=params, headers={"Accept": "application/json"})
            response.raise_for_status()
            payload = response.json()

        if not isinstance(payload, list):
            raise RuntimeError("The Odds API devolvio una respuesta inesperada para scores.")
        return [event for event in payload if isinstance(event, dict)]


def _normalize_score_event(event: dict) -> dict:
    kickoff_at = _parse_datetime(event.get("commence_time"))
    home_team_name = _coerce_text(event.get("home_team"))
    away_team_name = _coerce_text(event.get("away_team"))
    home_score, away_score = _extract_scores(event.get("scores"), home_team_name, away_team_name)

    match_key = None
    if kickoff_at is not None and home_team_name and away_team_name:
        match_key = build_match_key(_slugish(home_team_name), _slugish(away_team_name), kickoff_at)

    return {
        "external_id": _coerce_text(event.get("id")),
        "external_match_id": _coerce_text(event.get("id")),
        "match_key": match_key,
        "home_team_name": home_team_name,
        "away_team_name": away_team_name,
        "source_match_date": mexico_city_match_date(kickoff_at) if kickoff_at is not None else None,
        "kickoff_at": kickoff_at.isoformat().replace("+00:00", "Z") if kickoff_at is not None else None,
        "home_score": home_score,
        "away_score": away_score,
        "status": "completed" if bool(event.get("completed")) else "scheduled",
        "is_official": bool(event.get("completed")) and home_score is not None and away_score is not None,
        "source_updated_at": _parse_datetime(event.get("last_update")).isoformat().replace("+00:00", "Z")
        if _parse_datetime(event.get("last_update")) is not None
        else (kickoff_at.isoformat().replace("+00:00", "Z") if kickoff_at is not None else None),
        "payload": event,
    }


def _is_completed_event(event: dict) -> bool:
    return bool(event.get("completed"))


def _extract_scores(
    scores: object,
    home_team_name: str | None,
    away_team_name: str | None,
) -> tuple[int | None, int | None]:
    if not isinstance(scores, list):
        return None, None

    score_by_name = {
        _normalize_name(_coerce_text(item.get("name"))): _coerce_int(item.get("score"))
        for item in scores
        if isinstance(item, dict)
    }
    home_score = score_by_name.get(_normalize_name(home_team_name))
    away_score = score_by_name.get(_normalize_name(away_team_name))

    if home_score is not None or away_score is not None:
        return home_score, away_score

    ordered_scores = [
        _coerce_int(item.get("score"))
        for item in scores
        if isinstance(item, dict)
    ]
    if len(ordered_scores) >= 2:
        return ordered_scores[0], ordered_scores[1]
    return None, None


def _normalize_name(value: str | None) -> str | None:
    return _slugish(value)


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
    return value.strip().lower().replace(".", "").replace(" ", "-").replace("á", "a").replace("é", "e").replace("í", "i").replace("ó", "o").replace("ú", "u")
