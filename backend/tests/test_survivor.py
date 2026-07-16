from datetime import UTC, datetime, timedelta

from app.core.database import SessionLocal
from app.models.entities import (
    Match,
    MatchResult,
    MatchStatus,
    Matchday,
    MatchdayStatus,
    Season,
    SurvivorMembership,
    SurvivorPick,
)

from conftest import MATCH_ONE_ID, MATCH_TWO_ID, MATCHDAY_ID, PROFILE_LEADER_ID, PROFILE_USER_ID, SEASON_ID, TEAM_A_ID, TEAM_B_ID, TEAM_C_ID


def test_user_can_join_survivor_and_regular_season(client) -> None:
    db = SessionLocal()
    try:
        season = db.get(Season, SEASON_ID)
        assert season is not None
        season.survivor_enabled = True
        season.survivor_name = "Survivor Liga MX"
        season.survivor_max_lives = 2
        db.add(season)
        db.commit()
    finally:
        db.close()

    season_response = client.post(f"/api/v1/me/seasons/{SEASON_ID}/join")
    assert season_response.status_code == 200
    season_payload = season_response.json()
    assert season_payload["selected_season_membership"]["is_active"] is True

    survivor_response = client.post(f"/api/v1/survivor/seasons/{SEASON_ID}/join")
    assert survivor_response.status_code == 200
    survivor_payload = survivor_response.json()
    assert survivor_payload["season"]["survivor_name"] == "Survivor Liga MX"
    assert survivor_payload["my_membership"]["remaining_lives"] == 2


def test_user_can_join_survivor_on_standard_season_even_without_flag(client) -> None:
    survivor_response = client.post(f"/api/v1/survivor/seasons/{SEASON_ID}/join")
    assert survivor_response.status_code == 200
    survivor_payload = survivor_response.json()
    assert survivor_payload["season"]["survivor_enabled"] is True
    assert survivor_payload["my_membership"]["remaining_lives"] == 1


def test_survivor_rejects_repeated_team_selection(client) -> None:
    previous_matchday_id = "30000000-0000-0000-0000-000000000099"
    previous_match_id = "50000000-0000-0000-0000-000000000099"

    db = SessionLocal()
    try:
        season = db.get(Season, SEASON_ID)
        assert season is not None
        season.survivor_enabled = True
        season.survivor_max_lives = 2
        db.add(season)
        db.add(
            Matchday(
                id=previous_matchday_id,
                season_id=SEASON_ID,
                number=2,
                name="Jornada 2",
                status=MatchdayStatus.PUBLISHED,
                starts_at=datetime.now(UTC) - timedelta(days=7),
                ends_at=datetime.now(UTC) - timedelta(days=6),
            )
        )
        db.add(
            Match(
                id=previous_match_id,
                matchday_id=previous_matchday_id,
                home_team_id=TEAM_A_ID,
                away_team_id=TEAM_B_ID,
                kickoff_at=datetime.now(UTC) - timedelta(days=7),
                picks_lock_at=datetime.now(UTC) - timedelta(days=7, hours=1),
                status=MatchStatus.FINAL,
            )
        )
        db.add(
            SurvivorMembership(
                season_id=SEASON_ID,
                profile_id=PROFILE_USER_ID,
                is_active=True,
                joined_at=datetime.now(UTC) - timedelta(days=8),
            )
        )
        db.add(
            SurvivorPick(
                season_id=SEASON_ID,
                profile_id=PROFILE_USER_ID,
                matchday_id=previous_matchday_id,
                match_id=previous_match_id,
                team_id=TEAM_A_ID,
            )
        )
        db.commit()
    finally:
        db.close()

    repeated_team_response = client.put(
        "/api/v1/survivor/picks",
        json={
            "season_id": SEASON_ID,
            "matchday_id": MATCHDAY_ID,
            "team_id": TEAM_A_ID,
        },
    )
    assert repeated_team_response.status_code == 409

    valid_response = client.put(
        "/api/v1/survivor/picks",
        json={
            "season_id": SEASON_ID,
            "matchday_id": MATCHDAY_ID,
            "team_id": TEAM_C_ID,
        },
    )
    assert valid_response.status_code == 200
    payload = valid_response.json()
    assert payload["my_membership"]["current_pick"]["team_id"] == TEAM_C_ID


def test_survivor_board_counts_lost_lives_and_sorts_leaderboard(client) -> None:
    db = SessionLocal()
    try:
        season = db.get(Season, SEASON_ID)
        assert season is not None
        season.survivor_enabled = True
        season.survivor_max_lives = 2
        db.add(season)

        user_membership = SurvivorMembership(
            season_id=SEASON_ID,
            profile_id=PROFILE_USER_ID,
            is_active=True,
            joined_at=datetime.now(UTC) - timedelta(days=2),
        )
        leader_membership = SurvivorMembership(
            season_id=SEASON_ID,
            profile_id=PROFILE_LEADER_ID,
            is_active=True,
            joined_at=datetime.now(UTC) - timedelta(days=3),
        )
        db.add_all([user_membership, leader_membership])
        db.add(
            SurvivorPick(
                season_id=SEASON_ID,
                profile_id=PROFILE_USER_ID,
                matchday_id=MATCHDAY_ID,
                match_id=MATCH_ONE_ID,
                team_id=TEAM_B_ID,
            )
        )
        db.add(
            SurvivorPick(
                season_id=SEASON_ID,
                profile_id=PROFILE_LEADER_ID,
                matchday_id=MATCHDAY_ID,
                match_id=MATCH_TWO_ID,
                team_id=TEAM_C_ID,
            )
        )
        match_one = db.get(Match, MATCH_ONE_ID)
        match_two = db.get(Match, MATCH_TWO_ID)
        assert match_one is not None and match_two is not None
        match_one.status = MatchStatus.FINAL
        match_two.status = MatchStatus.FINAL
        db.add_all(
            [
                MatchResult(match_id=MATCH_ONE_ID, home_score=2, away_score=0, is_official=True),
                MatchResult(match_id=MATCH_TWO_ID, home_score=1, away_score=2, is_official=True),
            ]
        )
        db.commit()
    finally:
        db.close()

    response = client.get(f"/api/v1/survivor/board?season_id={SEASON_ID}")
    assert response.status_code == 200
    payload = response.json()
    assert payload["my_membership"]["remaining_lives"] == 1
    assert payload["my_membership"]["lives_spent"] == 1
    assert payload["leaderboard"][0]["profile_id"] == PROFILE_LEADER_ID
    assert payload["leaderboard"][1]["profile_id"] == PROFILE_USER_ID


def test_survivor_join_rejects_when_admin_closed_registration(client) -> None:
    db = SessionLocal()
    try:
        season = db.get(Season, SEASON_ID)
        assert season is not None
        season.survivor_enabled = True
        season.survivor_registration_closed = True
        db.add(season)
        db.commit()
    finally:
        db.close()

    response = client.post(f"/api/v1/survivor/seasons/{SEASON_ID}/join")
    assert response.status_code == 400
    assert response.json()["detail"] == "La ventana de inscripcion para survivor ya cerro"
