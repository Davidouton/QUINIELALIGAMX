from datetime import UTC, datetime
from zoneinfo import ZoneInfo

MEXICO_CITY_TZ = ZoneInfo("America/Mexico_City")


def ensure_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def mexico_city_to_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=MEXICO_CITY_TZ).astimezone(UTC)
    return dt.astimezone(UTC)
