import pytest
from orchestrator.engine_manager import EngineStatus

pytestmark = pytest.mark.anyio


AUTH = {"X-User-Id": "1"}


async def test_list_backends(client):
    res = await client.get("/backends")
    assert res.status_code == 200
    backends = res.json()
    assert len(backends) == 5
    names = {b["name"] for b in backends}
    assert "pocket-tts" in names
    assert "xtts-v2" in names


async def test_list_backends_includes_status(client, reset_engine_manager):
    reset_engine_manager._statuses["pocket-tts"] = EngineStatus.INSTALLED
    res = await client.get("/backends")
    pocket = next(b for b in res.json() if b["name"] == "pocket-tts")
    assert pocket["status"] == "installed"


async def test_select_unknown_engine(client):
    res = await client.post("/backends/select", headers=AUTH, json={"name": "nonexistent"})
    assert res.status_code == 404


async def test_select_engine_not_installed(client, reset_engine_manager, tmp_path):
    # Make engine_dir return a nonexistent path so the engine can't start
    reset_engine_manager._engine_dir = lambda name: tmp_path / "nonexistent" / name
    res = await client.post("/backends/select", headers=AUTH, json={"name": "pocket-tts"})
    assert res.status_code == 503


async def test_select_backend_requires_auth(client):
    res = await client.post("/backends/select", json={"name": "pocket-tts"})
    assert res.status_code == 401


async def test_install_backend_requires_auth(client):
    res = await client.post("/backends/install", json={"name": "pocket-tts"})
    assert res.status_code == 401


async def test_uninstall_backend_requires_auth(client):
    res = await client.delete("/backends/pocket-tts")
    assert res.status_code == 401
