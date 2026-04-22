import pytest

pytestmark = pytest.mark.anyio


async def test_register(client):
    res = await client.post("/auth/register", json={"email": "test@example.com", "password": "secret123"})
    assert res.status_code == 201
    data = res.json()
    assert data["user"]["email"] == "test@example.com"
    assert "token" in data


async def test_register_duplicate(client):
    await client.post("/auth/register", json={"email": "dup@example.com", "password": "secret123"})
    res = await client.post("/auth/register", json={"email": "dup@example.com", "password": "secret123"})
    assert res.status_code == 409


async def test_login(client):
    await client.post("/auth/register", json={"email": "login@example.com", "password": "pass"})
    res = await client.post("/auth/login", json={"email": "login@example.com", "password": "pass"})
    assert res.status_code == 200
    assert "token" in res.json()


async def test_login_wrong_password(client):
    await client.post("/auth/register", json={"email": "wrong@example.com", "password": "right"})
    res = await client.post("/auth/login", json={"email": "wrong@example.com", "password": "wrong"})
    assert res.status_code == 401


async def test_get_me(client):
    reg = await client.post("/auth/register", json={"email": "me@example.com", "password": "p"})
    user_id = reg.json()["user"]["id"]
    res = await client.get("/auth/me", headers={"X-User-Id": str(user_id)})
    assert res.status_code == 200
    assert res.json()["email"] == "me@example.com"


def test_jwt_secret_fails_closed_when_unset(monkeypatch):
    """Missing MURMUR_JWT_SECRET should raise unless dev opt-in is set."""
    from orchestrator.config import _resolve_jwt_secret
    monkeypatch.delenv("MURMUR_JWT_SECRET", raising=False)
    monkeypatch.delenv("MURMUR_ALLOW_DEV_SECRET", raising=False)
    with pytest.raises(RuntimeError, match="MURMUR_JWT_SECRET"):
        _resolve_jwt_secret()


def test_jwt_secret_dev_opt_in(monkeypatch):
    from orchestrator.config import _resolve_jwt_secret
    monkeypatch.delenv("MURMUR_JWT_SECRET", raising=False)
    monkeypatch.setenv("MURMUR_ALLOW_DEV_SECRET", "1")
    secret = _resolve_jwt_secret()
    assert "dev" in secret.lower()


def test_jwt_secret_explicit_value_wins(monkeypatch):
    from orchestrator.config import _resolve_jwt_secret
    monkeypatch.setenv("MURMUR_JWT_SECRET", "a" * 32)
    monkeypatch.delenv("MURMUR_ALLOW_DEV_SECRET", raising=False)
    assert _resolve_jwt_secret() == "a" * 32


async def test_login_rate_limited(client):
    await client.post(
        "/auth/register",
        json={"email": "rl@example.com", "password": "password123"},
    )
    for _ in range(5):
        res = await client.post(
            "/auth/login",
            json={"email": "rl@example.com", "password": "wrong"},
        )
        assert res.status_code == 401

    res = await client.post(
        "/auth/login",
        json={"email": "rl@example.com", "password": "wrong"},
    )
    assert res.status_code == 429


async def test_register_rate_limited(client):
    for i in range(3):
        res = await client.post(
            "/auth/register",
            json={"email": f"rl{i}@example.com", "password": "password123"},
        )
        assert res.status_code == 201

    res = await client.post(
        "/auth/register",
        json={"email": "rl4@example.com", "password": "password123"},
    )
    assert res.status_code == 429
