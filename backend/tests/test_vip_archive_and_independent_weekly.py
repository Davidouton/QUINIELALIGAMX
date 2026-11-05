from collections.abc import Generator
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest
from conftest import (
    MATCHDAY_ID,
    PROFILE_LEADER_ID,
    PROFILE_USER_ID,
    SEASON_ID,
    TEAM_A_ID,
    TEAM_B_ID,
    SessionLocal,
)
from fastapi.testclient import TestClient
from sqlalchemy import delete, select
from test_weekly_pool_integration import (
    _add_member,
    _all_picks,
    _as_profile,
    _configure,
    _public,
)

from app.api.deps import get_current_profile
from app.main import app
from app.models.entities import (
    Match,
    Matchday,
    Payment,
    PaymentScopeType,
    PaymentStatus,
    Season,
    SeasonMembership,
    SeasonVisibilityStatus,
    SettlementAssignment,
    SettlementStatus,
    StandingsOverall,
    VipCompetition,
    VipMembership,
    VipWeeklyMatch,
    VipWeeklyPick,
)
from app.services.settlement_service import SettlementService


@pytest.fixture
def archive_client() -> Generator[TestClient, None, None]:
    _as_profile()
    with TestClient(app, headers={"Authorization": "Bearer test-token"}) as client:
        yield client
    app.dependency_overrides.pop(get_current_profile, None)


def _create(client: TestClient, **overrides: object) -> dict:
    response = client.post(
        "/api/v1/admin/vip",
        json={
            "competition_kind": "weekly_pool",
            "name": "Quinielón Semanal independiente",
            "entry_fee_amount": 150,
            "admin_commission_pct": 10,
            "first_place_pct": 90,
            "is_active": True,
            **overrides,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_weekly_pool_can_be_created_without_any_season(archive_client: TestClient) -> None:
    with SessionLocal() as db:
        for model in (StandingsOverall, SeasonMembership, Match, Matchday, Season):
            db.execute(delete(model))
        db.commit()
        assert db.scalars(select(Season)).all() == []

    created = _create(archive_client)
    assert created["season_id"] is None
    assert created["season_name"] is None
    assert created["matchdays"] == []
    matches = _configure(archive_client, created["id"])
    assert len(matches) == 10
    public = _public(archive_client, created["id"])
    assert public["season_id"] is None
    assert public["season_visibility_status"] == "live"


@pytest.mark.parametrize("season_id", [SEASON_ID, "20000000-0000-0000-0000-000000000099"])
def test_weekly_pool_ignores_a_supplied_season(archive_client: TestClient, season_id: str) -> None:
    created = _create(archive_client, season_id=season_id)
    assert created["season_id"] is None
    assert created["season_name"] is None
    with SessionLocal() as db:
        vip = db.get(VipCompetition, created["id"])
        assert vip is not None
        assert vip.season_id is None


@pytest.mark.parametrize("kind", ["team_winner", "question_pool"])
def test_other_vip_modes_still_require_a_season(archive_client: TestClient, kind: str) -> None:
    response = archive_client.post(
        "/api/v1/admin/vip",
        json={
            "competition_kind": kind,
            "name": "VIP con temporada obligatoria",
            "questions_lock_at": (datetime.now(UTC) + timedelta(days=2)).isoformat(),
        },
    )
    assert response.status_code == 422


def test_archiving_a_season_does_not_hide_or_close_an_independent_weekly_pool(
    archive_client: TestClient,
) -> None:
    created = _create(archive_client, season_id=SEASON_ID)
    vip_id = created["id"]
    _configure(archive_client, vip_id)
    with SessionLocal() as db:
        season = db.get(Season, SEASON_ID)
        assert season is not None
        season.visibility_status = SeasonVisibilityStatus.ARCHIVED
        season.is_active = False
        db.commit()
    _as_profile(admin=False)
    public = _public(archive_client, vip_id)
    assert public["season_id"] is None
    assert public["season_visibility_status"] == "live"
    assert public["is_archived"] is False
    joined = archive_client.post(f"/api/v1/vip/{vip_id}/request")
    assert joined.status_code == 200, joined.text


def test_archiving_and_restoring_active_weekly_pool_preserves_data_and_state(
    archive_client: TestClient,
) -> None:
    vip_id = _create(archive_client)["id"]
    matches = _configure(archive_client, vip_id)
    added = _add_member(archive_client, vip_id, PROFILE_USER_ID, paid=False)
    membership_id = added["memberships"][0]["id"]
    _as_profile(admin=False)
    saved = archive_client.put(
        f"/api/v1/vip/{vip_id}/weekly/picks", json=_all_picks(matches, total_goals=3)
    )
    assert saved.status_code == 200, saved.text
    _as_profile()
    archived = archive_client.post(f"/api/v1/admin/vip/{vip_id}/archive")
    assert archived.status_code == 200, archived.text
    payload = archived.json()
    assert payload["archived_at"] is not None
    assert payload["is_archived"] is True
    assert payload["lifecycle_status"] == "active"
    assert payload["is_active"] is True
    assert payload["gross_pool_amount"] == 150
    assert len(payload["weekly_matches"]) == 10
    repeated = archive_client.post(f"/api/v1/admin/vip/{vip_id}/archive")
    assert repeated.status_code == 200, repeated.text
    assert repeated.json()["archived_at"] == payload["archived_at"]

    admin_list = archive_client.get("/api/v1/admin/vip")
    assert admin_list.status_code == 200
    assert next(row for row in admin_list.json() if row["id"] == vip_id)["is_archived"]
    _as_profile(admin=False)
    public = _public(archive_client, vip_id)
    assert public["is_archived"] is True
    current_list = archive_client.get("/api/v1/vip", params={"include_archived": False})
    assert current_list.status_code == 200, current_list.text
    assert vip_id not in {row["id"] for row in current_list.json()}
    dashboard = archive_client.get("/api/v1/me/dashboard-home", params={"season_id": SEASON_ID})
    assert dashboard.status_code == 200, dashboard.text
    assert vip_id not in {row["id"] for row in dashboard.json()["vip_competitions"]}
    assert all(row["my_selection"] == "home" for row in public["weekly_matches"])
    assert all(row["is_locked"] for row in public["weekly_matches"])
    blocked_pick = archive_client.put(
        f"/api/v1/vip/{vip_id}/weekly/picks",
        json={"picks": [{"match_id": matches[0]["id"], "selection": "away"}]},
    )
    assert blocked_pick.status_code == 409
    _as_profile(PROFILE_LEADER_ID, admin=False)
    blocked_join = archive_client.post(f"/api/v1/vip/{vip_id}/request")
    assert blocked_join.status_code in {404, 409}

    _as_profile()
    blocked_member = archive_client.post(
        f"/api/v1/admin/vip/{vip_id}/memberships",
        json={"profile_id": PROFILE_LEADER_ID},
    )
    assert blocked_member.status_code == 409
    payment = archive_client.put(
        f"/api/v1/admin/vip/{vip_id}/memberships/{membership_id}/payment",
        json={"is_paid": True},
    )
    assert payment.status_code == 200, payment.text
    assert payment.json()["is_archived"] is True
    assert payment.json()["gross_pool_amount"] == 150
    with SessionLocal() as db:
        assert len(db.scalars(select(VipWeeklyPick)).all()) == 10
        assert len(db.scalars(select(VipMembership)).all()) == 1

    restored = archive_client.post(f"/api/v1/admin/vip/{vip_id}/restore")
    assert restored.status_code == 200, restored.text
    assert restored.json()["is_archived"] is False
    assert restored.json()["archived_at"] is None
    assert restored.json()["lifecycle_status"] == "active"
    assert restored.json()["is_active"] is True
    _as_profile(admin=False)
    editable = archive_client.put(
        f"/api/v1/vip/{vip_id}/weekly/picks",
        json={"picks": [{"match_id": matches[0]["id"], "selection": "away"}]},
    )
    assert editable.status_code == 200, editable.text
    _as_profile(PROFILE_LEADER_ID, admin=False)
    joined = archive_client.post(f"/api/v1/vip/{vip_id}/request")
    assert joined.status_code == 200, joined.text


def test_archived_weekly_pool_keeps_results_debts_and_can_finish_settlement(
    archive_client: TestClient,
) -> None:
    vip_id = _create(archive_client)["id"]
    matches = _configure(archive_client, vip_id)
    added = _add_member(archive_client, vip_id, PROFILE_USER_ID, paid=False)
    membership_id = added["memberships"][0]["id"]
    _add_member(archive_client, vip_id, PROFILE_LEADER_ID, paid=False)
    for profile_id, total_goals in ((PROFILE_USER_ID, 3), (PROFILE_LEADER_ID, 5)):
        _as_profile(profile_id, admin=False)
        saved = archive_client.put(
            f"/api/v1/vip/{vip_id}/weekly/picks", json=_all_picks(matches, total_goals=total_goals)
        )
        assert saved.status_code == 200, saved.text
    with SessionLocal() as db:
        for match in db.scalars(select(VipWeeklyMatch)).all():
            match.kickoff_at = datetime.now(UTC) - timedelta(days=1)
        db.commit()
    _as_profile()
    results = archive_client.put(
        f"/api/v1/admin/vip/{vip_id}/weekly/results",
        json={"results": [
            {"match_id": row["id"], "home_score": 2, "away_score": 1} for row in matches
        ]},
    )
    assert results.status_code == 200, results.text
    closed = archive_client.post(f"/api/v1/admin/vip/{vip_id}/close")
    assert closed.status_code == 200, closed.text
    archived = archive_client.post(f"/api/v1/admin/vip/{vip_id}/archive")
    assert archived.status_code == 200, archived.text
    assert archived.json()["lifecycle_status"] == "closed_pending_payments"
    assert archived.json()["is_active"] is False
    assert archived.json()["gross_pool_amount"] == 300
    assert archived.json()["leaderboard"] == closed.json()["leaderboard"]
    assert all(row["home_score"] == 2 for row in archived.json()["weekly_matches"])
    paid = archive_client.put(
        f"/api/v1/admin/vip/{vip_id}/memberships/{membership_id}/payment",
        json={"is_paid": True},
    )
    assert paid.status_code == 200, paid.text
    with SessionLocal() as db:
        vip = db.get(VipCompetition, vip_id)
        assert vip is not None
        participants = SettlementService()._build_vip_participants(db, vip)
        by_profile = {row.profile_id: row for row in participants}
        assert by_profile[PROFILE_USER_ID].final_prize_amount == Decimal("270.00")
        assert by_profile[PROFILE_USER_ID].pending_entry_amount == Decimal("0.00")
        assert by_profile[PROFILE_LEADER_ID].pending_entry_amount == Decimal("150.00")
        db.add(SettlementAssignment(
            scope_type=PaymentScopeType.VIP,
            scope_id=vip_id,
            payer_profile_id=PROFILE_LEADER_ID,
            payee_profile_id=PROFILE_USER_ID,
            amount=150,
            status=SettlementStatus.CONFIRMED,
        ))
        db.commit()
        SettlementService()._sync_vip_lifecycle_status(db, vip_id)
        db.refresh(vip)
        assert vip.lifecycle_status == "settled"
        assert vip.archived_at is not None
        assert vip.is_active is False
    restored = archive_client.post(f"/api/v1/admin/vip/{vip_id}/restore")
    assert restored.status_code == 200, restored.text
    assert restored.json()["lifecycle_status"] == "settled"
    assert restored.json()["is_active"] is False
    assert restored.json()["is_archived"] is False


def test_independent_weekly_membership_and_payments_stay_in_personal_history(
    archive_client: TestClient,
) -> None:
    vip_id = _create(archive_client)["id"]
    _configure(archive_client, vip_id)
    added = _add_member(archive_client, vip_id, PROFILE_USER_ID)
    membership_id = added["memberships"][0]["id"]
    with SessionLocal() as db:
        payment = Payment(
            profile_id=PROFILE_USER_ID,
            scope_type=PaymentScopeType.VIP,
            scope_id=vip_id,
            amount=150,
            status=PaymentStatus.PAID,
        )
        db.add(payment)
        db.commit()
        payment_id = payment.id
    archived = archive_client.post(f"/api/v1/admin/vip/{vip_id}/archive")
    assert archived.status_code == 200, archived.text
    _as_profile(admin=False)
    history = archive_client.get("/api/v1/me/membership-history")
    assert history.status_code == 200, history.text
    row = next(row for row in history.json() if row["id"] == membership_id)
    assert row["membership_type"] == "vip"
    assert row["is_paid"] is True
    payments = archive_client.get("/api/v1/payments/my-payments")
    assert payments.status_code == 200, payments.text
    assert next(row for row in payments.json() if row["id"] == payment_id)["scope_id"] == vip_id


def test_legacy_archived_vip_restores_as_settled_without_reopening(
    archive_client: TestClient,
) -> None:
    vip_id = _create(archive_client)["id"]
    with SessionLocal() as db:
        vip = db.get(VipCompetition, vip_id)
        assert vip is not None
        vip.lifecycle_status = "archived"
        vip.is_active = False
        db.commit()
    legacy = archive_client.get(f"/api/v1/admin/vip/{vip_id}")
    assert legacy.status_code == 200
    assert legacy.json()["is_archived"] is True
    restored = archive_client.post(f"/api/v1/admin/vip/{vip_id}/restore")
    assert restored.status_code == 200, restored.text
    assert restored.json()["is_archived"] is False
    assert restored.json()["lifecycle_status"] == "settled"
    assert restored.json()["is_active"] is False


def test_only_administrators_can_archive_and_restore_vips(archive_client: TestClient) -> None:
    vip_id = _create(archive_client)["id"]
    _as_profile(admin=False)
    archive = archive_client.post(f"/api/v1/admin/vip/{vip_id}/archive")
    restore = archive_client.post(f"/api/v1/admin/vip/{vip_id}/restore")
    assert archive.status_code == 403
    assert restore.status_code == 403


@pytest.mark.parametrize("kind", ["matchday", "team_winner", "question_pool"])
def test_existing_vip_modes_can_be_archived_without_marking_them_settled(
    archive_client: TestClient, kind: str,
) -> None:
    created = _create(
        archive_client,
        competition_kind=kind,
        season_id=SEASON_ID,
        matchday_ids=[MATCHDAY_ID] if kind == "matchday" else [],
        questions_lock_at=(datetime.now(UTC) + timedelta(days=2)).isoformat(),
    )
    vip_id = created["id"]
    archived = archive_client.post(f"/api/v1/admin/vip/{vip_id}/archive")
    assert archived.status_code == 200, archived.text
    assert archived.json()["season_id"] == SEASON_ID
    assert archived.json()["is_archived"] is True
    assert archived.json()["lifecycle_status"] == "active"
    assert archived.json()["is_active"] is True
    restored = archive_client.post(f"/api/v1/admin/vip/{vip_id}/restore")
    assert restored.status_code == 200, restored.text
    assert restored.json()["is_archived"] is False
    assert restored.json()["lifecycle_status"] == "active"


def test_archived_question_pool_freezes_answers_questions_and_correct_options(
    archive_client: TestClient,
) -> None:
    vip_id = _create(
        archive_client,
        competition_kind="question_pool",
        season_id=SEASON_ID,
        questions_lock_at=(datetime.now(UTC) + timedelta(days=2)).isoformat(),
    )["id"]
    _add_member(archive_client, vip_id, PROFILE_USER_ID)
    question_payload = {"prompt": "¿Quién gana?", "options": ["Local", "Visitante"]}
    configured = archive_client.post(
        f"/api/v1/admin/vip/{vip_id}/questions", json=question_payload
    )
    assert configured.status_code == 200, configured.text
    question = configured.json()["question_pool_questions"][0]
    question_id = question["id"]
    first_option = question["options"][0]["id"]
    second_option = question["options"][1]["id"]
    _as_profile(admin=False)
    answered = archive_client.put(
        f"/api/v1/vip/{vip_id}/questions/{question_id}/response",
        json={"option_id": first_option},
    )
    assert answered.status_code == 200, answered.text
    _as_profile()
    archived = archive_client.post(f"/api/v1/admin/vip/{vip_id}/archive")
    assert archived.status_code == 200, archived.text
    new_question = archive_client.post(
        f"/api/v1/admin/vip/{vip_id}/questions", json=question_payload
    )
    correct_option = archive_client.put(
        f"/api/v1/admin/vip/{vip_id}/questions/{question_id}/correct-option",
        json={"option_id": second_option},
    )
    assert new_question.status_code == 409
    assert correct_option.status_code == 409
    _as_profile(admin=False)
    new_answer = archive_client.put(
        f"/api/v1/vip/{vip_id}/questions/{question_id}/response",
        json={"option_id": second_option},
    )
    assert new_answer.status_code == 409
    questions = _public(archive_client, vip_id)["question_pool_questions"]
    assert len(questions) == 1
    assert questions[0]["selected_option_id"] == first_option


def test_archived_team_winner_freezes_draw_but_allows_entry_payment(
    archive_client: TestClient,
) -> None:
    vip_id = _create(
        archive_client, competition_kind="team_winner", season_id=SEASON_ID
    )["id"]
    _add_member(archive_client, vip_id, PROFILE_USER_ID, paid=False)
    config_payload = {
        "team_ids": [TEAM_A_ID, TEAM_B_ID],
        "profile_ids": [PROFILE_USER_ID],
        "include_house": True,
    }
    configured = archive_client.put(
        f"/api/v1/admin/vip/{vip_id}/team-winner/config", json=config_payload
    )
    assert configured.status_code == 200, configured.text
    entry_id = next(
        row["id"] for row in configured.json()["team_winner_entries"]
        if row["profile_id"] == PROFILE_USER_ID
    )
    archived = archive_client.post(f"/api/v1/admin/vip/{vip_id}/archive")
    assert archived.status_code == 200, archived.text
    reconfigured = archive_client.put(
        f"/api/v1/admin/vip/{vip_id}/team-winner/config", json=config_payload
    )
    draw = archive_client.post(f"/api/v1/admin/vip/{vip_id}/team-winner/draw")
    reset = archive_client.post(f"/api/v1/admin/vip/{vip_id}/team-winner/reset-draw")
    assert [row.status_code for row in (reconfigured, draw, reset)] == [409, 409, 409]
    paid = archive_client.put(
        f"/api/v1/admin/vip/{vip_id}/team-winner/entries/{entry_id}/payment",
        json={"is_paid": True},
    )
    assert paid.status_code == 200, paid.text
    assert paid.json()["is_archived"] is True
    assert next(row for row in paid.json()["team_winner_entries"] if row["id"] == entry_id)[
        "is_paid"
    ] is True
