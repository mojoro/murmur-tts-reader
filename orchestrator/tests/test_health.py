import pytest

pytestmark = pytest.mark.anyio


async def test_health(client):
    res = await client.get("/health")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "ok"
    assert data["db"] == "ok"
    assert data["active_engine"] is None


async def test_health_with_active_engine(client, reset_engine_manager):
    reset_engine_manager._active_engine = "pocket-tts"
    res = await client.get("/health")
    assert res.json()["active_engine"] == "pocket-tts"
