import os
from collections.abc import Generator
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

os.environ["DATABASE_URL"] = "sqlite:///./test.db"
os.environ["SUPABASE_JWT_SECRET"] = "test-secret"

PROFILE_USER_ID = "10000000-0000-0000-0000-000000000001"
PROFILE_LEADER_ID = "10000000-0000-0000-0000-000000000002"
SEASON_ID = "20000000-0000-0000-0000-000000000001"
MATCHDAY_ID = "30000000-0000-0000-0000-000000000001"
TEAM_A_ID = "40000000-0000-0000-0000-000000000001"
TEAM_B_ID = "40000000-0000-0000-0000-000000000002"
TEAM_C_ID = "40000000-0000-0000-0000-000000000003"
TEAM_D_ID = "40000000-0000-0000-0000-000000000004"
MATCH_ONE_ID = "50000000-0000-0000-0000-000000000001"
MATCH_TWO_ID = "50000000-0000-0000-0000-000000000002"
STANDING_ID = "60000000-0000-0000-0000-000000000001"
USER_MEMBERSHIP_ID = "70000000-0000-0000-0000-000000000001"
LEADER_MEMBERSHIP_ID = "70000000-0000-0000-0000-000000000002"

from app.api.deps import get_current_profile  # noqa: E402
from app.core.database import SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models.base import Base  # noqa: E402
from app.models.entities import (  # noqa: E402
    Match,
    MatchStatus,
    Matchday,
    MatchdayStatus,
    Profile,
    RoleCode,
    Season,
    SeasonMembership,
    StandingsOverall,
    Team,
)


@pytest.fixture(autouse=True)
def reset_db() -> Generator[None, None, None]:
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()

    user = Profile(
        id=PROFILE_USER_ID,
        auth_user_id="11111111-1111-1111-1111-111111111111",
        email="user@example.com",
        display_name="Usuario Demo",
        role_code=RoleCode.USER,
        is_active=True,
    )
    leader = Profile(
        id=PROFILE_LEADER_ID,
        auth_user_id="22222222-2222-2222-2222-222222222222",
        email="leader@example.com",
        display_name="Lider Semanal",
        role_code=RoleCode.USER,
        is_active=True,
    )
    season = Season(id=SEASON_ID, name="Clausura 2026", slug="clausura-2026", is_active=True)
    matchday = Matchday(
        id=MATCHDAY_ID,
        season_id=season.id,
        number=3,
        name="Jornada 3",
        status=MatchdayStatus.ACTIVE,
        starts_at=datetime.now(UTC),
        ends_at=datetime.now(UTC) + timedelta(days=3),
    )
    team_a = Team(id=TEAM_A_ID, name="America", short_name="AME", slug="america")
    team_b = Team(id=TEAM_B_ID, name="Chivas", short_name="CHI", slug="chivas")
    team_c = Team(id=TEAM_C_ID, name="Tigres", short_name="TIG", slug="tigres")
    team_d = Team(id=TEAM_D_ID, name="Monterrey", short_name="MTY", slug="monterrey")
    match_one = Match(
        id=MATCH_ONE_ID,
        matchday_id=matchday.id,
        home_team_id=team_a.id,
        away_team_id=team_b.id,
        kickoff_at=datetime.now(UTC) + timedelta(days=1),
        picks_lock_at=datetime.now(UTC) + timedelta(hours=12),
        venue="Estadio Azteca",
        status=MatchStatus.SCHEDULED,
    )
    match_two = Match(
        id=MATCH_TWO_ID,
        matchday_id=matchday.id,
        home_team_id=team_c.id,
        away_team_id=team_d.id,
        kickoff_at=datetime.now(UTC) + timedelta(days=1, hours=2),
        picks_lock_at=datetime.now(UTC) + timedelta(hours=14),
        venue="Volcan",
        status=MatchStatus.SCHEDULED,
    )
    standing = StandingsOverall(
        id=STANDING_ID,
        season_id=season.id,
        profile_id=leader.id,
        total_points=11,
        correct_results=3,
        exact_scores=1,
        rank_position=1,
    )
    user_membership = SeasonMembership(
        id=USER_MEMBERSHIP_ID,
        season_id=season.id,
        profile_id=user.id,
        is_active=True,
        is_paid=True,
    )
    leader_membership = SeasonMembership(
        id=LEADER_MEMBERSHIP_ID,
        season_id=season.id,
        profile_id=leader.id,
        is_active=True,
        is_paid=True,
    )

    db.add_all(
        [
            user,
            leader,
            season,
            matchday,
            team_a,
            team_b,
            team_c,
            team_d,
            match_one,
            match_two,
            standing,
            user_membership,
            leader_membership,
        ]
    )
    db.commit()
    db.close()
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def client() -> Generator[TestClient, None, None]:
    def override_current_profile() -> Profile:
        db = SessionLocal()
        try:
            return db.get(Profile, PROFILE_USER_ID)
        finally:
            db.close()

    app.dependency_overrides[get_current_profile] = override_current_profile
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
