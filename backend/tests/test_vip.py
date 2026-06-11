from collections.abc import Generator
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from app.api.deps import get_current_profile
from app.main import app
from app.models.entities import (
    Matchday,
    MatchdayStatus,
    Profile,
    RoleCode,
    Season,
    StandingsMatchday,
    VipMembership,
    VipMembershipStatus,
)

from conftest import MATCHDAY_ID, PROFILE_LEADER_ID, PROFILE_USER_ID, SEASON_ID, SessionLocal


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


def test_admin_can_create_vip_and_approve_request_with_leaderboard() -> None:
    second_matchday_id = "30000000-0000-0000-0000-000000000002"

    db = SessionLocal()
    try:
        db.add(
            Matchday(
                id=second_matchday_id,
                season_id=SEASON_ID,
                number=4,
                name="Jornada 4",
                status=MatchdayStatus.PUBLISHED,
                starts_at=datetime.now(UTC) + timedelta(days=4),
                ends_at=datetime.now(UTC) + timedelta(days=7),
            )
        )
        db.add_all(
            [
                StandingsMatchday(
                    matchday_id=MATCHDAY_ID,
                    profile_id=PROFILE_USER_ID,
                    total_points=8,
                    correct_results=2,
                    exact_scores=1,
                    rank_position=1,
                ),
                StandingsMatchday(
                    matchday_id=second_matchday_id,
                    profile_id=PROFILE_USER_ID,
                    total_points=6,
                    correct_results=2,
                    exact_scores=0,
                    rank_position=1,
                ),
                StandingsMatchday(
                    matchday_id=MATCHDAY_ID,
                    profile_id=PROFILE_LEADER_ID,
                    total_points=5,
                    correct_results=1,
                    exact_scores=1,
                    rank_position=2,
                ),
                StandingsMatchday(
                    matchday_id=second_matchday_id,
                    profile_id=PROFILE_LEADER_ID,
                    total_points=5,
                    correct_results=1,
                    exact_scores=0,
                    rank_position=2,
                ),
            ]
        )
        db.commit()
    finally:
        db.close()

    def override_admin_profile() -> Profile:
        db = SessionLocal()
        try:
            profile = db.get(Profile, PROFILE_USER_ID)
            assert profile is not None
            profile.role_code = RoleCode.ADMIN
            return profile
        finally:
            db.close()

    app.dependency_overrides[get_current_profile] = override_admin_profile
    with TestClient(app) as admin_client:
        create_response = admin_client.post(
            "/api/v1/admin/vip",
            json={
                "name": "VIP Clausura",
                "entry_fee_amount": 750,
                "admin_commission_pct": 10,
                "first_place_pct": 50,
                "second_place_pct": 30,
                "third_place_pct": 20,
                "matchday_ids": [MATCHDAY_ID, second_matchday_id],
                "is_active": True,
            },
            headers={"Authorization": "Bearer test-token"},
        )

        assert create_response.status_code == 201
        vip_payload = create_response.json()
        vip_id = vip_payload["id"]
        assert vip_payload["matchdays"][0]["id"] == MATCHDAY_ID
        assert vip_payload["pending_requests_count"] == 0
        assert vip_payload["gross_pool_amount"] == 0

    def override_user_profile() -> Profile:
        db = SessionLocal()
        try:
            profile = db.get(Profile, PROFILE_USER_ID)
            assert profile is not None
            return profile
        finally:
            db.close()

    app.dependency_overrides.clear()
    app.dependency_overrides[get_current_profile] = override_user_profile
    with TestClient(app) as user_client:
        request_response = user_client.post(
            f"/api/v1/vip/{vip_id}/request",
            headers={"Authorization": "Bearer test-token"},
        )

        assert request_response.status_code == 200
        assert request_response.json()["membership"]["status"] == "pending"

    db = SessionLocal()
    try:
        leader_membership = VipMembership(
            vip_competition_id=vip_id,
            profile_id=PROFILE_LEADER_ID,
            status=VipMembershipStatus.APPROVED,
        )
        db.add(leader_membership)
        db.commit()

        pending_membership = db.query(VipMembership).filter_by(vip_competition_id=vip_id, profile_id=PROFILE_USER_ID).one()
        pending_membership_id = pending_membership.id
    finally:
        db.close()

    app.dependency_overrides.clear()
    app.dependency_overrides[get_current_profile] = override_admin_profile
    with TestClient(app) as admin_client:
        approve_response = admin_client.post(
            f"/api/v1/admin/vip/{vip_id}/memberships/{pending_membership_id}/approve",
            json={},
            headers={"Authorization": "Bearer test-token"},
        )

        assert approve_response.status_code == 200
        approved_payload = approve_response.json()
        assert approved_payload["approved_members_count"] == 2
        assert approved_payload["pending_requests_count"] == 0
        assert approved_payload["leaderboard"][0]["profile_id"] == PROFILE_USER_ID
        assert approved_payload["leaderboard"][0]["total_points"] == 14
        assert approved_payload["leaderboard"][1]["profile_id"] == PROFILE_LEADER_ID
        assert approved_payload["leaderboard"][1]["total_points"] == 10
        assert approved_payload["gross_pool_amount"] == 1500
        assert approved_payload["admin_commission_amount"] == 150
        assert approved_payload["distributable_prize_pool_amount"] == 1350
        assert approved_payload["first_place_amount"] == 675
        assert approved_payload["second_place_amount"] == 405
        assert approved_payload["third_place_amount"] == 270
        assert approved_payload["remaining_pool_amount"] == 0

    app.dependency_overrides.clear()
    app.dependency_overrides[get_current_profile] = override_user_profile
    with TestClient(app) as user_client:
        public_response = user_client.get(
            "/api/v1/vip",
            headers={"Authorization": "Bearer test-token"},
        )

        assert public_response.status_code == 200
        public_payload = public_response.json()
        assert len(public_payload) == 1
        assert public_payload[0]["my_membership"]["status"] == "approved"
        assert public_payload[0]["leaderboard"][0]["rank_position"] == 1
        assert public_payload[0]["first_place_amount"] == 675

    app.dependency_overrides.clear()


def test_admin_cannot_create_vip_with_mixed_season_matchdays(admin_client: TestClient) -> None:
    second_season_id = "20000000-0000-0000-0000-000000000099"
    second_matchday_id = "30000000-0000-0000-0000-000000000099"

    db = SessionLocal()
    try:
        db.add(Season(id=second_season_id, name="Apertura 2026", slug="apertura-2026", is_active=False))
        db.add(
            Matchday(
                id=second_matchday_id,
                season_id=second_season_id,
                number=1,
                name="Jornada 1",
                status=MatchdayStatus.DRAFT,
                starts_at=datetime.now(UTC) + timedelta(days=10),
                ends_at=datetime.now(UTC) + timedelta(days=12),
            )
        )
        db.commit()
    finally:
        db.close()

    response = admin_client.post(
        "/api/v1/admin/vip",
        json={
            "name": "VIP Invalida",
            "entry_fee_amount": 300,
            "admin_commission_pct": 10,
            "first_place_pct": 50,
            "second_place_pct": 30,
            "third_place_pct": 20,
            "matchday_ids": [MATCHDAY_ID, second_matchday_id],
            "is_active": True,
        },
        headers={"Authorization": "Bearer test-token"},
    )

    assert response.status_code == 400
    assert "misma temporada" in response.text


def test_admin_can_remove_approved_vip_member(admin_client: TestClient) -> None:
    create_response = admin_client.post(
        "/api/v1/admin/vip",
        json={
            "name": "VIP Removibles",
            "entry_fee_amount": 500,
            "admin_commission_pct": 0,
            "first_place_pct": 100,
            "second_place_pct": 0,
            "third_place_pct": 0,
            "matchday_ids": [MATCHDAY_ID],
            "is_active": True,
        },
        headers={"Authorization": "Bearer test-token"},
    )
    assert create_response.status_code == 201
    vip_id = create_response.json()["id"]

    db = SessionLocal()
    try:
        membership = VipMembership(
            vip_competition_id=vip_id,
            profile_id=PROFILE_LEADER_ID,
            status=VipMembershipStatus.APPROVED,
        )
        db.add(membership)
        db.add(
            StandingsMatchday(
                matchday_id=MATCHDAY_ID,
                profile_id=PROFILE_LEADER_ID,
                total_points=7,
                correct_results=2,
                exact_scores=1,
                rank_position=1,
            )
        )
        db.commit()
        membership_id = membership.id
    finally:
        db.close()

    remove_response = admin_client.post(
        f"/api/v1/admin/vip/{vip_id}/memberships/{membership_id}/remove",
        json={"admin_note": "Pago reversado"},
        headers={"Authorization": "Bearer test-token"},
    )

    assert remove_response.status_code == 200
    payload = remove_response.json()
    assert payload["approved_members_count"] == 0
    assert payload["gross_pool_amount"] == 0
    assert payload["leaderboard"] == []
    removed_membership = next(membership for membership in payload["memberships"] if membership["id"] == membership_id)
    assert removed_membership["status"] == "rejected"
    assert removed_membership["admin_note"] == "Pago reversado"


def test_admin_can_track_vip_member_payment(admin_client: TestClient) -> None:
    create_response = admin_client.post(
        "/api/v1/admin/vip",
        json={
            "name": "VIP Pagos",
            "entry_fee_amount": 500,
            "admin_commission_pct": 0,
            "first_place_pct": 100,
            "second_place_pct": 0,
            "third_place_pct": 0,
            "matchday_ids": [MATCHDAY_ID],
            "is_active": True,
        },
        headers={"Authorization": "Bearer test-token"},
    )
    assert create_response.status_code == 201
    vip_id = create_response.json()["id"]

    db = SessionLocal()
    try:
        membership = VipMembership(
            vip_competition_id=vip_id,
            profile_id=PROFILE_LEADER_ID,
            status=VipMembershipStatus.APPROVED,
            is_paid=False,
        )
        db.add(membership)
        db.commit()
        membership_id = membership.id
    finally:
        db.close()

    paid_response = admin_client.put(
        f"/api/v1/admin/vip/{vip_id}/memberships/{membership_id}/payment",
        json={"is_paid": True},
        headers={"Authorization": "Bearer test-token"},
    )

    assert paid_response.status_code == 200
    paid_membership = next(
        membership for membership in paid_response.json()["memberships"] if membership["id"] == membership_id
    )
    assert paid_membership["is_paid"] is True
    assert paid_membership["admin_note"] == "Pago VIP confirmado por admin"

    pending_response = admin_client.post(
        f"/api/v1/admin/vip/{vip_id}/memberships/{membership_id}/payment",
        json={"is_paid": False, "admin_note": "Pendiente transferencia"},
        headers={"Authorization": "Bearer test-token"},
    )

    assert pending_response.status_code == 200
    pending_membership = next(
        membership for membership in pending_response.json()["memberships"] if membership["id"] == membership_id
    )
    assert pending_membership["is_paid"] is False
    assert pending_membership["admin_note"] == "Pendiente transferencia"


def test_admin_cannot_create_vip_with_prize_split_over_100(admin_client: TestClient) -> None:
    response = admin_client.post(
        "/api/v1/admin/vip",
        json={
            "name": "VIP Exceso",
            "entry_fee_amount": 300,
            "admin_commission_pct": 10,
            "first_place_pct": 60,
            "second_place_pct": 30,
            "third_place_pct": 20,
            "matchday_ids": [MATCHDAY_ID],
            "is_active": True,
        },
        headers={"Authorization": "Bearer test-token"},
    )

    assert response.status_code == 422
    assert "no puede rebasar 100%" in response.text
