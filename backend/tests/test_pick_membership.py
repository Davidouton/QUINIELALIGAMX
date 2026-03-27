from app.models.entities import SeasonMembership

from conftest import PROFILE_USER_ID, SEASON_ID, SessionLocal, USER_MEMBERSHIP_ID


def test_user_cannot_create_pick_without_active_season_membership(client) -> None:
    db = SessionLocal()
    try:
        membership = db.get(SeasonMembership, USER_MEMBERSHIP_ID)
        assert membership is not None
        membership.is_active = False
        db.add(membership)
        db.commit()
    finally:
        db.close()

    response = client.post(
        "/api/v1/picks",
        json={
            "match_id": "50000000-0000-0000-0000-000000000001",
            "selection": "home",
            "predicted_home_score": 2,
            "predicted_away_score": 1,
        },
        headers={"Authorization": "Bearer test-token"},
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "No estas dado de alta en este torneo. Pidele al admin que te active la temporada."
