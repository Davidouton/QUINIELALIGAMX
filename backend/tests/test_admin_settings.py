from collections.abc import Generator
from datetime import UTC, datetime, timedelta
from uuid import uuid4

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
    AnalyticsEvent,
    Match,
    Matchday,
    PaymentScopeType,
    Profile,
    PricingRule,
    RoleCode,
    ScoringRule,
    Season,
    SeasonMembership,
    SettlementAssignment,
    SettlementStatus,
    SurvivorMembership,
)
from app.services.settlement_service import SettlementService


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


def test_general_settings_update_does_not_overwrite_prizes(admin_client: TestClient) -> None:
    db = SessionLocal()
    try:
        season = db.get(Season, SEASON_ID)
        assert season is not None
        season.weekly_first_place_amount = 100
        season.weekly_second_place_amount = 50
        season.weekly_third_place_amount = 30
        season.admin_commission_pct = 7
        season.first_place_pct = 60
        season.second_place_pct = 30
        season.third_place_pct = 10
        db.commit()
    finally:
        db.close()

    response = admin_client.put(
        "/api/v1/admin/settings?set_active=false&update_prizes=false",
        json={
            "active_season_id": SEASON_ID,
            "weekly_first_place_amount": 0,
            "weekly_second_place_amount": 0,
            "weekly_third_place_amount": 0,
            "admin_commission_pct": 0,
            "first_place_pct": 0,
            "second_place_pct": 0,
            "third_place_pct": 0,
            "result_correct_points": 3,
            "exact_score_points": 2,
        },
        headers={"Authorization": "Bearer test-token"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["weekly_first_place_amount"] == 100
    assert payload["weekly_second_place_amount"] == 50
    assert payload["weekly_third_place_amount"] == 30
    assert payload["admin_commission_pct"] == 7
    assert payload["first_place_pct"] == 60
    assert payload["second_place_pct"] == 30
    assert payload["third_place_pct"] == 10


def test_prize_panel_saves_pricing_and_prizes_for_selected_product(
    admin_client: TestClient,
) -> None:
    response = admin_client.put(
        "/api/v1/admin/settings?set_active=false&update_prizes=true&update_pricing=true",
        json={
            "active_season_id": SEASON_ID,
            "prize_scope": "season",
            "entry_fee_amount": 1250,
            "weekly_first_place_amount": 150,
            "weekly_second_place_amount": 75,
            "weekly_third_place_amount": 25,
            "admin_commission_pct": 5,
            "reserve_pct": 10,
            "first_place_pct": 60,
            "second_place_pct": 30,
            "third_place_pct": 10,
            "result_correct_points": 3,
            "exact_score_points": 2,
        },
        headers={"Authorization": "Bearer test-token"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["entry_fee_amount"] == 1250
    assert payload["weekly_first_place_amount"] == 150
    assert payload["weekly_second_place_amount"] == 75
    assert payload["weekly_third_place_amount"] == 25

    db = SessionLocal()
    try:
        season = db.get(Season, SEASON_ID)
        pricing_rule = db.query(PricingRule).filter_by(
            scope_type=PaymentScopeType.SEASON,
            scope_id=SEASON_ID,
        ).one()
    finally:
        db.close()

    assert season is not None
    assert float(season.weekly_first_place_amount) == 150
    assert float(pricing_rule.amount) == 1250
    assert pricing_rule.is_active is True


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


def test_admin_users_list_includes_selected_survivor_membership(admin_client: TestClient) -> None:
    db = SessionLocal()
    try:
        db.add(
            SurvivorMembership(
                season_id=SEASON_ID,
                profile_id=PROFILE_USER_ID,
                is_active=True,
                joined_at=datetime.now(UTC),
            )
        )
        db.commit()
    finally:
        db.close()

    response = admin_client.get("/api/v1/admin/users", headers={"Authorization": "Bearer test-token"})

    assert response.status_code == 200
    payload = response.json()
    current_user = next(user for user in payload if user["id"] == PROFILE_USER_ID)
    assert current_user["selected_survivor_membership"]["season_id"] == SEASON_ID
    assert current_user["selected_survivor_membership"]["is_active"] is True
    assert current_user["selected_survivor_membership"]["joined_at"] is not None


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


def test_admin_can_update_user_survivor_membership(admin_client: TestClient) -> None:
    response = admin_client.put(
        f"/api/v1/admin/users/{PROFILE_USER_ID}/survivor-membership",
        json={
            "season_id": SEASON_ID,
            "is_active": True,
        },
        headers={"Authorization": "Bearer test-token"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["selected_survivor_membership"]["is_active"] is True
    assert payload["selected_survivor_membership"]["joined_at"] is not None

    db = SessionLocal()
    try:
        membership = db.query(SurvivorMembership).filter_by(profile_id=PROFILE_USER_ID, season_id=SEASON_ID).one()
    finally:
        db.close()

    assert membership.is_active is True
    assert membership.joined_at is not None


def test_admin_generates_survivor_charge_in_players_payment_hub(admin_client: TestClient) -> None:
    db = SessionLocal()
    try:
        season = db.get(Season, SEASON_ID)
        payer = db.get(Profile, PROFILE_LEADER_ID)
        assert season is not None
        assert payer is not None
        season.survivor_enabled = True
        payer.modality = "pre_pago"
        payer.aval_profile_id = None
        db.add_all([
            season,
            payer,
            SurvivorMembership(
                season_id=SEASON_ID,
                profile_id=PROFILE_LEADER_ID,
                is_active=False,
                is_rejected=False,
            ),
            PricingRule(
                scope_type=PaymentScopeType.SURVIVOR,
                scope_id=SEASON_ID,
                label="Entrada Survivor",
                amount=250,
                currency="mxn",
                is_active=True,
                created_by_profile_id=PROFILE_USER_ID,
            ),
        ])
        db.commit()
    finally:
        db.close()

    response = admin_client.post(
        "/api/v1/payments/settlements/admin/enrollment-request",
        json={
            "profile_id": PROFILE_LEADER_ID,
            "scope_type": "survivor",
            "scope_id": SEASON_ID,
        },
        headers={"Authorization": "Bearer test-token"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["scope_type"] == "survivor"
    assert payload["payer_profile_id"] == PROFILE_LEADER_ID
    assert payload["payee_profile_id"] == PROFILE_USER_ID
    assert payload["amount"] == 250
    assert payload["status"] == "pending_proof"

    db = SessionLocal()
    try:
        payer = db.get(Profile, PROFILE_LEADER_ID)
        assert payer is not None
        hub = SettlementService().list_my_settlements(db, payer)
        assert [row.id for row in hub.outgoing] == [payload["id"]]
        assignment = db.get(SettlementAssignment, payload["id"])
        assert assignment is not None
        assert assignment.scope_type == PaymentScopeType.SURVIVOR
        assignment.status = SettlementStatus.PROOF_SUBMITTED
        db.add(assignment)
        db.commit()
    finally:
        db.close()

    confirm_response = admin_client.post(
        f"/api/v1/payments/settlements/{payload['id']}/confirm",
        headers={"Authorization": "Bearer test-token"},
    )
    assert confirm_response.status_code == 200

    db = SessionLocal()
    try:
        membership = db.query(SurvivorMembership).filter_by(
            season_id=SEASON_ID,
            profile_id=PROFILE_LEADER_ID,
        ).one()
        assert membership.is_paid is True
        assert membership.is_active is False
    finally:
        db.close()


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
            "season_membership_active": True,
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


def test_admin_create_user_does_not_auto_join_selected_season(
    admin_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    unique_suffix = uuid4().hex
    auth_user_id = str(uuid4())
    email = f"sin-alta-{unique_suffix}@example.com"

    class FakeSupabaseAdminService:
        def invite_user(self, *, email: str, display_name: str) -> AuthUser:
            return AuthUser(
                auth_user_id=auth_user_id,
                email=email,
                raw_claims={"user_metadata": {"display_name": display_name}},
            )

    monkeypatch.setattr(admin_routes, "supabase_admin_service", FakeSupabaseAdminService())

    response = admin_client.post(
        "/api/v1/admin/users",
        json={
            "email": email,
            "display_name": "Usuario Sin Alta",
            "season_id": SEASON_ID,
            "is_active": True,
            "is_paid": False,
            "modality": "pre_pago",
        },
        headers={"Authorization": "Bearer test-token"},
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["selected_season_membership"]["is_active"] is False
    assert payload["selected_season_membership"]["is_paid"] is False
    assert payload["season_memberships"] == []

    db = SessionLocal()
    try:
        membership = (
            db.query(SeasonMembership)
            .join(Profile, Profile.id == SeasonMembership.profile_id)
            .filter(Profile.email == email, SeasonMembership.season_id == SEASON_ID)
            .one_or_none()
        )
    finally:
        db.close()

    assert membership is None


def test_admin_can_create_user_without_season(
    admin_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    auth_user_id = str(uuid4())
    email = f"cuenta-global-{uuid4().hex}@example.com"

    class FakeSupabaseAdminService:
        def invite_user(self, *, email: str, display_name: str) -> AuthUser:
            return AuthUser(
                auth_user_id=auth_user_id,
                email=email,
                raw_claims={"user_metadata": {"display_name": display_name}},
            )

    monkeypatch.setattr(admin_routes, "supabase_admin_service", FakeSupabaseAdminService())

    response = admin_client.post(
        "/api/v1/admin/users",
        json={
            "email": email,
            "display_name": "Cuenta Global",
            "is_active": True,
            "is_paid": False,
            "modality": "pre_pago",
        },
        headers={"Authorization": "Bearer test-token"},
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["selected_season_membership"] is None
    assert payload["season_memberships"] == []


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
    assert membership.is_active is False
    assert membership.is_paid is True


def test_admin_can_capture_analytics_events_and_read_admin_stats(admin_client: TestClient) -> None:
    response = admin_client.post(
        "/api/v1/analytics/events",
        json={
            "category": "screen",
            "event_name": "screen_viewed",
            "route_path": "/dashboard/picks",
            "screen_name": "Picks",
            "season_id": SEASON_ID,
            "matchday_id": MATCHDAY_ID,
            "success": True,
        },
        headers={"Authorization": "Bearer test-token"},
    )
    assert response.status_code == 202

    response = admin_client.post(
        "/api/v1/analytics/events",
        json={
            "category": "screen",
            "event_name": "screen_loaded",
            "route_path": "/dashboard/picks",
            "screen_name": "Picks",
            "season_id": SEASON_ID,
            "matchday_id": MATCHDAY_ID,
            "success": True,
            "duration_ms": 1420,
        },
        headers={"Authorization": "Bearer test-token"},
    )
    assert response.status_code == 202

    response = admin_client.post(
        "/api/v1/analytics/events",
        json={
            "category": "action",
            "event_name": "pick_saved",
            "route_path": "/dashboard/picks",
            "screen_name": "Picks",
            "season_id": SEASON_ID,
            "matchday_id": MATCHDAY_ID,
            "success": True,
            "metadata": {"match_id": MATCH_ONE_ID},
        },
        headers={"Authorization": "Bearer test-token"},
    )
    assert response.status_code == 202

    response = admin_client.post(
        "/api/v1/analytics/events",
        json={
            "category": "screen",
            "event_name": "screen_load_failed",
            "route_path": "/dashboard/leaderboard",
            "screen_name": "Ranking",
            "season_id": SEASON_ID,
            "success": False,
            "metadata": {"message": "timeout"},
        },
        headers={"Authorization": "Bearer test-token"},
    )
    assert response.status_code == 202

    stats_response = admin_client.get(
        "/api/v1/admin/stats?days=7",
        headers={"Authorization": "Bearer test-token"},
    )

    assert stats_response.status_code == 200
    payload = stats_response.json()
    assert payload["kpis"]["total_events"] >= 4
    assert payload["kpis"]["screen_views"] >= 1
    assert payload["kpis"]["action_events"] >= 1
    assert payload["kpis"]["failure_events"] >= 1
    assert payload["selected_profile_id"] is None
    assert any(screen["screen_name"] == "Picks" for screen in payload["screens"])
    assert any(event["event_name"] == "pick_saved" for event in payload["top_events"])
    assert any(user["display_name"] == "Usuario Demo" for user in payload["users"])

    filtered_stats_response = admin_client.get(
        f"/api/v1/admin/stats?days=7&profile_id={PROFILE_USER_ID}",
        headers={"Authorization": "Bearer test-token"},
    )
    assert filtered_stats_response.status_code == 200
    filtered_payload = filtered_stats_response.json()
    assert filtered_payload["selected_profile_id"] == PROFILE_USER_ID
    assert filtered_payload["selected_profile_display_name"] == "Usuario Demo"
    assert filtered_payload["kpis"]["unique_users"] == 1
    assert all(event["profile_id"] == PROFILE_USER_ID for event in filtered_payload["recent_events"])

    db = SessionLocal()
    try:
        assert db.query(AnalyticsEvent).count() >= 4
    finally:
        db.close()


def test_admin_bulk_import_updates_existing_user_password(
    admin_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[str, str]] = []

    class FakeSupabaseAdminService:
        def update_user_password(self, *, auth_user_id: str, password: str) -> None:
            calls.append((auth_user_id, password))

    monkeypatch.setattr(admin_routes, "supabase_admin_service", FakeSupabaseAdminService())

    response = admin_client.post(
        "/api/v1/admin/users/bulk",
        json={
            "season_id": SEASON_ID,
            "send_invites": False,
            "csv_text": (
                "email,display_name,password,is_paid,modality,notes\n"
                "user@example.com,Usuario Existente,nueva123,true,pre_pago,Reset bulk\n"
            ),
        },
        headers={"Authorization": "Bearer test-token"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["created_or_updated"] == 1
    assert payload["failed"] == 0
    assert calls == [("11111111-1111-1111-1111-111111111111", "nueva123")]


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
