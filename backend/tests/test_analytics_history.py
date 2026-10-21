"""Admin event history: stable pagination and complete, bounded aggregates."""

from collections.abc import Generator
from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest
from conftest import PROFILE_LEADER_ID, PROFILE_USER_ID, SessionLocal
from fastapi.testclient import TestClient

from app.api.deps import get_current_profile
from app.main import app
from app.models.entities import AnalyticsEvent, Profile, RoleCode

PATH = "/api/v1/admin/stats"
HEADERS = {"Authorization": "Bearer test-token"}


@pytest.fixture
def analytics_admin_client() -> Generator[TestClient, None, None]:
    def override_current_profile() -> Profile:
        with SessionLocal() as db:
            profile = db.get(Profile, PROFILE_USER_ID)
            assert profile is not None
            profile.role_code = RoleCode.ADMIN
            return profile

    app.dependency_overrides[get_current_profile] = override_current_profile
    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        app.dependency_overrides.clear()


def event(number: int, created_at: datetime, **overrides) -> AnalyticsEvent:
    values = dict(
        id=str(UUID(int=number)),
        profile_id=PROFILE_USER_ID,
        category="screen",
        event_name="screen_viewed",
        screen_name="Picks",
        route_path="/dashboard/picks",
        created_at=created_at,
        success=True,
    )
    return AnalyticsEvent(**(values | overrides))


def insert(*events: AnalyticsEvent) -> None:
    with SessionLocal() as db:
        db.add_all(events)
        db.commit()


def read_stats(client: TestClient, **params) -> dict:
    response = client.get(PATH, params=params, headers=HEADERS)
    assert response.status_code == 200, response.text
    return response.json()


def parse_time(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    assert parsed.tzinfo is not None
    assert parsed.utcoffset() == timedelta(0)
    return parsed


def test_all_123_events_are_pageable_without_duplicates_at_equal_timestamps(
    analytics_admin_client: TestClient,
) -> None:
    start = datetime(2024, 1, 1, tzinfo=UTC)
    rows = [event(i, start + timedelta(hours=12, seconds=i % 3)) for i in range(1, 124)]
    rows[0].category = "action"
    rows[0].event_name = "pick_saved"
    rows[1].success = False
    expected = [
        row.id for row in sorted(rows, key=lambda row: (row.created_at, row.id), reverse=True)
    ]
    insert(*rows)
    query = {"start_at": start.isoformat(), "end_at": (start + timedelta(days=1)).isoformat()}

    first = read_stats(analytics_admin_client, **query)
    assert first["events_page"] == 1
    assert first["events_page_size"] == 50
    assert first["events_total"] == 123
    assert first["events_total_pages"] == 3
    assert len(first["recent_events"]) == 50
    assert first["kpis"]["total_events"] == 123
    assert first["kpis"]["screen_views"] == 122
    assert first["kpis"]["action_events"] == 1
    assert first["kpis"]["failure_events"] == 1
    assert first["kpis"]["unique_users"] == 1
    assert sum(row["count"] for row in first["top_events"]) == 123

    pages = [first]
    for number in [2, 3]:
        payload = read_stats(analytics_admin_client, **query, page=number)
        assert payload["events_page"] == number
        assert payload["events_total"] == 123
        assert payload["events_total_pages"] == 3
        assert payload["kpis"] == first["kpis"]
        assert payload["users"] == first["users"]
        assert payload["daily"] == first["daily"]
        pages.append(payload)
    actual = [row["id"] for page in pages for row in page["recent_events"]]
    assert actual == expected
    assert len(set(actual)) == 123
    assert len(pages[-1]["recent_events"]) == 23

    exceeded = read_stats(analytics_admin_client, **query, page=999)
    assert exceeded["events_page"] == 3
    assert exceeded["recent_events"] == pages[-1]["recent_events"]
    assert exceeded["kpis"] == first["kpis"]


def test_profile_filter_applies_to_old_custom_range_and_all_aggregates(
    analytics_admin_client: TestClient,
) -> None:
    insert(
        event(1, datetime(2023, 1, 2, tzinfo=UTC)),
        event(2, datetime(2023, 7, 1, tzinfo=UTC), category="action", event_name="pick_saved"),
        event(3, datetime(2023, 8, 1, tzinfo=UTC), profile_id=PROFILE_LEADER_ID),
        event(4, datetime(2022, 12, 31, tzinfo=UTC)),
        event(5, datetime(2024, 1, 1, tzinfo=UTC)),
    )
    payload = read_stats(
        analytics_admin_client,
        start_at="2023-01-01T00:00:00Z",
        end_at="2024-01-01T00:00:00Z",
        profile_id=PROFILE_USER_ID,
        page_size=1,
    )
    assert payload["window_days"] == 365
    assert parse_time(payload["window_start"]) == datetime(2023, 1, 1, tzinfo=UTC)
    assert parse_time(payload["window_end"]) == datetime(2024, 1, 1, tzinfo=UTC)
    assert payload["selected_profile_id"] == PROFILE_USER_ID
    assert payload["selected_profile_display_name"] == "Usuario Demo"
    assert payload["events_total"] == payload["kpis"]["total_events"] == 2
    assert payload["events_total_pages"] == 2
    assert payload["events_page_size"] == 1
    assert len(payload["recent_events"]) == 1
    assert payload["recent_events"][0]["id"] == str(UUID(int=2))
    assert payload["kpis"]["unique_users"] == 1
    assert payload["kpis"]["screen_views"] == 1
    assert payload["kpis"]["action_events"] == 1
    assert {row["profile_id"] for row in payload["users"]} == {PROFILE_USER_ID}
    assert sum(row["count"] for row in payload["top_events"]) == 2
    assert len(payload["daily"]) == 2


@pytest.mark.parametrize(
    "start_at,end_at",
    [
        ("2025-01-01T00:00:00", "2025-01-02T00:00:00"),
        ("2025-01-01T00:00:00-06:00", "2025-01-02T00:00:00-06:00"),
        ("2025-01-01T06:00:00Z", "2025-01-02T06:00:00Z"),
    ],
)
def test_timezone_normalization_includes_start_and_excludes_end(
    analytics_admin_client: TestClient,
    start_at: str,
    end_at: str,
) -> None:
    start = datetime(2025, 1, 1, 6, tzinfo=UTC)
    end = start + timedelta(days=1)
    insert(
        event(1, start - timedelta(seconds=1)),
        event(2, start),
        event(3, end - timedelta(seconds=1)),
        event(4, end),
    )
    payload = read_stats(analytics_admin_client, start_at=start_at, end_at=end_at)
    assert parse_time(payload["window_start"]) == start
    assert parse_time(payload["window_end"]) == end
    assert payload["events_total"] == payload["kpis"]["total_events"] == 2
    assert [row["id"] for row in payload["recent_events"]] == [str(UUID(int=3)), str(UUID(int=2))]


@pytest.mark.parametrize("year,utc_midnight_hour", [(2025, 6), (2021, 5)])
def test_daily_chart_uses_cdmx_midnight_including_historical_daylight_saving(
    analytics_admin_client: TestClient,
    year: int,
    utc_midnight_hour: int,
) -> None:
    midnight = datetime(year, 7, 2, utc_midnight_hour, tzinfo=UTC)
    insert(
        event(1, midnight - timedelta(minutes=30)),  # July 1, 23:30 in CDMX.
        event(2, midnight),  # July 2, 00:00 in CDMX, same UTC date as event 1.
    )
    payload = read_stats(
        analytics_admin_client,
        start_at=f"{year}-07-01T00:00:00",
        end_at=f"{year}-07-03T00:00:00",
    )
    assert parse_time(payload["window_start"]) == datetime(
        year, 7, 1, utc_midnight_hour, tzinfo=UTC
    )
    assert [(row["day"], row["screen_views"]) for row in payload["daily"]] == [
        (f"{year}-07-01", 1),
        (f"{year}-07-02", 1),
    ]
    first_day = read_stats(
        analytics_admin_client,
        start_at=f"{year}-07-01T00:00:00",
        end_at=f"{year}-07-02T00:00:00",
    )
    assert first_day["events_total"] == 1
    assert first_day["recent_events"][0]["id"] == str(UUID(int=1))
    assert first_day["daily"][0]["day"] == f"{year}-07-01"


def test_empty_history_returns_page_one_and_zero_total_pages(
    analytics_admin_client: TestClient,
) -> None:
    payload = read_stats(
        analytics_admin_client,
        start_at="2020-01-01T00:00:00Z",
        end_at="2021-01-01T00:00:00Z",
        page=999,
        page_size=200,
    )
    assert payload["events_page"] == 1
    assert payload["events_page_size"] == 200
    assert payload["events_total_pages"] == 0
    assert payload["events_total"] == payload["kpis"]["total_events"] == 0
    assert payload["recent_events"] == []
    assert payload["users"] == payload["daily"] == payload["screens"] == payload["top_events"] == []


def test_default_legacy_window_is_seven_days_with_a_frozen_utc_end(
    analytics_admin_client: TestClient,
) -> None:
    now = datetime.now(UTC)
    insert(
        event(1, now - timedelta(days=2)),
        event(2, now - timedelta(days=8)),
        event(3, now + timedelta(days=2)),
    )
    payload = read_stats(analytics_admin_client)
    after = datetime.now(UTC)
    start = parse_time(payload["window_start"])
    end = parse_time(payload["window_end"])
    assert now <= end <= after
    assert end - start == timedelta(days=7)
    assert payload["window_days"] == 7
    assert payload["events_total"] == 1
    assert payload["recent_events"][0]["id"] == str(UUID(int=1))


@pytest.mark.parametrize(
    "params",
    [
        {"start_at": "2025-01-01T00:00:00Z"},
        {"end_at": "2025-01-02T00:00:00Z"},
        {"start_at": "2025-01-02T00:00:00Z", "end_at": "2025-01-01T00:00:00Z"},
        {"start_at": "2025-01-01T00:00:00Z", "end_at": "2025-01-01T00:00:00Z"},
        {"start_at": "not-a-date", "end_at": "2025-01-01T00:00:00Z"},
        {"days": 0},
        {"days": 91},
        {"page": 0},
        {"page": -1},
        {"page": "one"},
        {"page_size": 0},
        {"page_size": 201},
    ],
)
def test_invalid_ranges_and_pagination_are_rejected(
    analytics_admin_client: TestClient,
    params: dict,
) -> None:
    response = analytics_admin_client.get(PATH, params=params, headers=HEADERS)
    assert response.status_code == 422, response.text


def test_nonadmin_cannot_read_event_history(client: TestClient) -> None:
    response = client.get(
        PATH,
        params={"start_at": "2020-01-01T00:00:00Z", "end_at": "2026-01-01T00:00:00Z"},
        headers=HEADERS,
    )
    assert response.status_code == 403
