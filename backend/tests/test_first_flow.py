from datetime import UTC, datetime, timedelta

from conftest import MATCH_ONE_ID, MATCHDAY_ID, PROFILE_LEADER_ID, PROFILE_USER_ID, SEASON_ID, SessionLocal
from app.models.entities import MatchResult, Matchday, MatchdayStatus, Profile, RoleCode, Season, SeasonMembership, StandingsMatchday, StandingsOverall


def test_first_flow(client):
    health = client.get("/api/v1/health")
    assert health.status_code == 200

    me = client.get("/api/v1/me", headers={"Authorization": "Bearer test-token"})
    assert me.status_code == 200
    assert me.json()["display_name"] == "Usuario Demo"
    assert me.json()["modality"] == "pre_pago"
    assert me.json()["aval_profile_id"] is None
    assert me.json()["bank_name"] is None

    matchdays = client.get("/api/v1/matchdays?status=active")
    assert matchdays.status_code == 200
    active_matchday = matchdays.json()[0]
    assert active_matchday["name"] == "Jornada 3"

    matches = client.get(f"/api/v1/matches?matchday_id={active_matchday['id']}")
    assert matches.status_code == 200
    assert len(matches.json()) == 2

    create_pick = client.post(
        "/api/v1/picks",
        json={
            "match_id": "50000000-0000-0000-0000-000000000001",
            "selection": "home",
            "predicted_home_score": 2,
            "predicted_away_score": 1,
        },
        headers={"Authorization": "Bearer test-token"},
    )
    assert create_pick.status_code == 201

    my_picks = client.get(
        f"/api/v1/my-picks?matchday_id={active_matchday['id']}",
        headers={"Authorization": "Bearer test-token"},
    )
    assert my_picks.status_code == 200
    assert len(my_picks.json()) == 1
    assert my_picks.json()[0]["selection"] == "home"

    leaderboard = client.get("/api/v1/leaderboard/overall")
    assert leaderboard.status_code == 200
    assert leaderboard.json()[0]["display_name"] == "Lider Semanal"


def test_overall_leaderboard_recomputes_stale_tie_positions(client):
    third_profile_id = "10000000-0000-0000-0000-000000000003"
    fourth_profile_id = "10000000-0000-0000-0000-000000000004"
    third_membership_id = "70000000-0000-0000-0000-000000000003"
    fourth_membership_id = "70000000-0000-0000-0000-000000000004"

    db = SessionLocal()
    try:
        db.query(StandingsOverall).delete()
        db.add_all(
            [
                Profile(
                    id=third_profile_id,
                    auth_user_id="33333333-3333-3333-3333-333333333333",
                    email="third@example.com",
                    display_name="Isaac Rayon",
                    role_code=RoleCode.USER,
                    is_active=True,
                ),
                Profile(
                    id=fourth_profile_id,
                    auth_user_id="44444444-4444-4444-4444-444444444444",
                    email="fourth@example.com",
                    display_name="Mario Martinez",
                    role_code=RoleCode.USER,
                    is_active=True,
                ),
                SeasonMembership(
                    id=third_membership_id,
                    season_id=SEASON_ID,
                    profile_id=third_profile_id,
                    is_active=True,
                    is_paid=True,
                ),
                SeasonMembership(
                    id=fourth_membership_id,
                    season_id=SEASON_ID,
                    profile_id=fourth_profile_id,
                    is_active=True,
                    is_paid=True,
                ),
                StandingsOverall(
                    season_id=SEASON_ID,
                    profile_id=PROFILE_USER_ID,
                    total_points=232,
                    correct_results=62,
                    exact_scores=14,
                    rank_position=1,
                ),
                StandingsOverall(
                    season_id=SEASON_ID,
                    profile_id=PROFILE_LEADER_ID,
                    total_points=232,
                    correct_results=62,
                    exact_scores=14,
                    rank_position=1,
                ),
                StandingsOverall(
                    season_id=SEASON_ID,
                    profile_id=third_profile_id,
                    total_points=232,
                    correct_results=63,
                    exact_scores=13,
                    rank_position=3,
                ),
                StandingsOverall(
                    season_id=SEASON_ID,
                    profile_id=fourth_profile_id,
                    total_points=229,
                    correct_results=61,
                    exact_scores=13,
                    rank_position=4,
                ),
            ]
        )
        db.commit()
    finally:
        db.close()

    leaderboard = client.get(f"/api/v1/leaderboard/overall?season_id={SEASON_ID}")
    assert leaderboard.status_code == 200
    rows = leaderboard.json()
    assert [row["rank_position"] for row in rows[:4]] == [1, 1, 1, 4]


def test_overall_leaderboard_self_heals_when_cache_is_missing(client):
    create_pick = client.post(
        "/api/v1/picks",
        json={
            "match_id": MATCH_ONE_ID,
            "selection": "home",
            "predicted_home_score": 2,
            "predicted_away_score": 1,
        },
        headers={"Authorization": "Bearer test-token"},
    )
    assert create_pick.status_code == 201

    db = SessionLocal()
    try:
        db.query(StandingsOverall).delete()
        db.add(
            MatchResult(
                match_id=MATCH_ONE_ID,
                home_score=2,
                away_score=1,
                is_official=True,
            )
        )
        db.commit()
    finally:
        db.close()

    response = client.get(f"/api/v1/leaderboard/overall?season_id={SEASON_ID}")
    assert response.status_code == 200
    rows = response.json()
    assert rows
    assert rows[0]["profile_id"] == PROFILE_USER_ID
    assert rows[0]["total_points"] > 0


def test_overall_leaderboard_self_heals_when_cache_contains_only_zeroes(client):
    create_pick = client.post(
        "/api/v1/picks",
        json={
            "match_id": MATCH_ONE_ID,
            "selection": "home",
            "predicted_home_score": 2,
            "predicted_away_score": 1,
        },
        headers={"Authorization": "Bearer test-token"},
    )
    assert create_pick.status_code == 201

    db = SessionLocal()
    try:
        db.add(MatchResult(match_id=MATCH_ONE_ID, home_score=2, away_score=1, is_official=True))
        db.commit()
    finally:
        db.close()

    first_response = client.get(f"/api/v1/leaderboard/overall?season_id={SEASON_ID}")
    assert first_response.status_code == 200
    assert first_response.json()[0]["total_points"] > 0

    db = SessionLocal()
    try:
        for standing in db.query(StandingsOverall).filter(StandingsOverall.season_id == SEASON_ID):
            standing.total_points = 0
            standing.correct_results = 0
            standing.exact_scores = 0
            standing.rank_position = 1
        db.commit()
    finally:
        db.close()

    repaired_response = client.get(f"/api/v1/leaderboard/overall?season_id={SEASON_ID}")
    assert repaired_response.status_code == 200
    repaired_rows = repaired_response.json()
    assert repaired_rows[0]["profile_id"] == PROFILE_USER_ID
    assert repaired_rows[0]["total_points"] > 0


def test_registered_users_returns_other_profiles(client):
    response = client.get("/api/v1/me/registered-users", headers={"Authorization": "Bearer test-token"})

    assert response.status_code == 200
    rows = response.json()
    assert len(rows) == 1
    assert rows[0]["display_name"] == "Lider Semanal"


def test_update_me_cannot_change_modality_or_aval(client):
    response = client.put(
        "/api/v1/me",
        json={
            "display_name": "Usuario Demo",
            "email": "user@example.com",
            "favorite_team_id": None,
            "contact_phone": "5555555555",
            "bank_name": "BBVA",
            "deposit_account": "Cuenta demo",
            "modality": "aval",
            "aval_profile_id": PROFILE_LEADER_ID,
            "theme_preference": "standard",
        },
        headers={"Authorization": "Bearer test-token"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["modality"] == "pre_pago"
    assert payload["aval_profile_id"] is None
    assert payload["bank_name"] == "BBVA"


def test_prize_summary_returns_public_tournament_breakdown(client):
    response = client.get("/api/v1/me/prize-summary", headers={"Authorization": "Bearer test-token"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["season_id"] == SEASON_ID
    assert payload["confirmed_participants"] >= 1
    assert "entry_fee_amount" in payload
    assert "distributable_prize_pool_amount" in payload
    assert "net_income_amount" in payload


def test_my_pick_results_returns_prediction_result_and_points(client):
    create_pick = client.post(
        "/api/v1/picks",
        json={
            "match_id": MATCH_ONE_ID,
            "selection": "home",
            "predicted_home_score": 2,
            "predicted_away_score": 1,
        },
        headers={"Authorization": "Bearer test-token"},
    )
    assert create_pick.status_code == 201

    db = SessionLocal()
    try:
        db.add(
            MatchResult(
                match_id=MATCH_ONE_ID,
                home_score=2,
                away_score=1,
                is_official=True,
            )
        )
        db.commit()
    finally:
        db.close()

    response = client.get(
        f"/api/v1/my-pick-results?matchday_id={MATCHDAY_ID}",
        headers={"Authorization": "Bearer test-token"},
    )

    assert response.status_code == 200
    rows = response.json()
    assert len(rows) == 2
    assert rows[0]["match_id"] == MATCH_ONE_ID
    assert rows[0]["has_pick"] is True
    assert rows[0]["predicted_home_score"] == 2
    assert rows[0]["predicted_away_score"] == 1
    assert rows[0]["home_score"] == 2
    assert rows[0]["away_score"] == 1
    assert rows[0]["result_points"] == 3
    assert rows[0]["exact_score_points"] == 2
    assert rows[0]["total_points"] == 5
    assert rows[1]["has_pick"] is False
    assert rows[1]["total_points"] == 0


def test_my_matchday_points_returns_rows_for_season(client):
    db = SessionLocal()
    try:
        db.add(
            StandingsMatchday(
                matchday_id=MATCHDAY_ID,
                profile_id="10000000-0000-0000-0000-000000000001",
                total_points=8,
                correct_results=2,
                exact_scores=1,
                rank_position=1,
            )
        )
        db.commit()
    finally:
        db.close()

    response = client.get(
        "/api/v1/leaderboard/my-matchdays?season_id=20000000-0000-0000-0000-000000000001",
        headers={"Authorization": "Bearer test-token"},
    )

    assert response.status_code == 200
    rows = response.json()
    assert len(rows) == 1
    assert rows[0]["matchday_id"] == MATCHDAY_ID
    assert rows[0]["total_points"] == 8
    assert rows[0]["correct_results"] == 2
    assert rows[0]["exact_scores"] == 1
    assert rows[0]["rank_position"] == 1
    assert rows[0]["cumulative_points"] == 8


def test_my_matchday_points_respects_tournament_bounds(client):
    second_matchday_id = "30000000-0000-0000-0000-000000000098"

    db = SessionLocal()
    try:
        db.add(
            Matchday(
                id=second_matchday_id,
                season_id=SEASON_ID,
                number=99,
                name="Jornada 99",
                status=MatchdayStatus.PUBLISHED,
                starts_at=datetime.now(UTC) + timedelta(days=30),
                ends_at=datetime.now(UTC) + timedelta(days=31),
            )
        )
        db.add_all(
            [
                StandingsMatchday(
                    matchday_id=MATCHDAY_ID,
                    profile_id=PROFILE_USER_ID,
                    total_points=8,
                    correct_results=2,
                    exact_scores=1,
                    rank_position=1,
                ),
                StandingsMatchday(
                    matchday_id=second_matchday_id,
                    profile_id=PROFILE_USER_ID,
                    total_points=50,
                    correct_results=10,
                    exact_scores=5,
                    rank_position=1,
                ),
            ]
        )
        season = db.get(Season, SEASON_ID)
        assert season is not None
        season.start_matchday_id = MATCHDAY_ID
        season.end_matchday_id = MATCHDAY_ID
        db.commit()
    finally:
        db.close()

    response = client.get(
        f"/api/v1/leaderboard/my-matchdays?season_id={SEASON_ID}",
        headers={"Authorization": "Bearer test-token"},
    )

    assert response.status_code == 200
    rows = response.json()
    assert len(rows) == 1
    assert rows[0]["matchday_id"] == MATCHDAY_ID
    assert rows[0]["total_points"] == 8
    assert rows[0]["cumulative_points"] == 8


def test_dashboard_summary_returns_tournament_metrics(client):
    second_matchday_id = "30000000-0000-0000-0000-000000000099"

    db = SessionLocal()
    try:
        second_matchday = Matchday(
            id=second_matchday_id,
            season_id=SEASON_ID,
            number=4,
            name="Jornada 4",
            status=MatchdayStatus.PUBLISHED,
            starts_at=datetime.now(UTC) + timedelta(days=7),
            ends_at=datetime.now(UTC) + timedelta(days=10),
        )
        db.add(second_matchday)
        db.flush()

        first_user_row = StandingsMatchday(
            matchday_id=MATCHDAY_ID,
            profile_id=PROFILE_USER_ID,
            total_points=8,
            correct_results=2,
            exact_scores=1,
            rank_position=2,
        )
        first_leader_row = StandingsMatchday(
            matchday_id=MATCHDAY_ID,
            profile_id=PROFILE_LEADER_ID,
            total_points=10,
            correct_results=3,
            exact_scores=1,
            rank_position=1,
        )
        second_user_row = StandingsMatchday(
            matchday_id=second_matchday_id,
            profile_id=PROFILE_USER_ID,
            total_points=6,
            correct_results=2,
            exact_scores=0,
            rank_position=3,
        )
        second_leader_row = StandingsMatchday(
            matchday_id=second_matchday_id,
            profile_id=PROFILE_LEADER_ID,
            total_points=9,
            correct_results=3,
            exact_scores=0,
            rank_position=1,
        )

        db.add_all([first_user_row, first_leader_row, second_user_row, second_leader_row])

        season = db.get(Season, SEASON_ID)
        assert season is not None
        season.start_matchday_id = MATCHDAY_ID
        season.end_matchday_id = second_matchday_id
        db.commit()
    finally:
        db.close()

    response = client.get(
        f"/api/v1/me/dashboard-summary?season_id={SEASON_ID}",
        headers={"Authorization": "Bearer test-token"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["season_id"] == SEASON_ID
    assert payload["total_points"] == 14
    assert payload["overall_rank"] == 2
    assert payload["weekly_prizes_count"] == 2
    assert payload["average_points_per_matchday"] == 7.0
    assert payload["projected_total_points"] == 14.0
    assert payload["projected_rank"] == 2
    assert payload["tournament_matchdays"] == 2
    assert payload["completed_matchdays"] == 2
    assert payload["remaining_matchdays"] == 0


def test_advanced_stats_returns_tournament_breakdown(client):
    db = SessionLocal()
    try:
        db.add_all(
            [
                MatchResult(
                    match_id=MATCH_ONE_ID,
                    home_score=2,
                    away_score=1,
                    is_official=True,
                ),
                MatchResult(
                    match_id="50000000-0000-0000-0000-000000000002",
                    home_score=1,
                    away_score=1,
                    is_official=True,
                ),
            ]
        )
        db.commit()
    finally:
        db.close()

    client.post(
        "/api/v1/picks",
        json={
            "match_id": MATCH_ONE_ID,
            "selection": "home",
            "predicted_home_score": 2,
            "predicted_away_score": 1,
        },
        headers={"Authorization": "Bearer test-token"},
    )
    client.post(
        "/api/v1/picks",
        json={
            "match_id": "50000000-0000-0000-0000-000000000002",
            "selection": "draw",
            "predicted_home_score": 0,
            "predicted_away_score": 0,
        },
        headers={"Authorization": "Bearer test-token"},
    )

    response = client.get(
        f"/api/v1/me/advanced-stats?season_id={SEASON_ID}",
        headers={"Authorization": "Bearer test-token"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["graded_picks"] == 2
    assert payload["home_bets"] == 1
    assert payload["draw_bets"] == 1
    assert payload["away_bets"] == 0
    assert payload["max_hit_points"] == 5
    assert payload["result_hit_points"] == 3
    assert payload["exact_hits"] == 1
    assert payload["result_hits"] == 1
    assert payload["overall_effectiveness_pct"] == 100.0
    assert payload["home_effectiveness_pct"] == 100.0
    assert payload["draw_effectiveness_pct"] == 100.0
    assert payload["away_effectiveness_pct"] == 0.0
    assert payload["home_points"] == 5
    assert payload["draw_points"] == 3
    assert payload["away_points"] == 0


def test_my_race_returns_player_vs_leader_projection(client):
    second_matchday_id = "30000000-0000-0000-0000-000000000100"

    db = SessionLocal()
    try:
        db.add(
            Matchday(
                id=second_matchday_id,
                season_id=SEASON_ID,
                number=4,
                name="Jornada 4",
                status=MatchdayStatus.PUBLISHED,
                starts_at=datetime.now(UTC) + timedelta(days=7),
                ends_at=datetime.now(UTC) + timedelta(days=10),
            )
        )
        db.flush()
        db.add_all(
            [
                StandingsMatchday(
                    matchday_id=MATCHDAY_ID,
                    profile_id=PROFILE_USER_ID,
                    total_points=6,
                    correct_results=2,
                    exact_scores=0,
                    rank_position=2,
                ),
                StandingsMatchday(
                    matchday_id=MATCHDAY_ID,
                    profile_id=PROFILE_LEADER_ID,
                    total_points=9,
                    correct_results=3,
                    exact_scores=0,
                    rank_position=1,
                ),
                StandingsMatchday(
                    matchday_id=second_matchday_id,
                    profile_id=PROFILE_USER_ID,
                    total_points=4,
                    correct_results=1,
                    exact_scores=0,
                    rank_position=2,
                ),
                StandingsMatchday(
                    matchday_id=second_matchday_id,
                    profile_id=PROFILE_LEADER_ID,
                    total_points=7,
                    correct_results=2,
                    exact_scores=0,
                    rank_position=1,
                ),
            ]
        )
        season = db.get(Season, SEASON_ID)
        assert season is not None
        season.start_matchday_id = MATCHDAY_ID
        season.end_matchday_id = second_matchday_id
        db.commit()
    finally:
        db.close()

    response = client.get(
        f"/api/v1/leaderboard/my-race?season_id={SEASON_ID}",
        headers={"Authorization": "Bearer test-token"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["leader_profile_id"] == PROFILE_LEADER_ID
    assert payload["leader_name"] == "Lider Semanal"
    assert payload["tournament_matchdays"] == 2
    assert payload["completed_matchdays"] == 2
    assert payload["projected_user_total"] == 10.0
    assert payload["projected_leader_total"] == 16.0
    assert len(payload["points"]) == 2
    assert payload["points"][0]["user_cumulative_points"] == 6.0
    assert payload["points"][0]["leader_cumulative_points"] == 9.0
    assert payload["points"][1]["user_cumulative_points"] == 10.0
    assert payload["points"][1]["leader_cumulative_points"] == 16.0
