from datetime import datetime


def build_match_key(home_slug: str | None, away_slug: str | None, kickoff_at: datetime) -> str:
    home = (home_slug or "home").strip().lower().replace(" ", "-")
    away = (away_slug or "away").strip().lower().replace(" ", "-")
    return f"{home}_{away}_{kickoff_at.date().isoformat()}"
