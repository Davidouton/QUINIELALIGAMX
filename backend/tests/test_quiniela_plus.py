from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient

from app.api.deps import get_current_profile
from app.main import app
from app.models.entities import (
    Match,
    MatchStatus,
    Matchday,
    MatchdayStatus,
    PickSelection,
    Profile,
    Season,
    SeasonMembership,
    TournamentFormat,
    UserPick,
    VipCompetition,
    VipCompetitionMatchday,
    VipMembership,
    VipMembershipStatus,
)

from conftest import PROFILE_LEADER_ID, PROFILE_USER_ID, SessionLocal, TEAM_A_ID, TEAM_B_ID

WORLD_CUP_SEASON_ID = "20000000-0000-0000-0000-000000000101"
WORLD_CUP_MATCHDAY_ID = "30000000-0000-0000-0000-000000000101"
WORLD_CUP_MATCH_ID = "50000000-0000-0000-0000-000000000101"
VIP_ID = "80000000-0000-0000-0000-000000000101"
OUTSIDER_PROFILE_ID = "10000000-0000-0000-0000-000000000099"


def get_user_client() -> TestClient:
    def override_current_profile() -> Profile:
        db = SessionLocal()
        try:
            profile = db.get(Profile, PROFILE_USER_ID)
            assert profile is not None
            return profile
        finally:
            db.close()

    app.dependency_overrides[get_current_profile] = override_current_profile
    return TestClient(app)


def test_user_distribution_can_filter_by_regular_or_vip_context() -> None:
    db = SessionLocal()
    try:
        outsider = Profile(
            id=OUTSIDER_PROFILE_ID,
            auth_user_id="99999999-9999-9999-9999-999999999999",
            email="outsider@example.com",
            display_name="Fuera de contexto",
            is_active=True,
        )
        season = Season(
            id=WORLD_CUP_SEASON_ID,
            name="World Cup 2026",
            slug="world-cup-2026",
            tournament_format=TournamentFormat.WORLD_CUP,
            is_active=True,
        )
        matchday = Matchday(
            id=WORLD_CUP_MATCHDAY_ID,
            season_id=WORLD_CUP_SEASON_ID,
            number=1,
            name="Jornada Mundialista 1",
            status=MatchdayStatus.ACTIVE,
            starts_at=datetime.now(UTC),
            ends_at=datetime.now(UTC) + timedelta(days=1),
        )
        match = Match(
            id=WORLD_CUP_MATCH_ID,
            matchday_id=WORLD_CUP_MATCHDAY_ID,
            home_team_id=TEAM_A_ID,
            away_team_id=TEAM_B_ID,
            kickoff_at=datetime.now(UTC) + timedelta(hours=4),
            picks_lock_at=datetime.now(UTC) + timedelta(hours=2),
            status=MatchStatus.SCHEDULED,
        )
        vip = VipCompetition(
            id=VIP_ID,
            season_id=WORLD_CUP_SEASON_ID,
            name="VIP Mundial Jornada 1",
        )
        db.add_all(
            [
                outsider,
                season,
                matchday,
                match,
                vip,
                SeasonMembership(
                    season_id=WORLD_CUP_SEASON_ID,
                    profile_id=PROFILE_USER_ID,
                    is_active=True,
                    is_paid=True,
                ),
                SeasonMembership(
                    season_id=WORLD_CUP_SEASON_ID,
                    profile_id=PROFILE_LEADER_ID,
                    is_active=True,
                    is_paid=True,
                ),
                VipCompetitionMatchday(
                    vip_competition_id=VIP_ID,
                    matchday_id=WORLD_CUP_MATCHDAY_ID,
                ),
                VipMembership(
                    vip_competition_id=VIP_ID,
                    profile_id=PROFILE_USER_ID,
                    status=VipMembershipStatus.APPROVED,
                ),
                UserPick(
                    profile_id=PROFILE_USER_ID,
                    match_id=WORLD_CUP_MATCH_ID,
                    selection=PickSelection.HOME,
                    predicted_home_score=2,
                    predicted_away_score=1,
                ),
                UserPick(
                    profile_id=PROFILE_LEADER_ID,
                    match_id=WORLD_CUP_MATCH_ID,
                    selection=PickSelection.DRAW,
                    predicted_home_score=1,
                    predicted_away_score=1,
                ),
                UserPick(
                    profile_id=OUTSIDER_PROFILE_ID,
                    match_id=WORLD_CUP_MATCH_ID,
                    selection=PickSelection.AWAY,
                    predicted_home_score=0,
                    predicted_away_score=1,
                ),
            ]
        )
        db.commit()
    finally:
        db.close()

    with get_user_client() as test_client:
        season_response = test_client.get(
            f"/api/v1/quiniela-plus/user-distribution?context_type=season&context_id={WORLD_CUP_SEASON_ID}",
            headers={"Authorization": "Bearer test-token"},
        )
        assert season_response.status_code == 200
        season_payload = season_response.json()
        assert season_payload["title"] == "Distribucion de usuarios · World Cup 2026"
        assert len(season_payload["matches"]) == 1
        assert season_payload["matches"][0]["total_picks"] == 2
        assert season_payload["matches"][0]["selection_distribution"]["home_count"] == 1
        assert season_payload["matches"][0]["selection_distribution"]["draw_count"] == 1
        assert season_payload["matches"][0]["selection_distribution"]["away_count"] == 0

        vip_response = test_client.get(
            f"/api/v1/quiniela-plus/user-distribution?context_type=vip&context_id={VIP_ID}",
            headers={"Authorization": "Bearer test-token"},
        )
        assert vip_response.status_code == 200
        vip_payload = vip_response.json()
        assert vip_payload["title"] == "Distribucion de usuarios · VIP Mundial Jornada 1"
        assert len(vip_payload["matches"]) == 1
        assert vip_payload["matches"][0]["total_picks"] == 1
        assert vip_payload["matches"][0]["selection_distribution"]["home_count"] == 1
        assert vip_payload["matches"][0]["selection_distribution"]["draw_count"] == 0
        assert vip_payload["matches"][0]["selection_distribution"]["away_count"] == 0
    app.dependency_overrides.clear()
