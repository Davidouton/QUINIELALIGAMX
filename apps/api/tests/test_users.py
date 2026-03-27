def test_create_user(client):
    response = client.post(
        "/users",
        json={"name": "Ana", "email": "ana@example.com", "password": "secret123"},
    )
    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "Ana"
    assert body["email"] == "ana@example.com"


def test_create_user_duplicate_email(client):
    response = client.post(
        "/users",
        json={"name": "Test User 2", "email": "test@example.com", "password": "secret123"},
    )
    assert response.status_code == 409


def test_get_users_requires_auth(client):
    response = client.get("/users")
    assert response.status_code == 401


def test_get_users(client, auth_headers):
    response = client.get("/users", headers=auth_headers)
    assert response.status_code == 200
    users = response.json()
    assert len(users) == 1
    assert users[0]["email"] == "test@example.com"


def test_get_user_by_id(client, auth_headers):
    response = client.get("/users/1", headers=auth_headers)
    assert response.status_code == 200
    assert response.json()["id"] == 1


def test_get_user_by_id_not_found(client, auth_headers):
    response = client.get("/users/999", headers=auth_headers)
    assert response.status_code == 404
