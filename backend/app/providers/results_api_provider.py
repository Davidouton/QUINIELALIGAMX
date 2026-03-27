from collections.abc import Sequence
from datetime import UTC, datetime

import httpx

from app.core.config import Settings
from app.core.match_keys import build_match_key


class ResultsApiProvider:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.name = settings.results_provider_name

    def fetch_matches(self) -> Sequence[dict]:
        return []

    def fetch_odds(self) -> Sequence[dict]:
        return []

    def fetch_results(self) -> Sequence[dict]:
        return self.fetch_results_for_dates([])

    def fetch_results_for_dates(self, dates: Sequence[str]) -> Sequence[dict]:
        if len(dates) == 0:
            url = self._build_results_url()
            with httpx.Client(timeout=self.settings.results_provider_timeout_seconds) as client:
                response = client.get(url)
                response.raise_for_status()
                payload = response.json()
            events = _unwrap_events(payload)
            return [_normalize_event(event) for event in events]

        events: list[dict] = []
        with httpx.Client(timeout=self.settings.results_provider_timeout_seconds) as client:
            for date in dates:
                response = client.get(self._build_eventsday_url(date))
                response.raise_for_status()
                payload = response.json()
                events.extend(_unwrap_events(payload))
        return [_normalize_event(event) for event in events]

    def _build_results_url(self) -> str:
        base_url = self.settings.results_provider_base_url.rstrip("/")
        api_key = self.settings.results_provider_api_key.strip()
        league_id = self.settings.results_provider_league_id.strip()
        season = self.settings.results_provider_season.strip() if self.settings.results_provider_season else None

        if season:
            return (
                f"{base_url}/api/v1/json/{api_key}/eventsseason.php"
                f"?id={league_id}&s={season}"
            )

        return f"{base_url}/api/v1/json/{api_key}/eventspastleague.php?id={league_id}"

    def _build_eventsday_url(self, date: str) -> str:
        base_url = self.settings.results_provider_base_url.rstrip("/")
        api_key = self.settings.results_provider_api_key.strip()
        return (
            f"{base_url}/api/v1/json/{api_key}/eventsday.php"
            f"?d={date}&l=Mexican%20Primera%20League"
        )


def _unwrap_events(payload: object) -> list[dict]:
    if not isinstance(payload, dict):
        return []
    events = payload.get("events")
    if not isinstance(events, list):
        return []
    return [event for event in events if isinstance(event, dict)]


def _normalize_event(event: dict) -> dict:
    kickoff_at = _build_kickoff_at(event.get("dateEvent"), event.get("strTime"))
    home_team_name = _coerce_text(event.get("strHomeTeam"))
    away_team_name = _coerce_text(event.get("strAwayTeam"))
    home_key = _slugish(home_team_name)
    away_key = _slugish(away_team_name)
    match_key = None
    if kickoff_at is not None and home_key and away_key:
        match_key = build_match_key(home_key, away_key, kickoff_at)

    return {
        "external_id": _coerce_text(event.get("idEvent")),
        "external_match_id": _coerce_text(event.get("idEvent")),
        "match_key": match_key,
        "home_team_name": home_team_name,
        "away_team_name": away_team_name,
        "source_match_date": _coerce_text(event.get("dateEvent")),
        "kickoff_at": kickoff_at.isoformat().replace("+00:00", "Z") if kickoff_at is not None else None,
        "home_score": _coerce_int(event.get("intHomeScore")),
        "away_score": _coerce_int(event.get("intAwayScore")),
        "status": _coerce_text(event.get("strStatus")),
        "is_official": _is_finished_event(event),
        "source_updated_at": _build_kickoff_at(event.get("dateEvent"), event.get("strTime")),
        "payload": event,
    }


def _is_finished_event(event: dict) -> bool:
    status = (_coerce_text(event.get("strStatus")) or "").lower()
    if status in {"match finished", "finished", "ft", "after penalties", "aet"}:
        return True
    return _coerce_int(event.get("intHomeScore")) is not None and _coerce_int(event.get("intAwayScore")) is not None


def _build_kickoff_at(date_value: object, time_value: object) -> datetime | None:
    date_text = _coerce_text(date_value)
    if date_text is None:
        return None

    time_text = _coerce_text(time_value) or "00:00:00"
    normalized_time = time_text
    if len(normalized_time) == 5:
        normalized_time = f"{normalized_time}:00"
    if normalized_time.endswith("Z"):
        normalized_time = normalized_time.replace("Z", "+00:00")
    if "+" not in normalized_time and "-" not in normalized_time[1:]:
        normalized_time = f"{normalized_time}+00:00"

    try:
        parsed = datetime.fromisoformat(f"{date_text}T{normalized_time}")
    except ValueError:
        return None

    return parsed.astimezone(UTC) if parsed.tzinfo is not None else parsed.replace(tzinfo=UTC)


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
