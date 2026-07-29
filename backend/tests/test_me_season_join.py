from app.core.database import SessionLocal
from app.models.entities import Profile, Season, SeasonMembership

from conftest import PROFILE_USER_ID, SEASON_ID


def test_join_season_activates_aval_users_automatically(client) -> None:
    db = SessionLocal()
    try:
        membership = db.query(SeasonMembership).filter(
            SeasonMembership.profile_id == PROFILE_USER_ID,
            SeasonMembership.season_id == SEASON_ID,
        ).one()
        db.delete(membership)
        profile = db.get(Profile, PROFILE_USER_ID)
        assert profile is not None
        profile.modality = "aval"
        profile.aval_profile_id = "10000000-0000-0000-0000-000000000002"
        db.add(profile)
        db.commit()
    finally:
        db.close()

    response = client.post(f"/api/v1/me/seasons/{SEASON_ID}/join")
    assert response.status_code == 200
    payload = response.json()
    assert payload["selected_season_membership"]["is_active"] is True
    assert payload["selected_season_membership"]["can_participate"] is True
    assert payload["can_participate_selected_season"] is True


def test_join_season_leaves_pre_pago_users_pending_admin_authorization(client) -> None:
    db = SessionLocal()
    try:
        membership = db.query(SeasonMembership).filter(
            SeasonMembership.profile_id == PROFILE_USER_ID,
            SeasonMembership.season_id == SEASON_ID,
        ).one()
        db.delete(membership)
        profile = db.get(Profile, PROFILE_USER_ID)
        assert profile is not None
        profile.modality = "pre_pago"
        profile.aval_profile_id = None
        db.add(profile)
        db.commit()
    finally:
        db.close()

    response = client.post(f"/api/v1/me/seasons/{SEASON_ID}/join")
    assert response.status_code == 200
    payload = response.json()
    assert payload["selected_season_membership"]["is_active"] is False
    assert payload["selected_season_membership"]["is_rejected"] is False
    assert payload["selected_season_membership"]["can_participate"] is False
    assert payload["can_participate_selected_season"] is False


def test_bootstrap_exposes_rejected_season_membership(client) -> None:
    db = SessionLocal()
    try:
        membership = db.query(SeasonMembership).filter(
            SeasonMembership.profile_id == PROFILE_USER_ID,
            SeasonMembership.season_id == SEASON_ID,
        ).one()
        membership.is_active = False
        membership.is_rejected = True
        db.add(membership)
        db.commit()
    finally:
        db.close()

    response = client.get("/api/v1/bootstrap")
    assert response.status_code == 200
    membership_payload = next(
        row for row in response.json()["me"]["season_memberships"] if row["season_id"] == SEASON_ID
    )
    assert membership_payload["is_rejected"] is True


def test_join_season_requires_an_assigned_aval_for_automatic_activation(client) -> None:
    db = SessionLocal()
    try:
        membership = db.query(SeasonMembership).filter(
            SeasonMembership.profile_id == PROFILE_USER_ID,
            SeasonMembership.season_id == SEASON_ID,
        ).one()
        db.delete(membership)
        profile = db.get(Profile, PROFILE_USER_ID)
        assert profile is not None
        profile.modality = "aval"
        profile.aval_profile_id = None
        db.add(profile)
        db.commit()
    finally:
        db.close()

    response = client.post(f"/api/v1/me/seasons/{SEASON_ID}/join")
    assert response.status_code == 200
    payload = response.json()
    assert payload["selected_season_membership"]["is_active"] is False
    assert payload["can_participate_selected_season"] is False


def test_get_me_preserves_admin_deactivation_for_aval_membership(client) -> None:
    db = SessionLocal()
    try:
        membership = db.query(SeasonMembership).filter(
            SeasonMembership.profile_id == PROFILE_USER_ID,
            SeasonMembership.season_id == SEASON_ID,
        ).one()
        membership.is_active = False
        membership.eligible_for_scoring = False
        membership.activated_at = None
        profile = db.get(Profile, PROFILE_USER_ID)
        assert profile is not None
        profile.modality = "aval"
        profile.aval_profile_id = "10000000-0000-0000-0000-000000000002"
        db.add_all([membership, profile])
        db.commit()
    finally:
        db.close()

    response = client.get(f"/api/v1/me?season_id={SEASON_ID}")
    assert response.status_code == 200
    payload = response.json()
    assert payload["selected_season_membership"]["is_active"] is False
    assert payload["selected_season_membership"]["can_participate"] is False
    assert payload["can_participate_selected_season"] is False


def test_join_season_rejects_when_admin_closed_registration(client) -> None:
    db = SessionLocal()
    try:
        season = db.get(Season, SEASON_ID)
        assert season is not None
        season.registration_closed = True
        db.add(season)
        db.commit()
    finally:
        db.close()

    response = client.post(f"/api/v1/me/seasons/{SEASON_ID}/join")
    assert response.status_code == 400
    assert response.json()["detail"] == "El registro de esta liga fue cerrado por administracion"
