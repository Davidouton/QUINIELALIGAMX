from datetime import UTC, datetime, timedelta

import pytest
from conftest import PROFILE_LEADER_ID, PROFILE_USER_ID, SessionLocal
from sqlalchemy import select
from test_weekly_pool_integration import _as_profile

from app.models.entities import (
    Payment,
    PaymentScopeType,
    PaymentStatus,
    Profile,
    VipCompetition,
    VipCompetitionKind,
    VipMembership,
    VipMembershipStatus,
    VipWeeklyMatch,
)
from app.schemas.vip import AdminVipMembershipDecisionRequest, AdminVipWeeklyMatchesRequest
from app.services.payment_service import PaymentService
from app.services.vip_service import VipService
from app.services.weekly_pool_service import WeeklyPoolService


@pytest.fixture
def weekly_checkout():
    with SessionLocal() as db:
        vip = VipCompetition(
            competition_kind=VipCompetitionKind.WEEKLY_POOL,
            name="Quinielón con aprobación admin",
            entry_fee_amount=100,
            first_place_pct=100,
        )
        db.add(vip)
        db.commit()
        starts_at = datetime.now(UTC) + timedelta(days=2)
        WeeklyPoolService().configure_matches(db, vip.id, AdminVipWeeklyMatchesRequest.model_validate({
            "matches": [{
                "home_team": f"Local {index}",
                "away_team": f"Visitante {index}",
                "kickoff_at": starts_at + timedelta(hours=index),
                "is_tiebreaker": index == 9,
            } for index in range(10)],
        }))
        yield db, vip, db.get(Profile, PROFILE_USER_ID)


def _checkout(db, vip, user):
    payment = Payment(
        profile_id=user.id,
        scope_type=PaymentScopeType.VIP,
        scope_id=vip.id,
        amount=100,
        stripe_checkout_session_id="checkout_weekly_approval",
        status=PaymentStatus.CHECKOUT_CREATED,
    )
    db.add(payment)
    db.commit()
    return payment


def _complete(db, payment, event_id="evt_weekly_approval"):
    PaymentService()._mark_checkout_completed(
        db, {"id": payment.stripe_checkout_session_id}, {"id": event_id},
    )
    db.refresh(payment)
    assert payment.status == PaymentStatus.PAID
    assert payment.paid_at is not None


@pytest.mark.parametrize("has_aval", [False, True])
@pytest.mark.parametrize("membership_status", [None, "pending", "approved", "rejected"])
def test_weekly_payment_never_approves_or_changes_admin_decision(
    weekly_checkout, has_aval, membership_status,
):
    db, vip, user = weekly_checkout
    if has_aval:
        user.modality = "aval"
        user.aval_profile_id = PROFILE_LEADER_ID
    if membership_status is not None:
        membership = VipMembership(
            vip_competition_id=vip.id,
            profile_id=user.id,
            status=membership_status,
            admin_note="Nota existente",
        )
        if membership_status in {"approved", "rejected"}:
            membership.decided_at = datetime.now(UTC) - timedelta(hours=1)
            membership.decided_by_profile_id = PROFILE_LEADER_ID
        db.add(membership)
    payment = _checkout(db, vip, user)
    previous_decision = None
    if membership_status is not None:
        db.refresh(membership)
        previous_decision = (
            membership.decided_at, membership.decided_by_profile_id, membership.admin_note,
        )

    _complete(db, payment)
    saved = db.scalar(select(VipMembership).where(
        VipMembership.vip_competition_id == vip.id, VipMembership.profile_id == user.id,
    ))
    assert saved.status == (membership_status or "pending")
    assert saved.is_paid is True
    if previous_decision is not None:
        assert (saved.decided_at, saved.decided_by_profile_id, saved.admin_note) == previous_decision
    else:
        assert saved.decided_at is None
        assert saved.decided_by_profile_id is None
    public = VipService().list_public_vips(db, user, vip_id=vip.id)[0]
    assert public.approved_members_count == (1 if membership_status == "approved" else 0)
    assert public.gross_pool_amount == (100 if membership_status == "approved" else 0)


@pytest.mark.parametrize("decision", [VipMembershipStatus.APPROVED, VipMembershipStatus.REJECTED])
def test_weekly_duplicate_webhook_preserves_subsequent_admin_decision(weekly_checkout, decision):
    db, vip, user = weekly_checkout
    user.modality = "aval"
    user.aval_profile_id = PROFILE_LEADER_ID
    payment = _checkout(db, vip, user)
    _complete(db, payment)
    membership = db.scalar(select(VipMembership).where(
        VipMembership.vip_competition_id == vip.id, VipMembership.profile_id == user.id,
    ))
    assert membership.status == VipMembershipStatus.PENDING
    admin = db.get(Profile, PROFILE_LEADER_ID)
    VipService().decide_membership(
        db, vip.id, membership.id, decision, admin,
        AdminVipMembershipDecisionRequest(admin_note="Decisión explícita"),
    )
    previous = (membership.decided_at, membership.decided_by_profile_id, membership.admin_note)
    _complete(db, payment, "evt_weekly_approval_retry")
    db.refresh(membership)
    assert membership.status == decision
    assert membership.is_paid is True
    assert (membership.decided_at, membership.decided_by_profile_id, membership.admin_note) == previous


@pytest.mark.parametrize("has_aval", [False, True])
def test_weekly_paid_request_stays_blocked_until_explicit_admin_approval(
    client, weekly_checkout, has_aval,
):
    db, vip, user = weekly_checkout
    if has_aval:
        user.modality = "aval"
        user.aval_profile_id = PROFILE_LEADER_ID
        db.commit()
    requested = client.post(f"/api/v1/vip/{vip.id}/request")
    assert requested.status_code == 200, requested.text
    assert requested.json()["membership"]["status"] == "pending"
    membership_id = requested.json()["membership"]["id"]
    payment = _checkout(db, vip, user)
    _complete(db, payment)
    match = db.scalar(select(VipWeeklyMatch).where(
        VipWeeklyMatch.vip_competition_id == vip.id, VipWeeklyMatch.is_tiebreaker.is_(False),
    ))
    payload = {"picks": [{"match_id": match.id, "selection": "home"}]}
    blocked = client.put(f"/api/v1/vip/{vip.id}/weekly/picks", json=payload)
    assert blocked.status_code == 403
    attempted_approval = client.post(
        f"/api/v1/admin/vip/{vip.id}/memberships/{membership_id}/approve", json={},
    )
    assert attempted_approval.status_code == 403
    attempted_add = client.post(
        f"/api/v1/admin/vip/{vip.id}/memberships", json={"profile_id": user.id, "is_paid": True},
    )
    assert attempted_add.status_code == 403

    _as_profile(PROFILE_LEADER_ID)
    payment_only = client.put(
        f"/api/v1/admin/vip/{vip.id}/memberships/{membership_id}/payment", json={"is_paid": True},
    )
    assert payment_only.status_code == 400
    approved = client.post(
        f"/api/v1/admin/vip/{vip.id}/memberships/{membership_id}/approve", json={},
    )
    assert approved.status_code == 200, approved.text
    _as_profile(admin=False)
    allowed = client.put(f"/api/v1/vip/{vip.id}/weekly/picks", json=payload)
    assert allowed.status_code == 200, allowed.text
