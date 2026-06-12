from tests.conftest import register


def test_register_sets_session(client):
    user = register(client)
    assert user["display_name"] == "Alice"
    me = client.get("/api/auth/me")
    assert me.status_code == 200
    assert me.json()["email"] == "alice@example.org"


def test_register_duplicate_email(client):
    register(client)
    resp = client.post(
        "/api/auth/register",
        json={"email": "ALICE@example.org", "password": "whatever-12", "display_name": "Bis"},
    )
    assert resp.status_code == 409


def test_login_logout(client):
    register(client)
    client.post("/api/auth/logout")
    assert client.get("/api/auth/me").status_code == 401

    bad = client.post(
        "/api/auth/login", json={"email": "alice@example.org", "password": "wrong-password"}
    )
    assert bad.status_code == 401
    assert client.get("/api/auth/me").status_code == 401

    good = client.post(
        "/api/auth/login", json={"email": "Alice@Example.org", "password": "correct-horse"}
    )
    assert good.status_code == 200
    assert client.get("/api/auth/me").status_code == 200


def test_password_rules(client):
    resp = client.post(
        "/api/auth/register",
        json={"email": "bob@example.org", "password": "short", "display_name": "Bob"},
    )
    assert resp.status_code == 422


def test_problems_require_auth(client):
    assert client.get("/api/problems").status_code == 401
