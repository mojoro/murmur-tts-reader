import pytest
from orchestrator.engine_manager import EngineStatus

pytestmark = pytest.mark.anyio


async def _setup_with_job(client, reset_engine_manager):
    """Register user, create read, create a job."""
    res = await client.post(
        "/auth/register", json={"email": "queue@test.com", "password": "password1"}
    )
    uid = res.json()["user"]["id"]
    headers = {"X-User-Id": str(uid)}

    reset_engine_manager._active_engine = "pocket-tts"
    reset_engine_manager._statuses["pocket-tts"] = EngineStatus.RUNNING

    res = await client.post(
        "/reads",
        json={"title": "Test", "content": "Hello world. How are you."},
        headers=headers,
    )
    read_id = res.json()["id"]

    res = await client.post(
        f"/reads/{read_id}/generate",
        json={"voice": "alba"},
        headers=headers,
    )
    job_id = res.json()["id"]
    return uid, headers, read_id, job_id


async def test_list_queue_empty(client):
    res = await client.post(
        "/auth/register", json={"email": "q1@test.com", "password": "password1"}
    )
    headers = {"X-User-Id": str(res.json()["user"]["id"])}
    res = await client.get("/queue", headers=headers)
    assert res.status_code == 200
    assert res.json() == []


async def test_list_queue_with_job(client, reset_engine_manager):
    _, headers, _, job_id = await _setup_with_job(client, reset_engine_manager)
    res = await client.get("/queue", headers=headers)
    assert res.status_code == 200
    jobs = res.json()
    assert len(jobs) == 1
    assert jobs[0]["id"] == job_id
    assert jobs[0]["status"] == "pending"


async def test_cancel_pending_job(client, reset_engine_manager):
    _, headers, _, job_id = await _setup_with_job(client, reset_engine_manager)
    res = await client.delete(f"/queue/{job_id}", headers=headers)
    assert res.status_code == 204

    res = await client.get("/queue", headers=headers)
    jobs = res.json()
    assert jobs[0]["status"] == "cancelled"


async def test_cancel_already_done(client, reset_engine_manager):
    uid, headers, _, job_id = await _setup_with_job(client, reset_engine_manager)
    # Manually set job to done
    from orchestrator.db import get_db
    async for db in get_db():
        await db.execute(
            "UPDATE jobs SET status = 'done', completed_at = datetime('now') WHERE id = ?",
            (job_id,),
        )
        await db.commit()

    res = await client.delete(f"/queue/{job_id}", headers=headers)
    assert res.status_code == 409


async def test_cancel_other_users_job(client, reset_engine_manager):
    _, _, _, job_id = await _setup_with_job(client, reset_engine_manager)
    # Register second user
    res = await client.post(
        "/auth/register", json={"email": "q2@test.com", "password": "password1"}
    )
    headers2 = {"X-User-Id": str(res.json()["user"]["id"])}
    res = await client.delete(f"/queue/{job_id}", headers=headers2)
    assert res.status_code == 404


async def test_queue_user_isolation(client, reset_engine_manager):
    _, headers1, _, _ = await _setup_with_job(client, reset_engine_manager)
    # Second user sees empty queue
    res = await client.post(
        "/auth/register", json={"email": "q3@test.com", "password": "password1"}
    )
    headers2 = {"X-User-Id": str(res.json()["user"]["id"])}
    res = await client.get("/queue", headers=headers2)
    assert res.json() == []
