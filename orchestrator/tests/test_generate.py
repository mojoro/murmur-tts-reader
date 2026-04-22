import pytest
from orchestrator.engine_manager import EngineStatus

pytestmark = pytest.mark.anyio


async def _setup(client):
    """Register user and create a read with segments."""
    res = await client.post(
        "/auth/register", json={"email": "gen@test.com", "password": "password1"}
    )
    uid = res.json()["user"]["id"]
    headers = {"X-User-Id": str(uid)}
    res = await client.post(
        "/reads",
        json={"title": "Test", "content": "Hello world. How are you."},
        headers=headers,
    )
    read_id = res.json()["id"]
    return uid, headers, read_id


async def test_generate_no_engine(client):
    _, headers, read_id = await _setup(client)
    res = await client.post(
        f"/reads/{read_id}/generate",
        json={"voice": "alba"},
        headers=headers,
    )
    assert res.status_code == 503
    assert "No TTS engine" in res.json()["detail"]


async def test_generate_creates_job(client, reset_engine_manager):
    uid, headers, read_id = await _setup(client)
    reset_engine_manager._active_engine = "pocket-tts"
    reset_engine_manager._statuses["pocket-tts"] = EngineStatus.RUNNING

    res = await client.post(
        f"/reads/{read_id}/generate",
        json={"voice": "alba"},
        headers=headers,
    )
    assert res.status_code == 201
    job = res.json()
    assert job["read_id"] == read_id
    assert job["voice"] == "alba"
    assert job["engine"] == "pocket-tts"
    assert job["status"] == "pending"
    assert job["total"] == 2  # "Hello world." + "How are you."
    assert job["progress"] == 0


async def test_generate_with_language(client, reset_engine_manager):
    uid, headers, read_id = await _setup(client)
    reset_engine_manager._active_engine = "pocket-tts"
    reset_engine_manager._statuses["pocket-tts"] = EngineStatus.RUNNING

    res = await client.post(
        f"/reads/{read_id}/generate",
        json={"voice": "alba", "language": "en"},
        headers=headers,
    )
    assert res.status_code == 201
    assert res.json()["language"] == "en"


async def test_generate_read_not_found(client, reset_engine_manager):
    res = await client.post(
        "/auth/register", json={"email": "gen2@test.com", "password": "password1"}
    )
    headers = {"X-User-Id": str(res.json()["user"]["id"])}
    reset_engine_manager._active_engine = "pocket-tts"
    reset_engine_manager._statuses["pocket-tts"] = EngineStatus.RUNNING

    res = await client.post(
        "/reads/9999/generate",
        json={"voice": "alba"},
        headers=headers,
    )
    assert res.status_code == 404


async def test_generate_rejects_duplicate_pending_job(client, reset_engine_manager):
    uid, headers, read_id = await _setup(client)
    reset_engine_manager._active_engine = "pocket-tts"
    reset_engine_manager._statuses["pocket-tts"] = EngineStatus.RUNNING

    res1 = await client.post(
        f"/reads/{read_id}/generate",
        json={"voice": "alba"},
        headers=headers,
    )
    assert res1.status_code == 201

    res2 = await client.post(
        f"/reads/{read_id}/generate",
        json={"voice": "alba"},
        headers=headers,
    )
    assert res2.status_code == 409
