from datetime import UTC, datetime, timedelta
import json
from uuid import uuid4

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import func, select

from app.models.entities import (
    Payment, PaymentScopeType, PaymentStatus, Profile, VipCompetition, VipCompetitionKind, VipMembership,
    VipMembershipStatus, VipWeeklyMatch, VipWeeklyPick,
)
from app.schemas.vip import (
    AdminVipUpsertRequest, AdminVipWeeklyMatchesRequest, AdminVipWeeklyResultsRequest,
    VipWeeklyPicksRequest,
)
from app.services.weekly_pool_service import WeeklyPoolService
from app.services.payment_service import PaymentService
from conftest import PROFILE_LEADER_ID, PROFILE_USER_ID, SEASON_ID, SessionLocal

NOW = datetime(2031, 1, 5, 12, tzinfo=UTC)


def match_payload():
    return {"matches": [{
        "home_team": f"Local {index}", "away_team": f"Visitante {index}",
        "kickoff_at": NOW + timedelta(hours=index + 1), "is_tiebreaker": index == 0,
    } for index in range(10)]}


@pytest.fixture
def weekly(monkeypatch):
    db = SessionLocal()
    service = WeeklyPoolService()
    monkeypatch.setattr(service, "_now", lambda: NOW)
    vip = VipCompetition(
        season_id=SEASON_ID, competition_kind=VipCompetitionKind.WEEKLY_POOL,
        name="Quinielón Semanal", entry_fee_amount=100, first_place_pct=100,
    )
    db.add(vip)
    db.flush()
    db.add_all([VipMembership(
        vip_competition_id=vip.id, profile_id=profile_id,
        status=VipMembershipStatus.APPROVED,
    ) for profile_id in (PROFILE_USER_ID, PROFILE_LEADER_ID)])
    db.commit()
    service.configure_matches(db, vip.id, AdminVipWeeklyMatchesRequest.model_validate(match_payload()))
    yield db, service, vip
    db.close()


def rows(db, vip):
    return list(db.scalars(select(VipWeeklyMatch).where(
        VipWeeklyMatch.vip_competition_id == vip.id,
    ).order_by(VipWeeklyMatch.sort_order)))


def pick_payload(match, *, selection="home", goals=None):
    return VipWeeklyPicksRequest.model_validate({"picks": [{
        "match_id": match.id, "selection": selection, "total_goals": goals,
    }]})


def configure_payload(matches):
    return AdminVipWeeklyMatchesRequest.model_validate({"matches": [{
        "id": match.id, "home_team": match.home_team, "away_team": match.away_team,
        "kickoff_at": match.kickoff_at.replace(tzinfo=UTC), "is_tiebreaker": match.is_tiebreaker,
    } for match in matches]})


def result_payload(match, home=2, away=1):
    return AdminVipWeeklyResultsRequest.model_validate({"results": [{
        "match_id": match.id, "home_score": home, "away_score": away,
    }]})


@pytest.mark.parametrize("mutation", [
    "nine", "eleven", "no_tiebreak", "two_tiebreaks", "naive", "empty_team",
    "same_team", "duplicate_fixture", "duplicate_id", "unknown_field",
])
def test_configuration_validation(mutation):
    payload = match_payload()
    if mutation == "nine":
        payload["matches"].pop()
    elif mutation == "eleven":
        payload["matches"].append(payload["matches"][-1])
    elif mutation == "no_tiebreak":
        payload["matches"][0]["is_tiebreaker"] = False
    elif mutation == "two_tiebreaks":
        payload["matches"][1]["is_tiebreaker"] = True
    elif mutation == "naive":
        payload["matches"][0]["kickoff_at"] = NOW.replace(tzinfo=None)
    elif mutation == "empty_team":
        payload["matches"][0]["home_team"] = "  "
    elif mutation == "same_team":
        payload["matches"][0]["home_team"] = " Visitante 0 "
    elif mutation == "duplicate_fixture":
        payload["matches"][1] = dict(payload["matches"][2])
    elif mutation == "duplicate_id":
        payload["matches"][0]["id"] = payload["matches"][1]["id"] = str(uuid4())
    else:
        payload["matches"][0]["home_score"] = 3
    with pytest.raises(ValidationError):
        AdminVipWeeklyMatchesRequest.model_validate(payload)


def test_weekly_kind_does_not_require_season():
    request = AdminVipUpsertRequest(competition_kind="weekly_pool", name="Semanal")
    assert request.season_id is None
    assert request.matchday_ids == []


def test_configuration_ready_and_individual_lock_dates(weekly):
    db, service, vip = weekly
    matches = service.match_outs(db, vip.id)
    assert service.ready(db, vip.id)
    assert len(matches) == 10
    assert matches[0].lock_at == NOW + timedelta(minutes=50)
    assert matches[1].lock_at == NOW + timedelta(hours=1, minutes=50)
    assert all(not row.is_locked for row in matches)
    assert service.join_lock(db, vip.id)["lock_at"] == matches[0].lock_at


def test_unconfigured_weekly_is_not_ready_and_cannot_join(weekly):
    db, service, _ = weekly
    vip = VipCompetition(season_id=SEASON_ID, competition_kind="weekly_pool", name="Sin configurar")
    db.add(vip)
    db.commit()
    assert not service.ready(db, vip.id)
    assert service.join_lock(db, vip.id)["locked"] is True
    with pytest.raises(HTTPException, match="10 partidos"):
        service.validate_close(db, vip.id)


def test_pick_closes_exactly_ten_minutes_before_but_later_game_remains_open(weekly, monkeypatch):
    db, service, vip = weekly
    first, later = rows(db, vip)[:2]
    user = db.get(Profile, PROFILE_USER_ID)
    lock_at = NOW + timedelta(minutes=50)
    monkeypatch.setattr(service, "_now", lambda: lock_at - timedelta(microseconds=1))
    service.save_picks(db, vip.id, user, pick_payload(first, goals=3))
    monkeypatch.setattr(service, "_now", lambda: lock_at)
    with pytest.raises(HTTPException) as error:
        service.save_picks(db, vip.id, user, pick_payload(first, selection="draw", goals=2))
    assert error.value.status_code == 409
    assert service.join_lock(db, vip.id)["locked"] is True
    service.save_picks(db, vip.id, user, pick_payload(later, selection="away"))
    assert [row.my_selection for row in service.match_outs(db, vip.id, user.id)[:2]] == ["home", "away"]


@pytest.mark.parametrize("membership_status", ["pending", "rejected", "missing"])
def test_only_approved_members_can_pick(weekly, membership_status):
    db, service, vip = weekly
    membership = db.scalar(select(VipMembership).where(
        VipMembership.vip_competition_id == vip.id, VipMembership.profile_id == PROFILE_USER_ID,
    ))
    if membership_status == "missing":
        db.delete(membership)
    else:
        membership.status = membership_status
    db.commit()
    with pytest.raises(HTTPException) as error:
        service.save_picks(db, vip.id, db.get(Profile, PROFILE_USER_ID), pick_payload(rows(db, vip)[0], goals=3))
    assert error.value.status_code == 403
    assert db.scalar(select(func.count()).select_from(VipWeeklyPick)) == 0


@pytest.mark.parametrize("inactive", [True, False])
def test_inactive_or_closed_weekly_rejects_picks(weekly, inactive):
    db, service, vip = weekly
    if inactive:
        vip.is_active = False
    else:
        vip.lifecycle_status = "closed_pending_payments"
    db.commit()
    with pytest.raises(HTTPException) as error:
        service.save_picks(db, vip.id, db.get(Profile, PROFILE_USER_ID), pick_payload(rows(db, vip)[0], goals=3))
    assert error.value.status_code == 409


def test_repeated_save_updates_only_own_pick(weekly):
    db, service, vip = weekly
    first = rows(db, vip)[0]
    user = db.get(Profile, PROFILE_USER_ID)
    leader = db.get(Profile, PROFILE_LEADER_ID)
    service.save_picks(db, vip.id, user, pick_payload(first, goals=3))
    service.save_picks(db, vip.id, leader, pick_payload(first, selection="away", goals=4))
    service.save_picks(db, vip.id, user, pick_payload(first, selection="draw", goals=2))
    assert db.scalar(select(func.count()).select_from(VipWeeklyPick)) == 2
    assert service.match_outs(db, vip.id, user.id)[0].my_selection == "draw"
    assert service.match_outs(db, vip.id, leader.id)[0].my_selection == "away"
    assert service.match_outs(db, vip.id)[0].my_selection is None


def test_foreign_match_rejects_entire_pick_batch(weekly):
    db, service, vip = weekly
    first = rows(db, vip)[0]
    payload = VipWeeklyPicksRequest.model_validate({"picks": [
        {"match_id": first.id, "selection": "home", "total_goals": 2},
        {"match_id": str(uuid4()), "selection": "home"},
    ]})
    with pytest.raises(HTTPException) as error:
        service.save_picks(db, vip.id, db.get(Profile, PROFILE_USER_ID), payload)
    assert error.value.status_code == 404
    assert db.scalar(select(func.count()).select_from(VipWeeklyPick)) == 0


def test_total_goals_only_allowed_and_required_for_designated_match(weekly):
    db, service, vip = weekly
    first, other = rows(db, vip)[:2]
    user = db.get(Profile, PROFILE_USER_ID)
    for match, goals in [(first, None), (other, 2)]:
        with pytest.raises(HTTPException) as error:
            service.save_picks(db, vip.id, user, pick_payload(match, goals=goals))
        assert error.value.status_code == 400


@pytest.mark.parametrize("goals", [-1, 100, 1.5, True])
def test_goals_reject_invalid_number(goals):
    with pytest.raises(ValidationError):
        VipWeeklyPicksRequest.model_validate({"picks": [{
            "match_id": str(uuid4()), "selection": "home", "total_goals": goals,
        }]})


def test_configuration_can_be_reordered_before_participation(weekly):
    db, service, vip = weekly
    current = rows(db, vip)
    expected_ids = [match.id for match in reversed(current)]
    service.configure_matches(db, vip.id, configure_payload(list(reversed(current))))
    assert [match.id for match in rows(db, vip)] == expected_ids
    assert service.join_lock(db, vip.id)["lock_at"] == NOW + timedelta(minutes=50)


def test_first_pick_freezes_configuration_but_exact_save_is_allowed(weekly):
    db, service, vip = weekly
    current = rows(db, vip)
    service.save_picks(db, vip.id, db.get(Profile, PROFILE_USER_ID), pick_payload(current[0], goals=3))
    identical = configure_payload(current)
    service.configure_matches(db, vip.id, identical)
    changed = identical.model_copy(deep=True)
    changed.matches[1].home_team = "Equipo diferente"
    with pytest.raises(HTTPException) as error:
        service.configure_matches(db, vip.id, changed)
    assert error.value.status_code == 409
    assert service.match_outs(db, vip.id, PROFILE_USER_ID)[0].my_total_goals == 3


def test_elapsed_first_lock_freezes_configuration_even_without_picks(weekly, monkeypatch):
    db, service, vip = weekly
    changed = configure_payload(rows(db, vip))
    changed.matches[2].is_tiebreaker = True
    changed.matches[0].is_tiebreaker = False
    monkeypatch.setattr(service, "_now", lambda: NOW + timedelta(minutes=50))
    with pytest.raises(HTTPException) as error:
        service.configure_matches(db, vip.id, changed)
    assert error.value.status_code == 409


def test_new_configuration_must_leave_more_than_ten_minutes(weekly):
    db, service, vip = weekly
    payload = configure_payload(rows(db, vip))
    payload.matches[0].kickoff_at = NOW + timedelta(minutes=10)
    with pytest.raises(HTTPException) as error:
        service.configure_matches(db, vip.id, payload)
    assert error.value.status_code == 400


def test_results_reject_future_matches_and_batch_is_atomic(weekly, monkeypatch):
    db, service, vip = weekly
    first, later = rows(db, vip)[:2]
    with pytest.raises(HTTPException) as error:
        service.save_results(db, vip.id, result_payload(first))
    assert error.value.status_code == 409
    monkeypatch.setattr(service, "_now", lambda: NOW + timedelta(hours=1))
    payload = AdminVipWeeklyResultsRequest.model_validate({"results": [
        {"match_id": first.id, "home_score": 2, "away_score": 1},
        {"match_id": later.id, "home_score": 0, "away_score": 0},
    ]})
    with pytest.raises(HTTPException):
        service.save_results(db, vip.id, payload)
    assert all(match.home_score is None for match in rows(db, vip))


def test_results_can_be_corrected_while_active_but_not_after_close(weekly, monkeypatch):
    db, service, vip = weekly
    first = rows(db, vip)[0]
    monkeypatch.setattr(service, "_now", lambda: NOW + timedelta(hours=1))
    service.save_results(db, vip.id, result_payload(first))
    service.save_results(db, vip.id, result_payload(first, 1, 3))
    assert service.match_outs(db, vip.id)[0].away_score == 3
    vip.lifecycle_status = "closed_pending_payments"
    db.commit()
    with pytest.raises(HTTPException) as error:
        service.save_results(db, vip.id, result_payload(first, 5, 0))
    assert error.value.status_code == 409


def test_ranking_uses_all_outcomes_one_point_each_and_keeps_zero_member(weekly, monkeypatch):
    db, service, vip = weekly
    matches = rows(db, vip)
    user = db.get(Profile, PROFILE_USER_ID)
    for match, selection in zip(matches[:3], ["home", "draw", "away"]):
        service.save_picks(db, vip.id, user, pick_payload(
            match, selection=selection, goals=3 if match.is_tiebreaker else None,
        ))
    monkeypatch.setattr(service, "_now", lambda: NOW + timedelta(hours=4))
    for match, scores in zip(matches[:3], [(2, 1), (1, 1), (0, 1)]):
        service.save_results(db, vip.id, result_payload(match, *scores))
    ranking = service.leaderboard(db, vip.id, [user.id, PROFILE_LEADER_ID], {user.id: "Usuario"})
    assert [(row.total_points, row.correct_results, row.rank_position) for row in ranking] == [(3, 3, 1), (0, 0, 2)]
    assert ranking[0].tiebreak_difference == 0


def test_tie_prediction_hidden_until_designated_game_lock(weekly, monkeypatch):
    db, service, vip = weekly
    first = rows(db, vip)[0]
    service.save_picks(db, vip.id, db.get(Profile, PROFILE_USER_ID), pick_payload(first, goals=5))
    assert service.leaderboard(db, vip.id, [PROFILE_USER_ID], {})[0].tiebreak_prediction is None
    assert service.match_outs(db, vip.id, PROFILE_USER_ID)[0].my_total_goals == 5
    monkeypatch.setattr(service, "_now", lambda: NOW + timedelta(minutes=50))
    row = service.leaderboard(db, vip.id, [PROFILE_USER_ID], {})[0]
    assert row.tiebreak_prediction == 5
    assert row.tiebreak_difference is None


def test_equal_goal_distance_shares_rank_and_missing_tie_loses(weekly, monkeypatch):
    db, service, vip = weekly
    first, second = rows(db, vip)[:2]
    third = Profile(
        auth_user_id=str(uuid4()), email="third@example.com", display_name="Tercero",
    )
    db.add(third)
    db.flush()
    db.add(VipMembership(vip_competition_id=vip.id, profile_id=third.id, status="approved"))
    db.commit()
    for profile_id, prediction in [(PROFILE_USER_ID, 2), (PROFILE_LEADER_ID, 4)]:
        service.save_picks(db, vip.id, db.get(Profile, profile_id), pick_payload(first, goals=prediction))
    service.save_picks(db, vip.id, third, pick_payload(second))
    monkeypatch.setattr(service, "_now", lambda: NOW + timedelta(hours=3))
    for match in [first, second]:
        service.save_results(db, vip.id, result_payload(match, 2, 1))
    ranked = service.leaderboard(db, vip.id, [PROFILE_USER_ID, PROFILE_LEADER_ID, third.id], {})
    assert [row.total_points for row in ranked] == [1, 1, 1]
    assert [row.rank_position for row in ranked] == [1, 1, 3]
    assert [row.tiebreak_difference for row in ranked] == [1, 1, None]
    assert ranked[-1].profile_id == third.id


def test_better_goal_distance_wins_even_if_alphabetically_last(weekly, monkeypatch):
    db, service, vip = weekly
    first = rows(db, vip)[0]
    for profile_id, prediction in [(PROFILE_USER_ID, 7), (PROFILE_LEADER_ID, 3)]:
        service.save_picks(db, vip.id, db.get(Profile, profile_id), pick_payload(first, goals=prediction))
    monkeypatch.setattr(service, "_now", lambda: NOW + timedelta(hours=1))
    service.save_results(db, vip.id, result_payload(first))
    ranked = service.leaderboard(db, vip.id, [PROFILE_USER_ID, PROFILE_LEADER_ID], {
        PROFILE_USER_ID: "AAA", PROFILE_LEADER_ID: "ZZZ",
    })
    assert [row.profile_id for row in ranked] == [PROFILE_LEADER_ID, PROFILE_USER_ID]
    assert [row.rank_position for row in ranked] == [1, 2]


def test_close_requires_ten_complete_results(weekly, monkeypatch):
    db, service, vip = weekly
    matches = rows(db, vip)
    monkeypatch.setattr(service, "_now", lambda: NOW + timedelta(hours=11))
    for match in matches[:-1]:
        service.save_results(db, vip.id, result_payload(match, 0, 0))
    with pytest.raises(HTTPException) as error:
        service.validate_close(db, vip.id)
    assert error.value.status_code == 409
    service.save_results(db, vip.id, result_payload(matches[-1], 0, 0))
    service.validate_close(db, vip.id)


@pytest.mark.parametrize("schema,key,item", [
    (VipWeeklyPicksRequest, "picks", {"selection": "home"}),
    (AdminVipWeeklyResultsRequest, "results", {"home_score": 0, "away_score": 0}),
])
def test_duplicate_batch_matches_are_rejected(schema, key, item):
    row = {"match_id": str(uuid4()), **item}
    with pytest.raises(ValidationError):
        schema.model_validate({key: [row, row]})


@pytest.mark.parametrize("lifecycle", ["closed_pending_payments", "settled", "archived"])
@pytest.mark.parametrize("membership_status", ["missing", "pending", "rejected", "approved"])
def test_late_checkout_keeps_payment_without_changing_closed_weekly_participants(
    weekly, lifecycle, membership_status,
):
    db, _, vip = weekly
    vip.lifecycle_status = lifecycle
    vip.is_active = False
    user = db.get(Profile, PROFILE_USER_ID)
    user.modality = "aval"
    user.aval_profile_id = PROFILE_LEADER_ID
    membership = db.scalar(select(VipMembership).where(
        VipMembership.vip_competition_id == vip.id, VipMembership.profile_id == user.id,
    ))
    if membership_status == "missing":
        db.delete(membership)
    else:
        membership.status = membership_status
    payment = Payment(
        profile_id=user.id, scope_type=PaymentScopeType.VIP, scope_id=vip.id,
        amount=100, stripe_checkout_session_id="test_weekly_checkout", status=PaymentStatus.CHECKOUT_CREATED,
    )
    db.add(payment)
    db.commit()
    before_count = db.scalar(select(func.count()).select_from(VipMembership).where(
        VipMembership.vip_competition_id == vip.id,
        VipMembership.status == VipMembershipStatus.APPROVED,
    ))
    service = PaymentService()
    service._mark_checkout_completed(db, {"id": "test_weekly_checkout"}, {"id": "evt_weekly_test"})
    db.refresh(payment)
    db.refresh(vip)
    assert payment.status == PaymentStatus.PAID
    assert payment.paid_at is not None
    assert vip.lifecycle_status == lifecycle
    updated = db.scalar(select(VipMembership).where(
        VipMembership.vip_competition_id == vip.id, VipMembership.profile_id == user.id,
    ))
    if membership_status == "missing":
        assert updated is None
    else:
        assert updated.status == membership_status
        assert updated.is_paid is (membership_status == "approved")
    after_count = db.scalar(select(func.count()).select_from(VipMembership).where(
        VipMembership.vip_competition_id == vip.id,
        VipMembership.status == VipMembershipStatus.APPROVED,
    ))
    assert before_count == after_count
    metadata = json.loads(payment.metadata_json)
    assert metadata["last_webhook_event"]["id"] == "evt_weekly_test"
    if membership_status != "approved":
        expected_reason = "vip_archived" if lifecycle == "archived" else "weekly_pool_closed"
        assert metadata["entitlement_review_required"] == expected_reason
    # Stripe retries remain idempotent after the confirmed payment is retained.
    service._mark_checkout_completed(db, {"id": "test_weekly_checkout"}, {"id": "evt_weekly_retry"})
    assert payment.status == PaymentStatus.PAID


@pytest.mark.parametrize("kind,lifecycle", [
    (VipCompetitionKind.MATCHDAY, "closed_pending_payments"),
    (VipCompetitionKind.TEAM_WINNER, "active"),
    (VipCompetitionKind.QUESTION_POOL, "active"),
])
def test_other_vip_modes_keep_paid_aval_approval(weekly, kind, lifecycle):
    db, _, vip = weekly
    vip.competition_kind = kind
    vip.lifecycle_status = lifecycle
    user = db.get(Profile, PROFILE_USER_ID)
    user.modality = "aval"
    user.aval_profile_id = PROFILE_LEADER_ID
    membership = db.scalar(select(VipMembership).where(
        VipMembership.vip_competition_id == vip.id, VipMembership.profile_id == user.id,
    ))
    membership.status = VipMembershipStatus.PENDING
    payment = Payment(
        profile_id=user.id, scope_type=PaymentScopeType.VIP, scope_id=vip.id,
        amount=100, stripe_checkout_session_id="test_weekly_checkout", status=PaymentStatus.CHECKOUT_CREATED,
    )
    db.add(payment)
    db.commit()
    PaymentService()._mark_checkout_completed(db, {"id": "test_weekly_checkout"}, {})
    db.refresh(membership)
    assert membership.status == VipMembershipStatus.APPROVED
    assert membership.is_paid is True
