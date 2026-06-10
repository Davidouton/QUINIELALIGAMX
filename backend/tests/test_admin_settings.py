from collections.abc import Generator
from datetime import UTC, datetime, timedelta

import pytest
from conftest import (
    MATCH_ONE_ID,
    MATCHDAY_ID,
    PROFILE_LEADER_ID,
    PROFILE_USER_ID,
    SEASON_ID,
    SessionLocal,
)
from fastapi.testclient import TestClient

from app.api.deps import get_current_profile
from app.api.v1.routes import admin as admin_routes
from app.core.datetime import ensure_utc
from app.core.security import AuthUser
from app.main import app
from app.models.entities import (
    Match,
    Matchday,
    Profile,
    RoleCode,
    ScoringRule,
    Season,
    SeasonMembership,
)


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


def test_get_admin_settings_returns_defaults(admin_client: TestClient) -> None:
    response = admin_client.get("/api/v1/admin/settings", headers={"Authorization": "Bearer test-token"})

    assert response.status_code == 200
    payload = response.json()

    assert payload["active_season_id"] == SEASON_ID
    assert payload["start_matchday_id"] is None
    assert payload["end_matchday_id"] is None
    assert payload["participants_lock_at"] is None
    assert payload["participants_locked"] is False
    assert payload["eligible_participants"] == 0
    assert payload["confirmed_participants"] == 2
    assert payload["entry_fee_amount"] == 0
    assert payload["weekly_first_place_amount"] == 0
    assert payload["weekly_second_place_amount"] == 0
    assert payload["weekly_third_place_amount"] == 0
    assert payload["weekly_total_prize_amount"] == 0
    assert payload["tournament_matchdays_count"] == 1
    assert payload["admin_commission_pct"] == 0
    assert payload["reserve_pct"] == 0
    assert payload["first_place_pct"] == 0
    assert payload["second_place_pct"] == 0
    assert payload["third_place_pct"] == 0
    assert payload["gross_pool_amount"] == 0
    assert payload["admin_commission_amount"] == 0
    assert payload["income_after_commission_amount"] == 0
    assert payload["total_weekly_prizes_amount"] == 0
    assert payload["reserve_amount"] == 0
    assert payload["distributable_prize_pool_amount"] == 0
    assert payload["first_place_amount"] == 0
    assert payload["second_place_amount"] == 0
    assert payload["third_place_amount"] == 0
    assert payload["result_correct_points"] == 3
    assert payload["exact_score_points"] == 2
    assert payload["evaluated_picks"] is None
    assert payload["weekly_leaders"] is None


def test_update_admin_settings_persists_active_season_and_rules(admin_client: TestClient) -> None:
    db = SessionLocal()
    try:
        db.add(Season(id="20000000-0000-0000-0000-000000000099", name="Apertura 2026", slug="apertura-2026"))
        db.commit()
    finally:
        db.close()

    response = admin_client.put(
        "/api/v1/admin/settings",
        json={
            "active_season_id": "20000000-0000-0000-0000-000000000099",
            "start_matchday_id": None,
            "end_matchday_id": None,
            "result_correct_points": 5,
            "exact_score_points": 4,
        },
        headers={"Authorization": "Bearer test-token"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["active_season_id"] == "20000000-0000-0000-0000-000000000099"
    assert payload["start_matchday_id"] is None
    assert payload["end_matchday_id"] is None
    assert payload["result_correct_points"] == 5
    assert payload["exact_score_points"] == 4
    assert payload["evaluated_picks"] == 0
    assert payload["weekly_leaders"] == 0

    db = SessionLocal()
    try:
        seasons = {season.id: season for season in db.query(Season).all()}
        rules = {rule.rule_key: rule.points for rule in db.query(ScoringRule).all()}
    finally:
        db.close()

    assert seasons[SEASON_ID].is_active is False
    assert seasons["20000000-0000-0000-0000-000000000099"].is_active is True
    assert rules["result_correct"] == 5
    assert rules["exact_score"] == 4


def test_admin_users_list_includes_selected_season_membership(admin_client: TestClient) -> None:
    db = SessionLocal()
    try:
        profile = db.get(Profile, PROFILE_USER_ID)
        assert profile is not None
        profile.contact_phone = "5551234567"
        profile.bank_name = "Banorte"
        profile.deposit_account = "CLABE 123"
        profile.modality = "aval"
        profile.aval_profile_id = PROFILE_USER_ID
        profile.theme_preference = "favorite_team"
        db.add(profile)

        leader = db.query(Profile).filter(Profile.id != PROFILE_USER_ID).first()
        assert leader is not None
        profile.aval_profile_id = leader.id
        db.add(profile)
        db.commit()
    finally:
        db.close()

    response = admin_client.get("/api/v1/admin/users", headers={"Authorization": "Bearer test-token"})

    assert response.status_code == 200
    payload = response.json()
    current_user = next(user for user in payload if user["id"] == PROFILE_USER_ID)
    assert current_user["selected_season_membership"]["season_id"] == SEASON_ID
    assert current_user["selected_season_membership"]["is_active"] is True
    assert current_user["contact_phone"] == "5551234567"
    assert current_user["bank_name"] == "Banorte"
    assert current_user["deposit_account"] == "CLABE 123"
    assert current_user["modality"] == "aval"
    assert current_user["aval_display_name"] == "Lider Semanal"
    assert current_user["theme_preference"] == "favorite_team"


def test_admin_can_update_user_season_membership(admin_client: TestClient) -> None:
    response = admin_client.put(
        f"/api/v1/admin/users/{PROFILE_USER_ID}/season-membership",
        json={
            "season_id": SEASON_ID,
            "is_active": False,
            "is_paid": True,
            "notes": "Pago recibido pero fuera de jornada",
        },
        headers={"Authorization": "Bearer test-token"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["selected_season_membership"]["is_active"] is False
    assert payload["selected_season_membership"]["is_paid"] is True
    assert payload["selected_season_membership"]["notes"] == "Pago recibido pero fuera de jornada"

    db = SessionLocal()
    try:
        membership = db.query(SeasonMembership).filter_by(profile_id=PROFILE_USER_ID, season_id=SEASON_ID).one()
    finally:
        db.close()

    assert membership.is_active is False
    assert membership.is_paid is True


def test_admin_can_create_invited_user_with_season_membership(
    admin_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FakeSupabaseAdminService:
        def invite_user(self, *, email: str, display_name: str) -> AuthUser:
            return AuthUser(
                auth_user_id="30000000-0000-0000-0000-000000000001",
                email=email,
                raw_claims={"user_metadata": {"display_name": display_name}},
            )

    monkeypatch.setattr(admin_routes, "supabase_admin_service", FakeSupabaseAdminService())

    response = admin_client.post(
        "/api/v1/admin/users",
        json={
            "email": "nuevo@example.com",
            "display_name": "Usuario Nuevo",
            "season_id": SEASON_ID,
            "is_active": True,
            "is_paid": True,
            "modality": "pre_pago",
        },
        headers={"Authorization": "Bearer test-token"},
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["email"] == "nuevo@example.com"
    assert payload["display_name"] == "Usuario Nuevo"
    assert payload["selected_season_membership"]["is_active"] is True
    assert payload["selected_season_membership"]["is_paid"] is True
    assert payload["selected_season_membership"]["eligible_for_scoring"] is True

    db = SessionLocal()
    try:
        profile = db.query(Profile).filter_by(email="nuevo@example.com").one()
        membership = (
            db.query(SeasonMembership)
            .filter_by(profile_id=profile.id, season_id=SEASON_ID)
            .one()
        )
    finally:
        db.close()

    assert profile.auth_user_id == "30000000-0000-0000-0000-000000000001"
    assert profile.display_name == "Usuario Nuevo"
    assert membership.is_active is True
    assert membership.is_paid is True


def test_admin_can_update_user_password(
    admin_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[str, str]] = []

    class FakeSupabaseAdminService:
        def update_user_password(self, *, auth_user_id: str, password: str) -> None:
            calls.append((auth_user_id, password))

    monkeypatch.setattr(admin_routes, "supabase_admin_service", FakeSupabaseAdminService())

    response = admin_client.put(
        f"/api/v1/admin/users/{PROFILE_USER_ID}/password",
        json={"password": "temporal123"},
        headers={"Authorization": "Bearer test-token"},
    )

    assert response.status_code == 200
    assert calls == [("11111111-1111-1111-1111-111111111111", "temporal123")]


def test_admin_can_bulk_create_users_with_passwords(
    admin_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FakeSupabaseAdminService:
        def create_user(self, *, email: str, display_name: str, password: str) -> AuthUser:
            return AuthUser(
                auth_user_id="30000000-0000-0000-0000-000000000002",
                email=email,
                raw_claims={"user_metadata": {"display_name": display_name}},
            )

    monkeypatch.setattr(admin_routes, "supabase_admin_service", FakeSupabaseAdminService())

    response = admin_client.post(
        "/api/v1/admin/users/bulk",
        json={
            "season_id": SEASON_ID,
            "send_invites": False,
            "csv_text": (
                "email,display_name,password,is_paid,modality,notes\n"
                "bulk@example.com,Usuario Bulk,temporal123,true,pre_pago,Alta bulk\n"
                "sinpass@example.com,Sin Password,,true,pre_pago,Debe fallar\n"
            ),
        },
        headers={"Authorization": "Bearer test-token"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["created_or_updated"] == 1
    assert payload["failed"] == 1
    assert payload["rows"][0]["status"] == "ok"
    assert payload["rows"][1]["status"] == "error"

    db = SessionLocal()
    try:
        profile = db.query(Profile).filter_by(email="bulk@example.com").one()
        membership = (
            db.query(SeasonMembership)
            .filter_by(profile_id=profile.id, season_id=SEASON_ID)
            .one()
        )
    finally:
        db.close()

    assert profile.display_name == "Usuario Bulk"
    assert membership.is_active is True
    assert membership.is_paid is True


def test_admin_can_update_user_billing_modality_and_aval(admin_client: TestClient) -> None:
    response = admin_client.put(
        f"/api/v1/admin/users/{PROFILE_USER_ID}/billing",
        json={
            "modality": "aval",
            "aval_profile_id": PROFILE_LEADER_ID,
        },
        headers={"Authorization": "Bearer test-token"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["modality"] == "aval"
    assert payload["aval_profile_id"] == PROFILE_LEADER_ID
    assert payload["aval_display_name"] == "Lider Semanal"

    db = SessionLocal()
    try:
        profile = db.get(Profile, PROFILE_USER_ID)
        assert profile is not None
    finally:
        db.close()

    assert profile.modality == "aval"
    assert profile.aval_profile_id == PROFILE_LEADER_ID


def test_admin_can_promote_user_to_admin(admin_client: TestClient) -> None:
    response = admin_client.patch(
        f"/api/v1/admin/users/{PROFILE_USER_ID}/role",
        json={"role_code": "admin"},
        headers={"Authorization": "Bearer test-token"},
    )

    assert response.status_code == 200
    assert response.json()["role_code"] == "admin"


def test_admin_can_set_start_matchday_for_active_season(admin_client: TestClient) -> None:
    response = admin_client.put(
        "/api/v1/admin/settings",
        json={
            "active_season_id": SEASON_ID,
            "start_matchday_id": MATCHDAY_ID,
            "end_matchday_id": MATCHDAY_ID,
            "result_correct_points": 3,
            "exact_score_points": 2,
        },
        headers={"Authorization": "Bearer test-token"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["active_season_id"] == SEASON_ID
    assert payload["start_matchday_id"] == MATCHDAY_ID
    assert payload["end_matchday_id"] == MATCHDAY_ID
    assert payload["participants_lock_at"] is not None


def test_admin_can_delete_matchday_and_clear_season_bounds(admin_client: TestClient) -> None:
    admin_client.put(
        "/api/v1/admin/settings",
        json={
            "active_season_id": SEASON_ID,
            "start_matchday_id": MATCHDAY_ID,
            "end_matchday_id": MATCHDAY_ID,
            "result_correct_points": 3,
            "exact_score_points": 2,
        },
        headers={"Authorization": "Bearer test-token"},
    )

    response = admin_client.delete(
        f"/api/v1/admin/matchdays/{MATCHDAY_ID}",
        headers={"Authorization": "Bearer test-token"},
    )

    assert response.status_code == 200
    assert response.json() == {"status": "deleted", "matchday_id": MATCHDAY_ID}

    db = SessionLocal()
    try:
        season = db.get(Season, SEASON_ID)
        matchday = db.get(Matchday, MATCHDAY_ID)
    finally:
        db.close()

    assert season is not None
    assert season.start_matchday_id is None
    assert season.end_matchday_id is None
    assert season.participants_lock_at is None
    assert matchday is None


def test_admin_can_update_matchday_offset_and_propagate_match_locks(admin_client: TestClient) -> None:
    db = SessionLocal()
    try:
        match = db.get(Match, MATCH_ONE_ID)
        assert match is not None
        kickoff_at = datetime.now(UTC) - timedelta(days=2)
        match.kickoff_at = kickoff_at
        match.picks_lock_at = kickoff_at - timedelta(minutes=10)
        db.add(match)
        db.commit()
    finally:
        db.close()

    response = admin_client.put(
        f"/api/v1/admin/matchdays/{MATCHDAY_ID}",
        json={
          "season_id": SEASON_ID,
          "number": 3,
          "name": "Jornada 3",
          "default_lock_offset_minutes": -150000,
          "status": "active",
          "starts_at": "2026-03-20T18:00:00",
          "ends_at": "2026-03-22T23:00:00",
        },
        headers={"Authorization": "Bearer test-token"},
    )

    assert response.status_code == 200

    db = SessionLocal()
    try:
        match = db.get(Match, MATCH_ONE_ID)
    finally:
        db.close()

    assert match is not None
    assert ensure_utc(match.picks_lock_at) > datetime.now(UTC)

    db = SessionLocal()
    try:
        matchday = db.get(Matchday, MATCHDAY_ID)
    finally:
        db.close()

    assert matchday is not None
    assert matchday.picks_reopened_override is False


def test_admin_can_reopen_and_restore_matchday_picks(admin_client: TestClient) -> None:
    db = SessionLocal()
    try:
        match = db.get(Match, MATCH_ONE_ID)
        assert match is not None
        kickoff_at = datetime.now(UTC) - timedelta(days=10)
        original_lock_at = kickoff_at - timedelta(minutes=10)
        match.kickoff_at = kickoff_at
        match.picks_lock_at = original_lock_at
        db.add(match)
        db.commit()
    finally:
        db.close()

    reopen_response = admin_client.post(
        f"/api/v1/admin/matchdays/{MATCHDAY_ID}/reopen-picks",
        headers={"Authorization": "Bearer test-token"},
    )

    assert reopen_response.status_code == 200
    assert reopen_response.json()["status"] == "reopened"

    db = SessionLocal()
    try:
        reopened_match = db.get(Match, MATCH_ONE_ID)
    finally:
        db.close()

    assert reopened_match is not None
    assert ensure_utc(reopened_match.picks_lock_at) > datetime.now(UTC)

    db = SessionLocal()
    try:
        reopened_matchday = db.get(Matchday, MATCHDAY_ID)
    finally:
        db.close()

    assert reopened_matchday is not None
    assert reopened_matchday.picks_reopened_override is True

    restore_response = admin_client.post(
        f"/api/v1/admin/matchdays/{MATCHDAY_ID}/restore-picks-lock",
        headers={"Authorization": "Bearer test-token"},
    )

    assert restore_response.status_code == 200
    assert restore_response.json()["status"] == "restored"

    db = SessionLocal()
    try:
        restored_match = db.get(Match, MATCH_ONE_ID)
    finally:
        db.close()

    assert restored_match is not None
    assert ensure_utc(restored_match.picks_lock_at) == ensure_utc(restored_match.kickoff_at - timedelta(minutes=10))

    db = SessionLocal()
    try:
        restored_matchday = db.get(Matchday, MATCHDAY_ID)
    finally:
        db.close()

    assert restored_matchday is not None
    assert restored_matchday.picks_reopened_override is False
