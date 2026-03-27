def test_login_success(client):
    response = client.post(
        "/auth/login",
        json={"email": "test@example.com", "password": "secret123"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["email"] == "test@example.com"
    assert body["token"]["token_type"] == "bearer"
    assert body["token"]["access_token"]


def test_login_invalid_credentials(client):
    response = client.post(
        "/auth/login",
        json={"email": "test@example.com", "password": "wrongpass"},
    )
    assert response.status_code == 401
