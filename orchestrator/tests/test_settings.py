import pytest

pytestmark = pytest.mark.anyio


async def _auth(client):
    res = await client.post("/auth/register", json={"email": "s@test.com", "password": "p"})
    uid = res.json()["user"]["id"]
    return uid, {"X-User-Id": str(uid)}


async def test_get_empty_settings(client):
    _, h = await _auth(client)
    res = await client.get("/settings", headers=h)
    assert res.status_code == 200
    assert res.json()["settings"] == {}


async def test_patch_and_get_settings(client):
    _, h = await _auth(client)
    await client.patch("/settings", json={"settings": {"theme": "dark", "active_engine": "pocket-tts"}}, headers=h)
    res = await client.get("/settings", headers=h)
    data = res.json()["settings"]
    assert data["theme"] == "dark"
    assert data["active_engine"] == "pocket-tts"


async def test_settings_user_isolation(client):
    r1 = await client.post("/auth/register", json={"email": "s1@test.com", "password": "p"})
    r2 = await client.post("/auth/register", json={"email": "s2@test.com", "password": "p"})
    h1 = {"X-User-Id": str(r1.json()["user"]["id"])}
    h2 = {"X-User-Id": str(r2.json()["user"]["id"])}
    await client.patch("/settings", json={"settings": {"engine": "xtts"}}, headers=h1)
    res = await client.get("/settings", headers=h2)
    assert res.json()["settings"] == {}
