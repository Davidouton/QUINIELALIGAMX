from collections.abc import Generator
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest
from conftest import PROFILE_LEADER_ID, PROFILE_USER_ID, SEASON_ID, SessionLocal
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.api.deps import get_current_profile
from app.main import app
from app.models.entities import (
    PaymentScopeType,
    Profile,
    RoleCode,
    SettlementConfig,
    VipCompetition,
    VipMembership,
    VipWeeklyMatch,
    VipWeeklyPick,
)
from app.services.settlement_service import SettlementService


def _as_profile(profile_id: str = PROFILE_USER_ID, *, admin: bool = True) -> None:
    def current_profile() -> Profile:
        with SessionLocal() as db:
            profile = db.get(Profile, profile_id)
            assert profile is not None
            profile.role_code = RoleCode.ADMIN if admin else RoleCode.USER
            return profile

    app.dependency_overrides[get_current_profile] = current_profile


@pytest.fixture
def weekly_client() -> Generator[TestClient, None, None]:
    _as_profile()
    with TestClient(app, headers={"Authorization": "Bearer test-token"}) as client:
        yield client
    app.dependency_overrides.clear()


def _competition_payload(**overrides: object) -> dict:
    return {
        "competition_kind": "weekly_pool",
        "season_id": SEASON_ID,
        "name": "Quinielón Semanal de prueba",
        "entry_fee_amount": 150,
        "admin_commission_pct": 10,
        "first_place_pct": 90,
        "is_active": True,
        **overrides,
    }


def _create(client: TestClient) -> str:
    response = client.post("/api/v1/admin/vip", json=_competition_payload())
    assert response.status_code == 201, response.text
    assert response.json()["competition_kind"] == "weekly_pool"
    return response.json()["id"]


def _fixtures() -> list[dict]:
    starts_at = datetime.now(UTC) + timedelta(days=2)
    return [
        {
            "home_team": f"Local {number + 1}",
            "away_team": f"Visitante {number + 1}",
            "kickoff_at": (starts_at + timedelta(hours=number)).isoformat(),
            "is_tiebreaker": number == 9,
        }
        for number in range(10)
    ]


def _configure(client: TestClient, vip_id: str) -> list[dict]:
    response = client.put(
        f"/api/v1/admin/vip/{vip_id}/weekly/matches", json={"matches": _fixtures()}
    )
    assert response.status_code == 200, response.text
    payload = _public(client, vip_id)
    assert payload["weekly_ready"] is True
    assert len(payload["weekly_matches"]) == 10
    return payload["weekly_matches"]


def _add_member(client: TestClient, vip_id: str, profile_id: str, *, paid: bool = True) -> dict:
    response = client.post(
        f"/api/v1/admin/vip/{vip_id}/memberships",
        json={"profile_id": profile_id, "is_paid": paid},
    )
    assert response.status_code == 200, response.text
    return response.json()


def _public(client: TestClient, vip_id: str) -> dict:
    response = client.get("/api/v1/vip", params={"vip_id": vip_id})
    assert response.status_code == 200, response.text
    return next(row for row in response.json() if row["id"] == vip_id)


def _all_picks(matches: list[dict], *, total_goals: int) -> dict:
    return {
        "picks": [
            {
                "match_id": match["id"],
                "selection": "home",
                **({"total_goals": total_goals} if match["is_tiebreaker"] else {}),
            }
            for match in matches
        ]
    }


def test_weekly_pool_admin_config_has_ten_matches_and_individual_locks(
    weekly_client: TestClient,
) -> None:
    vip_id = _create(weekly_client)
    matches = _configure(weekly_client, vip_id)
    assert [match["sort_order"] for match in matches] == list(range(1, 11))
    assert sum(match["is_tiebreaker"] for match in matches) == 1
    for match in matches:
        kickoff_at = datetime.fromisoformat(match["kickoff_at"])
        lock_at = datetime.fromisoformat(match["lock_at"])
        assert kickoff_at - lock_at == timedelta(minutes=10)
        assert match["is_locked"] is False
    assert len({match["lock_at"] for match in matches}) == 10
    assert _public(weekly_client, vip_id)["weekly_ready"] is True


def test_weekly_pool_incomplete_setup_cannot_accept_entries_or_close(
    weekly_client: TestClient,
) -> None:
    vip_id = _create(weekly_client)
    bad_config = weekly_client.put(
        f"/api/v1/admin/vip/{vip_id}/weekly/matches", json={"matches": _fixtures()[:9]}
    )
    assert bad_config.status_code == 422
    early_close = weekly_client.post(f"/api/v1/admin/vip/{vip_id}/close")
    assert early_close.status_code == 409
    _as_profile(admin=False)
    join = weekly_client.post(f"/api/v1/vip/{vip_id}/request")
    assert join.status_code == 400
    with SessionLocal() as db:
        assert db.scalars(select(VipWeeklyMatch)).all() == []


def test_weekly_pool_configuration_and_results_require_administrator(
    weekly_client: TestClient,
) -> None:
    vip_id = _create(weekly_client)
    matches = _configure(weekly_client, vip_id)
    _as_profile(admin=False)
    create = weekly_client.post("/api/v1/admin/vip", json=_competition_payload())
    configure = weekly_client.put(
        f"/api/v1/admin/vip/{vip_id}/weekly/matches", json={"matches": _fixtures()}
    )
    results = weekly_client.put(
        f"/api/v1/admin/vip/{vip_id}/weekly/results",
        json={"results": [{"match_id": matches[0]["id"], "home_score": 1, "away_score": 0}]},
    )
    close = weekly_client.post(f"/api/v1/admin/vip/{vip_id}/close")
    assert [response.status_code for response in (create, configure, results, close)] == [
        403, 403, 403, 403
    ]


def test_weekly_pool_requires_approved_membership_and_reuses_entry_payments(
    weekly_client: TestClient,
) -> None:
    vip_id = _create(weekly_client)
    matches = _configure(weekly_client, vip_id)
    pick_payload = {"picks": [{"match_id": matches[0]["id"], "selection": "draw"}]}
    _as_profile(admin=False)
    denied = weekly_client.put(f"/api/v1/vip/{vip_id}/weekly/picks", json=pick_payload)
    assert denied.status_code == 403
    request = weekly_client.post(f"/api/v1/vip/{vip_id}/request")
    assert request.status_code == 200, request.text
    membership_id = request.json()["membership"]["id"]
    assert request.json()["membership"]["status"] == "pending"
    pending = weekly_client.put(f"/api/v1/vip/{vip_id}/weekly/picks", json=pick_payload)
    assert pending.status_code == 403

    _as_profile()
    approved = weekly_client.post(
        f"/api/v1/admin/vip/{vip_id}/memberships/{membership_id}/approve", json={}
    )
    assert approved.status_code == 200, approved.text
    paid = weekly_client.put(
        f"/api/v1/admin/vip/{vip_id}/memberships/{membership_id}/payment",
        json={"is_paid": True},
    )
    assert paid.status_code == 200, paid.text
    payload = _add_member(weekly_client, vip_id, PROFILE_LEADER_ID, paid=False)
    assert payload["approved_members_count"] == 2
    assert payload["gross_pool_amount"] == 300
    assert payload["admin_commission_amount"] == 30
    assert payload["first_place_amount"] == 270
    assert payload["remaining_pool_amount"] == 0

    _as_profile(admin=False)
    saved = weekly_client.put(f"/api/v1/vip/{vip_id}/weekly/picks", json=pick_payload)
    assert saved.status_code == 200, saved.text
    public = _public(weekly_client, vip_id)
    assert public["my_membership"]["is_paid"] is True
    assert public["weekly_matches"][0]["my_selection"] == "draw"
    _as_profile(PROFILE_LEADER_ID, admin=False)
    other = _public(weekly_client, vip_id)
    assert all(match["my_selection"] is None for match in other["weekly_matches"])


def test_weekly_pool_locked_match_rejects_entire_pick_batch_but_later_match_stays_open(
    weekly_client: TestClient,
) -> None:
    vip_id = _create(weekly_client)
    matches = _configure(weekly_client, vip_id)
    _add_member(weekly_client, vip_id, PROFILE_USER_ID)
    _as_profile(admin=False)
    initial = weekly_client.put(
        f"/api/v1/vip/{vip_id}/weekly/picks",
        json={"picks": [{"match_id": row["id"], "selection": "home"} for row in matches[:2]]},
    )
    assert initial.status_code == 200, initial.text
    with SessionLocal() as db:
        first = db.get(VipWeeklyMatch, matches[0]["id"])
        assert first is not None
        first.kickoff_at = datetime.now(UTC) + timedelta(minutes=9)
        db.commit()

    rejected = weekly_client.put(
        f"/api/v1/vip/{vip_id}/weekly/picks",
        json={
            "picks": [
                {"match_id": matches[1]["id"], "selection": "draw"},
                {"match_id": matches[0]["id"], "selection": "away"},
            ]
        },
    )
    assert rejected.status_code == 409
    public = _public(weekly_client, vip_id)
    assert public["weekly_matches"][0]["is_locked"] is True
    assert public["weekly_matches"][1]["is_locked"] is False
    assert [row["my_selection"] for row in public["weekly_matches"][:2]] == ["home", "home"]
    later = weekly_client.put(
        f"/api/v1/vip/{vip_id}/weekly/picks",
        json={"picks": [{"match_id": matches[1]["id"], "selection": "away"}]},
    )
    assert later.status_code == 200, later.text
    with SessionLocal() as db:
        assert len(db.scalars(select(VipWeeklyPick)).all()) == 2


def test_weekly_pool_official_results_recompute_rank_and_tiebreak_before_closing(
    weekly_client: TestClient,
) -> None:
    vip_id = _create(weekly_client)
    matches = _configure(weekly_client, vip_id)
    _add_member(weekly_client, vip_id, PROFILE_USER_ID)
    _add_member(weekly_client, vip_id, PROFILE_LEADER_ID)
    for profile_id, predicted_goals in ((PROFILE_USER_ID, 3), (PROFILE_LEADER_ID, 5)):
        _as_profile(profile_id, admin=False)
        response = weekly_client.put(
            f"/api/v1/vip/{vip_id}/weekly/picks",
            json=_all_picks(matches, total_goals=predicted_goals),
        )
        assert response.status_code == 200, response.text

    with SessionLocal() as db:
        for match in db.scalars(select(VipWeeklyMatch)).all():
            match.kickoff_at = datetime.now(UTC) - timedelta(days=1)
        db.commit()
    _as_profile()
    results = [
        {"match_id": match["id"], "home_score": 2, "away_score": 1} for match in matches
    ]
    partial = weekly_client.put(
        f"/api/v1/admin/vip/{vip_id}/weekly/results", json={"results": results[:9]}
    )
    assert partial.status_code == 200, partial.text
    assert weekly_client.post(f"/api/v1/admin/vip/{vip_id}/close").status_code == 409
    complete = weekly_client.put(
        f"/api/v1/admin/vip/{vip_id}/weekly/results", json={"results": results[9:]}
    )
    assert complete.status_code == 200, complete.text
    first_ranking = _public(weekly_client, vip_id)["leaderboard"]
    assert [row["total_points"] for row in first_ranking] == [10, 10]
    assert first_ranking[0]["profile_id"] == PROFILE_USER_ID
    assert first_ranking[0]["tiebreak_difference"] == 0
    assert first_ranking[1]["tiebreak_difference"] == 2
    assert [row["rank_position"] for row in first_ranking] == [1, 2]

    # Equal distance keeps a shared rank and the existing prize split applies.
    tied = weekly_client.put(
        f"/api/v1/admin/vip/{vip_id}/weekly/results",
        json={"results": [{"match_id": matches[9]["id"], "home_score": 3, "away_score": 1}]},
    )
    assert tied.status_code == 200, tied.text
    tied_ranking = _public(weekly_client, vip_id)["leaderboard"]
    assert [row["rank_position"] for row in tied_ranking] == [1, 1]
    assert [row["tiebreak_difference"] for row in tied_ranking] == [1, 1]
    with SessionLocal() as db:
        vip = db.get(VipCompetition, vip_id)
        assert vip is not None
        tied_participants = SettlementService()._build_vip_participants(db, vip)
        assert [row.final_prize_amount for row in tied_participants] == [
            Decimal("135.00"), Decimal("135.00")
        ]

    # Correcting the official total must invalidate any previously cached ranking.
    corrected = weekly_client.put(
        f"/api/v1/admin/vip/{vip_id}/weekly/results",
        json={"results": [{"match_id": matches[9]["id"], "home_score": 3, "away_score": 2}]},
    )
    assert corrected.status_code == 200, corrected.text
    final_ranking = _public(weekly_client, vip_id)["leaderboard"]
    assert final_ranking[0]["profile_id"] == PROFILE_LEADER_ID
    assert final_ranking[0]["tiebreak_difference"] == 0
    assert final_ranking[1]["tiebreak_difference"] == 2
    closed = weekly_client.post(f"/api/v1/admin/vip/{vip_id}/close")
    assert closed.status_code == 200, closed.text
    assert closed.json()["lifecycle_status"] == "closed_pending_payments"
    assert closed.json()["is_active"] is False
    with SessionLocal() as db:
        db.add(
            SettlementConfig(
                scope_type=PaymentScopeType.VIP,
                scope_id=vip_id,
                max_payment_amount=1_000_000,
                confirmation_window_hours=24,
                commission_recipient_profile_id=PROFILE_USER_ID,
            )
        )
        db.commit()
        vip = db.get(VipCompetition, vip_id)
        assert vip is not None
        participants = SettlementService()._build_vip_participants(db, vip)
        by_profile = {row.profile_id: row for row in participants}
        assert by_profile[PROFILE_LEADER_ID].rank_position == 1
        assert by_profile[PROFILE_LEADER_ID].final_prize_amount == Decimal("270.00")
        assert by_profile[PROFILE_USER_ID].final_prize_amount == Decimal("0.00")
        assert by_profile[PROFILE_USER_ID].admin_commission_amount == Decimal("30.00")
        assert sum(row.prize_amount for row in participants) == Decimal("300.00")


def test_weekly_pool_pick_cannot_reference_match_from_another_vip(
    weekly_client: TestClient,
) -> None:
    first_id = _create(weekly_client)
    _configure(weekly_client, first_id)
    second_id = _create(weekly_client)
    other_matches = _configure(weekly_client, second_id)
    _add_member(weekly_client, first_id, PROFILE_USER_ID)
    _as_profile(admin=False)
    response = weekly_client.put(
        f"/api/v1/vip/{first_id}/weekly/picks",
        json={"picks": [{"match_id": other_matches[0]["id"], "selection": "away"}]},
    )
    assert response.status_code == 404
    with SessionLocal() as db:
        assert db.scalars(select(VipWeeklyPick)).all() == []


def test_closed_weekly_pool_freezes_memberships_but_accepts_payment_updates(
    weekly_client: TestClient,
) -> None:
    vip_id = _create(weekly_client)
    matches = _configure(weekly_client, vip_id)
    added = _add_member(weekly_client, vip_id, PROFILE_USER_ID, paid=False)
    approved_id = next(
        row["id"] for row in added["memberships"] if row["profile_id"] == PROFILE_USER_ID
    )
    _as_profile(PROFILE_LEADER_ID, admin=False)
    requested = weekly_client.post(f"/api/v1/vip/{vip_id}/request")
    assert requested.status_code == 200, requested.text
    pending_id = requested.json()["membership"]["id"]

    with SessionLocal() as db:
        for match in db.scalars(select(VipWeeklyMatch)).all():
            match.kickoff_at = datetime.now(UTC) - timedelta(days=1)
        db.commit()
    _as_profile()
    results = weekly_client.put(
        f"/api/v1/admin/vip/{vip_id}/weekly/results",
        json={
            "results": [
                {"match_id": row["id"], "home_score": 1, "away_score": 0}
                for row in matches
            ]
        },
    )
    assert results.status_code == 200, results.text
    closed = weekly_client.post(f"/api/v1/admin/vip/{vip_id}/close")
    assert closed.status_code == 200, closed.text

    add = weekly_client.post(
        f"/api/v1/admin/vip/{vip_id}/memberships",
        json={"profile_id": PROFILE_LEADER_ID, "is_paid": True},
    )
    approve = weekly_client.post(
        f"/api/v1/admin/vip/{vip_id}/memberships/{pending_id}/approve", json={}
    )
    reject = weekly_client.post(
        f"/api/v1/admin/vip/{vip_id}/memberships/{pending_id}/reject", json={}
    )
    remove = weekly_client.post(
        f"/api/v1/admin/vip/{vip_id}/memberships/{approved_id}/remove", json={}
    )
    assert [row.status_code for row in (add, approve, reject, remove)] == [409] * 4

    paid = weekly_client.put(
        f"/api/v1/admin/vip/{vip_id}/memberships/{approved_id}/payment",
        json={"is_paid": True},
    )
    assert paid.status_code == 200, paid.text
    assert paid.json()["gross_pool_amount"] == 150
    memberships = {row["id"]: row for row in paid.json()["memberships"]}
    assert memberships[approved_id]["status"] == "approved"
    assert memberships[approved_id]["is_paid"] is True
    assert memberships[pending_id]["status"] == "pending"


def test_weekly_pool_mode_cannot_change_after_accepting_a_participant(
    weekly_client: TestClient,
) -> None:
    vip_id = _create(weekly_client)
    _configure(weekly_client, vip_id)
    _add_member(weekly_client, vip_id, PROFILE_USER_ID)
    changed = weekly_client.put(
        f"/api/v1/admin/vip/{vip_id}",
        json=_competition_payload(
            competition_kind="question_pool",
            questions_lock_at=(datetime.now(UTC) + timedelta(days=3)).isoformat(),
        ),
    )
    assert changed.status_code == 409
    unchanged = _public(weekly_client, vip_id)
    assert unchanged["competition_kind"] == "weekly_pool"
    assert unchanged["approved_members_count"] == 1
    assert len(unchanged["weekly_matches"]) == 10


@pytest.mark.parametrize("setup", ["draft", "configured", "with_picks"])
def test_deleting_weekly_pool_removes_only_its_matches_and_picks(
    weekly_client: TestClient, setup: str,
) -> None:
    vip_id = _create(weekly_client)
    if setup != "draft":
        matches = _configure(weekly_client, vip_id)
        if setup == "with_picks":
            _add_member(weekly_client, vip_id, PROFILE_USER_ID)
            _as_profile(admin=False)
            saved = weekly_client.put(
                f"/api/v1/vip/{vip_id}/weekly/picks",
                json=_all_picks(matches, total_goals=3),
            )
            assert saved.status_code == 200, saved.text
            _as_profile()
    other_id = _create(weekly_client)
    _configure(weekly_client, other_id)

    deleted = weekly_client.delete(f"/api/v1/admin/vip/{vip_id}")
    assert deleted.status_code == 204, deleted.text
    with SessionLocal() as db:
        assert db.get(VipCompetition, vip_id) is None
        assert db.get(VipCompetition, other_id) is not None
        assert db.scalars(select(VipWeeklyPick)).all() == []
        assert db.scalars(select(VipMembership)).all() == []
        remaining_matches = db.scalars(select(VipWeeklyMatch)).all()
        assert len(remaining_matches) == 10
        assert all(row.vip_competition_id == other_id for row in remaining_matches)
