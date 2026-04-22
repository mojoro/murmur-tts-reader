import pytest

pytestmark = pytest.mark.anyio


async def _register(client) -> int:
    res = await client.post("/auth/register", json={"email": "reader@test.com", "password": "password1"})
    return res.json()["user"]["id"]


async def test_create_read(client):
    uid = await _register(client)
    res = await client.post("/reads", json={"title": "Test", "content": "Hello world. How are you?"}, headers={"X-User-Id": str(uid)})
    assert res.status_code == 201
    data = res.json()
    assert data["title"] == "Test"
    assert len(data["segments"]) == 2


async def test_list_reads(client):
    uid = await _register(client)
    await client.post("/reads", json={"title": "A", "content": "First."}, headers={"X-User-Id": str(uid)})
    await client.post("/reads", json={"title": "B", "content": "Second."}, headers={"X-User-Id": str(uid)})
    res = await client.get("/reads", headers={"X-User-Id": str(uid)})
    assert res.status_code == 200
    assert len(res.json()) == 2


async def test_get_read(client):
    uid = await _register(client)
    create = await client.post("/reads", json={"title": "Detail", "content": "One. Two."}, headers={"X-User-Id": str(uid)})
    read_id = create.json()["id"]
    res = await client.get(f"/reads/{read_id}", headers={"X-User-Id": str(uid)})
    assert res.status_code == 200
    assert res.json()["title"] == "Detail"
    assert len(res.json()["segments"]) == 2


async def test_update_read(client):
    uid = await _register(client)
    create = await client.post("/reads", json={"title": "Old", "content": "Text."}, headers={"X-User-Id": str(uid)})
    read_id = create.json()["id"]
    res = await client.patch(f"/reads/{read_id}", json={"title": "New", "progress_segment": 5}, headers={"X-User-Id": str(uid)})
    assert res.status_code == 200
    assert res.json()["title"] == "New"
    assert res.json()["progress_segment"] == 5


async def test_delete_read(client):
    uid = await _register(client)
    create = await client.post("/reads", json={"title": "Del", "content": "Gone."}, headers={"X-User-Id": str(uid)})
    read_id = create.json()["id"]
    res = await client.delete(f"/reads/{read_id}", headers={"X-User-Id": str(uid)})
    assert res.status_code == 204
    res = await client.get(f"/reads/{read_id}", headers={"X-User-Id": str(uid)})
    assert res.status_code == 404


async def test_user_isolation(client):
    r1 = await client.post("/auth/register", json={"email": "u1@test.com", "password": "password1"})
    r2 = await client.post("/auth/register", json={"email": "u2@test.com", "password": "password1"})
    uid1, uid2 = r1.json()["user"]["id"], r2.json()["user"]["id"]
    await client.post("/reads", json={"title": "U1", "content": "Mine."}, headers={"X-User-Id": str(uid1)})
    res = await client.get("/reads", headers={"X-User-Id": str(uid2)})
    assert len(res.json()) == 0
