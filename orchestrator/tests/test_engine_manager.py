import pytest
import asyncio
from orchestrator.engine_manager import EngineManager, EngineStatus

pytestmark = pytest.mark.anyio


@pytest.fixture
def manager(tmp_path, monkeypatch):
    monkeypatch.setattr("orchestrator.config.ENGINES_DIR", tmp_path / "engines")
    monkeypatch.setattr("orchestrator.config.ENGINE_PORT", 9999)
    m = EngineManager()
    return m


def test_initial_status(manager):
    for name, status in manager.get_all_statuses().items():
        assert status == EngineStatus.AVAILABLE


def test_check_installed_detects_engines(manager, tmp_path):
    engine_dir = tmp_path / "fake-engine"
    engine_dir.mkdir()
    (engine_dir / "main.py").touch()
    manager._engine_dir = lambda name: engine_dir if name == "pocket-tts" else tmp_path / "nope"
    manager.check_installed()
    assert manager.get_status("pocket-tts") == EngineStatus.INSTALLED


async def test_stop_engine_when_none_running(manager):
    await manager.stop_engine()
    assert manager.active_engine is None


async def test_subscribe_unsubscribe(manager):
    q = manager.subscribe()
    assert q in manager._listeners
    manager.unsubscribe(q)
    assert q not in manager._listeners


async def test_emit_event_reaches_subscribers(manager):
    q = manager.subscribe()
    await manager._emit_event("backend:status", {"name": "test", "status": "running"})
    msg = await asyncio.wait_for(q.get(), timeout=1)
    assert msg["event"] == "backend:status"
    assert "test" in msg["data"]
    manager.unsubscribe(q)
