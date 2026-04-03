import pytest

pytestmark = pytest.mark.anyio


async def _auth(client) -> tuple[int, dict]:
    res = await client.post("/auth/register", json={"email": "v@test.com", "password": "p"})
    uid = res.json()["user"]["id"]
    return uid, {"X-User-Id": str(uid)}


async def test_list_voices_empty(client):
    _, h = await _auth(client)
    res = await client.get("/voices", headers=h)
    assert res.status_code == 200
    assert res.json() == []


async def test_list_voices_includes_builtin_and_user_clones(client):
    uid, h = await _auth(client)
    # Manually insert a shared builtin voice and a user clone
    from orchestrator.db import get_db
    async for db in get_db():
        await db.execute("INSERT INTO voices (user_id, name, type) VALUES (NULL, 'alba', 'builtin')")
        await db.execute("INSERT INTO voices (user_id, name, type) VALUES (?, 'my-voice', 'cloned')", (uid,))
        await db.commit()
    res = await client.get("/voices", headers=h)
    names = {v["name"] for v in res.json()}
    assert "alba" in names
    assert "my-voice" in names


async def test_delete_own_clone(client):
    uid, h = await _auth(client)
    from orchestrator.db import get_db
    async for db in get_db():
        cursor = await db.execute("INSERT INTO voices (user_id, name, type) VALUES (?, 'del-me', 'cloned')", (uid,))
        await db.commit()
        voice_id = cursor.lastrowid
    res = await client.delete(f"/voices/{voice_id}", headers=h)
    assert res.status_code == 204
