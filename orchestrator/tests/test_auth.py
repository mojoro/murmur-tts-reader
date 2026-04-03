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
