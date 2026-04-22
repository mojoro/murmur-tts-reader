import pytest

pytestmark = pytest.mark.anyio


async def _setup(client):
    reg = await client.post("/auth/register", json={"email": "bm@test.com", "password": "password1"})
    uid = reg.json()["user"]["id"]
    h = {"X-User-Id": str(uid)}
    create = await client.post("/reads", json={"title": "BM Test", "content": "One. Two."}, headers=h)
    read_id = create.json()["id"]
    return uid, read_id, h


async def test_add_bookmark(client):
    uid, read_id, h = await _setup(client)
    res = await client.post(f"/reads/{read_id}/bookmarks", json={"segment_index": 0, "note": "important"}, headers=h)
    assert res.status_code == 201
    assert res.json()["note"] == "important"


async def test_list_bookmarks(client):
    uid, read_id, h = await _setup(client)
    await client.post(f"/reads/{read_id}/bookmarks", json={"segment_index": 0}, headers=h)
    await client.post(f"/reads/{read_id}/bookmarks", json={"segment_index": 1}, headers=h)
    res = await client.get(f"/reads/{read_id}/bookmarks", headers=h)
    assert len(res.json()) == 2


async def test_update_bookmark(client):
    uid, read_id, h = await _setup(client)
    create = await client.post(f"/reads/{read_id}/bookmarks", json={"segment_index": 0}, headers=h)
    bm_id = create.json()["id"]
    res = await client.patch(f"/bookmarks/{bm_id}", json={"note": "updated"}, headers=h)
    assert res.json()["note"] == "updated"


async def test_delete_bookmark(client):
    uid, read_id, h = await _setup(client)
    create = await client.post(f"/reads/{read_id}/bookmarks", json={"segment_index": 0}, headers=h)
    bm_id = create.json()["id"]
    res = await client.delete(f"/bookmarks/{bm_id}", headers=h)
    assert res.status_code == 204
