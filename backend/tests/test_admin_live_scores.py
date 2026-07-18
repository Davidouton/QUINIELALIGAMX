from conftest import MATCHDAY_ID, MATCH_ONE_ID, PROFILE_USER_ID, SessionLocal
from app.models.entities import LiveMatchScore, MatchResult, Profile, RoleCode


def test_admin_live_score_is_separate_from_official_result(client):
    db = SessionLocal()
    try:
        profile = db.get(Profile, PROFILE_USER_ID)
        assert profile is not None
        profile.role_code = RoleCode.ADMIN
        db.add(profile)
        db.commit()
    finally:
        db.close()

    response = client.put(
        f"/api/v1/admin/live-scores/{MATCH_ONE_ID}",
        json={"home_score": 2, "away_score": 1},
        headers={"Authorization": "Bearer test-token"},
    )
    assert response.status_code == 200
    assert response.json()["live_home_score"] == 2
    assert response.json()["live_away_score"] == 1

    db = SessionLocal()
    try:
        live_score = db.query(LiveMatchScore).filter(LiveMatchScore.match_id == MATCH_ONE_ID).one()
        assert (live_score.home_score, live_score.away_score) == (2, 1)
        assert db.query(MatchResult).filter(MatchResult.match_id == MATCH_ONE_ID).first() is None
    finally:
        db.close()

    rows = client.get(
        f"/api/v1/admin/live-scores?matchday_id={MATCHDAY_ID}",
        headers={"Authorization": "Bearer test-token"},
    )
    assert rows.status_code == 200
    assert next(row for row in rows.json() if row["match_id"] == MATCH_ONE_ID)["live_home_score"] == 2

    cleared = client.delete(
        f"/api/v1/admin/live-scores/{MATCH_ONE_ID}",
        headers={"Authorization": "Bearer test-token"},
    )
    assert cleared.status_code == 204
