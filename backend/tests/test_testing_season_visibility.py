from datetime import UTC, datetime, timedelta

from conftest import PROFILE_USER_ID, SessionLocal
from app.models.entities import (
    Matchday,
    MatchdayStatus,
    Season,
    SeasonMembership,
    SeasonVisibilityStatus,
)


TESTING_SEASON_ID = "20000000-0000-0000-0000-000000000099"
TESTING_MATCHDAY_ID = "30000000-0000-0000-0000-000000000099"


def add_testing_season(*, with_membership: bool) -> None:
    db = SessionLocal()
    try:
        season = Season(
            id=TESTING_SEASON_ID,
            name="Torneo QA",
            slug="torneo-qa",
            visibility_status=SeasonVisibilityStatus.TESTING,
            is_active=False,
            registration_closed=False,
        )
        matchday = Matchday(
            id=TESTING_MATCHDAY_ID,
            season_id=season.id,
            number=1,
            name="Jornada QA",
            status=MatchdayStatus.ACTIVE,
            starts_at=datetime.now(UTC),
            ends_at=datetime.now(UTC) + timedelta(days=1),
        )
        db.add_all([season, matchday])
        if with_membership:
            db.add(
                SeasonMembership(
                    season_id=season.id,
                    profile_id=PROFILE_USER_ID,
                    is_active=True,
                    is_paid=True,
                    eligible_for_scoring=True,
                )
            )
        db.commit()
    finally:
        db.close()


def test_testing_season_is_hidden_without_assignment(client):
    add_testing_season(with_membership=False)

    public_seasons = client.get("/api/v1/seasons")
    assert public_seasons.status_code == 200
    assert TESTING_SEASON_ID not in {row["id"] for row in public_seasons.json()}

    bootstrap = client.get("/api/v1/bootstrap", headers={"Authorization": "Bearer test-token"})
    assert bootstrap.status_code == 200
    payload = bootstrap.json()
    assert TESTING_SEASON_ID not in {row["id"] for row in payload["seasons"]}
    assert TESTING_MATCHDAY_ID not in {row["id"] for row in payload["matchdays"]}


def test_testing_season_is_visible_to_assigned_user_but_cannot_be_self_joined(client):
    add_testing_season(with_membership=True)

    bootstrap = client.get("/api/v1/bootstrap", headers={"Authorization": "Bearer test-token"})
    assert bootstrap.status_code == 200
    payload = bootstrap.json()
    assert TESTING_SEASON_ID in {row["id"] for row in payload["seasons"]}
    assert TESTING_MATCHDAY_ID in {row["id"] for row in payload["matchdays"]}

    join_response = client.post(
        f"/api/v1/me/seasons/{TESTING_SEASON_ID}/join",
        headers={"Authorization": "Bearer test-token"},
    )
    assert join_response.status_code == 403
    assert "administrador" in join_response.json()["detail"]
