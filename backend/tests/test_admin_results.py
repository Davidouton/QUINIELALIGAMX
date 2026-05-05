from collections.abc import Generator
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from app.api.v1.routes import admin as admin_routes
from app.api.deps import get_current_profile
from app.main import app
from app.models.entities import Match, MatchResult, MatchStatus, Matchday, MatchdayStatus, Profile, RawMatchResult, RoleCode, SyncLog, SyncStatus
from app.providers.mock_provider import MockSportsDataProvider
from app.services.sync_results import sync_results

from conftest import MATCH_ONE_ID, MATCH_TWO_ID, MATCHDAY_ID, PROFILE_USER_ID, SEASON_ID, SessionLocal


@pytest.fixture
def admin_client(monkeypatch: pytest.MonkeyPatch) -> Generator[TestClient, None, None]:
    def override_current_profile() -> Profile:
        db = SessionLocal()
        try:
            profile = db.get(Profile, PROFILE_USER_ID)
            assert profile is not None
            profile.role_code = RoleCode.ADMIN
            return profile
        finally:
            db.close()

    monkeypatch.setattr(admin_routes, "get_results_provider", lambda: MockSportsDataProvider())
    app.dependency_overrides[get_current_profile] = override_current_profile
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def test_admin_can_save_result_for_match(admin_client: TestClient) -> None:
    response = admin_client.put(
        f"/api/v1/admin/results/{MATCH_ONE_ID}",
        json={"home_score": 2, "away_score": 1, "is_official": True},
        headers={"Authorization": "Bearer test-token"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["match_id"] == MATCH_ONE_ID
    assert payload["home_score"] == 2
    assert payload["away_score"] == 1
    assert payload["is_official"] is True
    assert payload["is_manual_override"] is True
    assert payload["source_provider_name"] == "admin_manual"

    db = SessionLocal()
    try:
        result = db.query(MatchResult).filter_by(match_id=MATCH_ONE_ID).one()
        match = db.get(Match, MATCH_ONE_ID)
    finally:
        db.close()

    assert result.home_score == 2
    assert result.away_score == 1
    assert result.is_official is True
    assert result.is_manual_override is True
    assert match is not None
    assert match.status == MatchStatus.FINAL


def test_admin_can_clear_result_and_match_returns_to_scheduled(admin_client: TestClient) -> None:
    admin_client.put(
        f"/api/v1/admin/results/{MATCH_ONE_ID}",
        json={"home_score": 0, "away_score": 0, "is_official": True},
        headers={"Authorization": "Bearer test-token"},
    )

    response = admin_client.delete(
        f"/api/v1/admin/results/{MATCH_ONE_ID}",
        headers={"Authorization": "Bearer test-token"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["home_score"] is None
    assert payload["away_score"] is None
    assert payload["is_official"] is False
    assert payload["match_status"] == MatchStatus.SCHEDULED

    db = SessionLocal()
    try:
        match = db.get(Match, MATCH_ONE_ID)
        result = db.query(MatchResult).filter_by(match_id=MATCH_ONE_ID).one_or_none()
    finally:
        db.close()

    assert match is not None
    assert match.status == MatchStatus.SCHEDULED
    assert result is None


def test_admin_can_mark_result_pending_and_match_returns_to_scheduled(admin_client: TestClient) -> None:
    admin_client.put(
        f"/api/v1/admin/results/{MATCH_ONE_ID}",
        json={"home_score": 2, "away_score": 1, "is_official": True},
        headers={"Authorization": "Bearer test-token"},
    )

    response = admin_client.put(
        f"/api/v1/admin/results/{MATCH_ONE_ID}",
        json={"home_score": 2, "away_score": 1, "is_official": False},
        headers={"Authorization": "Bearer test-token"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["is_official"] is False
    assert payload["match_status"] == MatchStatus.SCHEDULED

    db = SessionLocal()
    try:
        match = db.get(Match, MATCH_ONE_ID)
        result = db.query(MatchResult).filter_by(match_id=MATCH_ONE_ID).one()
    finally:
        db.close()

    assert result.is_official is False
    assert match is not None
    assert match.status == MatchStatus.SCHEDULED


def test_admin_results_list_includes_unofficial_rows(admin_client: TestClient) -> None:
    response = admin_client.get(
        f"/api/v1/admin/results?matchday_id={MATCHDAY_ID}",
        headers={"Authorization": "Bearer test-token"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert len(payload) == 2
    assert payload[0]["home_score"] is None
    assert payload[0]["is_official"] is False


def test_sync_admin_results_persists_demo_results_for_past_matches(admin_client: TestClient) -> None:
    db = SessionLocal()
    try:
        match_one = db.get(Match, MATCH_ONE_ID)
        match_two = db.get(Match, MATCH_TWO_ID)
        assert match_one is not None
        assert match_two is not None
        match_one.kickoff_at = datetime.now(UTC) - timedelta(days=2)
        match_two.kickoff_at = datetime.now(UTC) - timedelta(days=1)
        db.add(match_one)
        db.add(match_two)
        db.commit()
    finally:
        db.close()

    response = admin_client.post(
        "/api/v1/admin/results/sync",
        headers={"Authorization": "Bearer test-token"},
    )

    assert response.status_code == 200
    assert response.json()["records_processed"] == 2

    db = SessionLocal()
    try:
        results = db.query(MatchResult).all()
        match_one = db.get(Match, MATCH_ONE_ID)
        match_two = db.get(Match, MATCH_TWO_ID)
    finally:
        db.close()

    assert len(results) == 2
    assert all(result.is_official for result in results)
    assert match_one is not None and match_one.status == MatchStatus.FINAL
    assert match_two is not None and match_two.status == MatchStatus.FINAL

    db = SessionLocal()
    try:
        raw_rows = db.query(RawMatchResult).all()
    finally:
        db.close()

    assert len(raw_rows) == 2


def test_sync_does_not_override_manual_result(admin_client: TestClient) -> None:
    admin_client.put(
        f"/api/v1/admin/results/{MATCH_ONE_ID}",
        json={"home_score": 9, "away_score": 1, "is_official": True},
        headers={"Authorization": "Bearer test-token"},
    )

    db = SessionLocal()
    try:
        match_one = db.get(Match, MATCH_ONE_ID)
        assert match_one is not None
        match_one.kickoff_at = datetime.now(UTC) - timedelta(days=2)
        db.add(match_one)
        db.commit()
    finally:
        db.close()

    response = admin_client.post(
        "/api/v1/admin/results/sync",
        headers={"Authorization": "Bearer test-token"},
    )

    assert response.status_code == 200

    db = SessionLocal()
    try:
        result = db.query(MatchResult).filter_by(match_id=MATCH_ONE_ID).one()
    finally:
        db.close()

    assert result.home_score == 9
    assert result.away_score == 1
    assert result.is_manual_override is True


def test_sync_matches_by_team_names_and_date_without_external_id() -> None:
    class FakeProvider:
        name = "fake_results"

        def fetch_matches(self):
            return []

        def fetch_odds(self):
            return []

        def fetch_results(self):
            return [
                {
                    "home_team_name": "America",
                    "away_team_name": "Chivas",
                    "source_match_date": "2026-01-01",
                    "kickoff_at": "2026-01-01T12:00:00Z",
                    "home_score": 3,
                    "away_score": 2,
                    "is_official": True,
                    "payload": {"source": "fake"},
                }
            ]

    db = SessionLocal()
    try:
        match = db.get(Match, MATCH_ONE_ID)
        assert match is not None
        match.external_id = None
        match.kickoff_at = datetime(2026, 1, 1, 12, 0, tzinfo=UTC)
        db.add(match)
        db.commit()

        summary = sync_results(db, FakeProvider())
    finally:
        db.close()

    assert summary["records_processed"] == 1

    db = SessionLocal()
    try:
        result = db.query(MatchResult).filter_by(match_id=MATCH_ONE_ID).one()
    finally:
        db.close()

    assert result.home_score == 3
    assert result.away_score == 2
    assert result.source_provider_name == "fake_results"


def test_sync_matches_by_alias_and_mexico_city_date_from_kickoff() -> None:
    class FakeProvider:
        name = "fake_results"

        def fetch_matches(self):
            return []

        def fetch_odds(self):
            return []

        def fetch_results(self):
            return [
                {
                    "home_team_name": "Club America",
                    "away_team_name": "Guadalajara",
                    "source_match_date": "2026-01-02",
                    "kickoff_at": "2026-01-02T03:00:00Z",
                    "home_score": 1,
                    "away_score": 0,
                    "is_official": True,
                    "payload": {"source": "fake"},
                }
            ]

    db = SessionLocal()
    try:
        match = db.get(Match, MATCH_ONE_ID)
        assert match is not None
        match.external_id = None
        match.kickoff_at = datetime(2026, 1, 1, 20, 0, tzinfo=UTC)
        db.add(match)
        db.commit()

        summary = sync_results(db, FakeProvider())
    finally:
        db.close()

    assert summary["records_processed"] == 1

    db = SessionLocal()
    try:
        result = db.query(MatchResult).filter_by(match_id=MATCH_ONE_ID).one()
    finally:
        db.close()

    assert result.home_score == 1
    assert result.away_score == 0


def test_sync_for_matchday_falls_back_to_global_results_and_only_updates_selected_matchday() -> None:
    class FakeProvider:
        name = "fake_results"

        def fetch_matches(self):
            return []

        def fetch_odds(self):
            return []

        def fetch_results_for_dates(self, dates):
            assert dates == ["2026-01-01"]
            return []

        def fetch_results(self):
            return [
                {
                    "home_team_name": "Club America",
                    "away_team_name": "Guadalajara",
                    "source_match_date": "2026-01-01",
                    "kickoff_at": "2026-01-02T03:00:00Z",
                    "home_score": 2,
                    "away_score": 1,
                    "is_official": True,
                    "payload": {"source": "fallback"},
                },
                {
                    "home_team_name": "Tigres",
                    "away_team_name": "Monterrey",
                    "source_match_date": "2026-01-01",
                    "kickoff_at": "2026-01-01T14:00:00Z",
                    "home_score": 4,
                    "away_score": 4,
                    "is_official": True,
                    "payload": {"source": "other-matchday"},
                },
            ]

    second_matchday_id = "30000000-0000-0000-0000-000000000099"

    db = SessionLocal()
    try:
        first_match = db.get(Match, MATCH_ONE_ID)
        second_match = db.get(Match, MATCH_TWO_ID)
        assert first_match is not None
        assert second_match is not None

        first_match.external_id = None
        first_match.kickoff_at = datetime(2026, 1, 1, 20, 0, tzinfo=UTC)
        second_match.matchday_id = second_matchday_id
        second_match.external_id = None
        second_match.kickoff_at = datetime(2026, 1, 1, 14, 0, tzinfo=UTC)

        extra_matchday = Matchday(
            id=second_matchday_id,
            season_id=SEASON_ID,
            number=99,
            name="Jornada 99",
            status=MatchdayStatus.ACTIVE,
            starts_at=datetime(2026, 1, 1, 12, 0, tzinfo=UTC),
            ends_at=datetime(2026, 1, 2, 12, 0, tzinfo=UTC),
        )
        db.add(extra_matchday)
        db.add(first_match)
        db.add(second_match)
        db.commit()

        summary = sync_results(db, FakeProvider(), matchday_id=MATCHDAY_ID)
    finally:
        db.close()

    assert summary["records_processed"] == 1

    db = SessionLocal()
    try:
        first_result = db.query(MatchResult).filter_by(match_id=MATCH_ONE_ID).one_or_none()
        second_result = db.query(MatchResult).filter_by(match_id=MATCH_TWO_ID).one_or_none()
    finally:
        db.close()

    assert first_result is not None
    assert first_result.home_score == 2
    assert first_result.away_score == 1
    assert second_result is None


def test_admin_can_clear_manual_override_and_restore_latest_raw(admin_client: TestClient) -> None:
    admin_client.put(
        f"/api/v1/admin/results/{MATCH_ONE_ID}",
        json={"home_score": 9, "away_score": 1, "is_official": True},
        headers={"Authorization": "Bearer test-token"},
    )

    db = SessionLocal()
    try:
        sync_log = SyncLog(
            provider_name="thesportsdb_v1",
            resource_type="results",
            status=SyncStatus.SUCCESS,
            records_processed=1,
        )
        db.add(sync_log)
        db.flush()
        db.add(
            RawMatchResult(
                sync_log_id=sync_log.id,
                provider_name="thesportsdb_v1",
                external_match_id="2396214",
                mapped_match_id=MATCH_ONE_ID,
                home_score=3,
                away_score=0,
                result_status="Match Finished",
                is_official=True,
                payload_json='{"source":"raw"}',
            )
        )
        db.commit()
    finally:
        db.close()

    response = admin_client.post(
        f"/api/v1/admin/results/{MATCH_ONE_ID}/clear-override",
        headers={"Authorization": "Bearer test-token"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["is_manual_override"] is False
    assert payload["source_provider_name"] == "thesportsdb_v1"
    assert payload["home_score"] == 3
    assert payload["away_score"] == 0


def test_admin_can_clear_manual_override_and_restore_pending_raw(admin_client: TestClient) -> None:
    admin_client.put(
        f"/api/v1/admin/results/{MATCH_ONE_ID}",
        json={"home_score": 9, "away_score": 1, "is_official": True},
        headers={"Authorization": "Bearer test-token"},
    )

    db = SessionLocal()
    try:
        sync_log = SyncLog(
            provider_name="thesportsdb_v1",
            resource_type="results",
            status=SyncStatus.SUCCESS,
            records_processed=1,
        )
        db.add(sync_log)
        db.flush()
        db.add(
            RawMatchResult(
                sync_log_id=sync_log.id,
                provider_name="thesportsdb_v1",
                external_match_id="2396215",
                mapped_match_id=MATCH_ONE_ID,
                home_score=0,
                away_score=0,
                result_status="Pending",
                is_official=False,
                payload_json='{"source":"raw-pending"}',
            )
        )
        db.commit()
    finally:
        db.close()

    response = admin_client.post(
        f"/api/v1/admin/results/{MATCH_ONE_ID}/clear-override",
        headers={"Authorization": "Bearer test-token"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["is_manual_override"] is False
    assert payload["is_official"] is False
    assert payload["match_status"] == MatchStatus.SCHEDULED

    db = SessionLocal()
    try:
        match = db.get(Match, MATCH_ONE_ID)
        result = db.query(MatchResult).filter_by(match_id=MATCH_ONE_ID).one()
    finally:
        db.close()

    assert result.is_official is False
    assert match is not None
    assert match.status == MatchStatus.SCHEDULED
