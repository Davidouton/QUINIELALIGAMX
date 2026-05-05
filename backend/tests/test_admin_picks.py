from collections.abc import Generator
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from app.api.deps import get_current_profile
from app.main import app
from app.models.entities import Match, Profile, RoleCode, UserPick

from conftest import MATCH_ONE_ID, MATCH_TWO_ID, MATCHDAY_ID, PROFILE_LEADER_ID, PROFILE_USER_ID, SessionLocal


@pytest.fixture
def admin_client() -> Generator[TestClient, None, None]:
    def override_current_profile() -> Profile:
        db = SessionLocal()
        try:
            profile = db.get(Profile, PROFILE_USER_ID)
            assert profile is not None
            profile.role_code = RoleCode.ADMIN
            return profile
        finally:
            db.close()

    app.dependency_overrides[get_current_profile] = override_current_profile
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def test_admin_can_list_all_picks_rows_for_matchday(admin_client: TestClient) -> None:
    db = SessionLocal()
    try:
        db.add(
            UserPick(
                profile_id=PROFILE_USER_ID,
                match_id=MATCH_ONE_ID,
                selection="home",
                predicted_home_score=2,
                predicted_away_score=1,
            )
        )
        db.commit()
    finally:
        db.close()

    response = admin_client.get(
        f"/api/v1/admin/picks?matchday_id={MATCHDAY_ID}",
        headers={"Authorization": "Bearer test-token"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert len(payload) == 4
    assert any(row["profile_id"] == PROFILE_USER_ID and row["match_id"] == MATCH_ONE_ID and row["has_pick"] is True for row in payload)
    assert any(row["profile_id"] == PROFILE_LEADER_ID and row["match_id"] == MATCH_TWO_ID and row["has_pick"] is False for row in payload)


def test_admin_can_override_locked_pick_and_store_note(admin_client: TestClient) -> None:
    db = SessionLocal()
    try:
        match = db.get(Match, MATCH_ONE_ID)
        assert match is not None
        match.picks_lock_at = datetime.now(UTC) - timedelta(minutes=5)
        db.add(match)
        db.commit()
    finally:
        db.close()

    response = admin_client.post(
        "/api/v1/admin/picks/override",
        json={
            "profile_id": PROFILE_LEADER_ID,
            "match_id": MATCH_ONE_ID,
            "selection": "away",
            "predicted_home_score": 0,
            "predicted_away_score": 1,
            "admin_override_note": "Capturado por soporte antes del cierre final.",
        },
        headers={"Authorization": "Bearer test-token"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["profile_id"] == PROFILE_LEADER_ID
    assert payload["match_id"] == MATCH_ONE_ID
    assert payload["is_admin_override"] is True
    assert payload["admin_override_note"] == "Capturado por soporte antes del cierre final."
    assert payload["overridden_by_profile_id"] == PROFILE_USER_ID
    assert payload["overridden_by_display_name"] == "Usuario Demo"

    db = SessionLocal()
    try:
        pick = db.query(UserPick).filter_by(profile_id=PROFILE_LEADER_ID, match_id=MATCH_ONE_ID).one()
    finally:
        db.close()

    assert pick.selection.value == "away"
    assert pick.is_admin_override is True
    assert pick.admin_override_note == "Capturado por soporte antes del cierre final."
    assert pick.overridden_by_profile_id == PROFILE_USER_ID
    assert pick.overridden_at is not None


def test_user_update_clears_admin_override_metadata(client) -> None:
    db = SessionLocal()
    try:
        pick = UserPick(
            profile_id=PROFILE_USER_ID,
            match_id=MATCH_ONE_ID,
            selection="home",
            predicted_home_score=1,
            predicted_away_score=0,
            is_admin_override=True,
            admin_override_note="Cambio de emergencia",
            overridden_by_profile_id=PROFILE_LEADER_ID,
            overridden_at=datetime.now(UTC) - timedelta(minutes=10),
        )
        db.add(pick)
        db.commit()
        pick_id = pick.id
    finally:
        db.close()

    response = client.put(
        f"/api/v1/picks/{pick_id}",
        json={
            "selection": "draw",
            "predicted_home_score": 2,
            "predicted_away_score": 2,
        },
        headers={"Authorization": "Bearer test-token"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["is_admin_override"] is False
    assert payload["admin_override_note"] is None
    assert payload["overridden_by_profile_id"] is None
    assert payload["overridden_at"] is None


def test_my_pick_results_expose_admin_override_notice(client) -> None:
    db = SessionLocal()
    try:
        pick = UserPick(
            profile_id=PROFILE_USER_ID,
            match_id=MATCH_ONE_ID,
            selection="home",
            predicted_home_score=3,
            predicted_away_score=1,
            is_admin_override=True,
            admin_override_note="Ajustado por admin por llamada telefonica.",
            overridden_by_profile_id=PROFILE_LEADER_ID,
            overridden_at=datetime.now(UTC) - timedelta(minutes=15),
        )
        db.add(pick)
        db.commit()
    finally:
        db.close()

    response = client.get(
        f"/api/v1/my-pick-results?matchday_id={MATCHDAY_ID}",
        headers={"Authorization": "Bearer test-token"},
    )

    assert response.status_code == 200
    payload = response.json()
    row = next(item for item in payload if item["match_id"] == MATCH_ONE_ID)
    assert row["is_admin_override"] is True
    assert row["admin_override_note"] == "Ajustado por admin por llamada telefonica."
