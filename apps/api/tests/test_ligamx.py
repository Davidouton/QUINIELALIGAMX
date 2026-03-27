def test_get_teams(client):
    response = client.get("/ligamx/teams")
    assert response.status_code == 200
    teams = response.json()
    assert len(teams) == 6
    assert teams[0]["name"] == "America"


def test_get_team_by_id_not_found(client):
    response = client.get("/ligamx/teams/999")
    assert response.status_code == 404


def test_get_matches_by_status(client):
    response = client.get("/ligamx/matches?status=finished")
    assert response.status_code == 200
    matches = response.json()
    assert len(matches) == 6
    assert all(match["status"] == "finished" for match in matches)


def test_get_matches_by_matchday(client):
    response = client.get("/ligamx/matches?matchday=3")
    assert response.status_code == 200
    matches = response.json()
    assert len(matches) == 3
    assert all(match["matchday"] == 3 for match in matches)


def test_get_standings(client):
    response = client.get("/ligamx/standings")
    assert response.status_code == 200
    standings = response.json()
    assert len(standings) == 6
    assert standings[0]["team_name"] == "America"
    assert standings[0]["points"] == 6
