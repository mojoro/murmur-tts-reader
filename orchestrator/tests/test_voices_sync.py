import pytest
from unittest.mock import AsyncMock, MagicMock, patch

pytestmark = pytest.mark.anyio


async def _auth(client):
    res = await client.post("/auth/register", json={"email": "voice@test.com", "password": "password1"})
    uid = res.json()["user"]["id"]
    return uid, {"X-User-Id": str(uid)}


async def test_sync_no_engine(client):
    _, h = await _auth(client)
    res = await client.post("/voices/sync", headers=h)
    assert res.status_code == 503


async def test_sync_voices_from_engine(client, reset_engine_manager):
    _, h = await _auth(client)
    reset_engine_manager._active_engine = "pocket-tts"
    reset_engine_manager._statuses["pocket-tts"] = "running"

    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {"builtin": ["alba", "deniro"], "custom": []}
    mock_resp.raise_for_status = MagicMock()

    with patch("orchestrator.routers.voices.httpx.AsyncClient") as mock_cls:
        mock_client = AsyncMock()
        mock_client.get = AsyncMock(return_value=mock_resp)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_cls.return_value = mock_client

        res = await client.post("/voices/sync", headers=h)
        assert res.status_code == 200
        names = {v["name"] for v in res.json()}
        assert "alba" in names
        assert "deniro" in names


async def test_clone_no_engine(client):
    _, h = await _auth(client)
    res = await client.post(
        "/voices/clone",
        data={"name": "test-voice"},
        files={"file": ("test.wav", b"fake-wav-data", "audio/wav")},
        headers=h,
    )
    assert res.status_code == 503
