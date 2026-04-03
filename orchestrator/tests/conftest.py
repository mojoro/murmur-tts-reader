import pytest
import pytest_asyncio
import aiosqlite
from pathlib import Path
from httpx import AsyncClient, ASGITransport

from orchestrator.main import app
from orchestrator.config import DB_PATH, DATA_DIR
from orchestrator.db import init_db
from orchestrator.engine_manager import EngineManager, EngineStatus

@pytest_asyncio.fixture
async def client(tmp_path, monkeypatch):
    monkeypatch.setattr("orchestrator.config.DATA_DIR", tmp_path)
    monkeypatch.setattr("orchestrator.config.DB_PATH", tmp_path / "test.db")
    monkeypatch.setattr("orchestrator.config.AUDIO_DIR", tmp_path / "audio")
    monkeypatch.setattr("orchestrator.config.VOICES_DIR", tmp_path / "voices" / "cloned")
    (tmp_path / "audio").mkdir()
    (tmp_path / "voices" / "cloned").mkdir(parents=True)
    await init_db()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest_asyncio.fixture(autouse=True)
async def reset_engine_manager(monkeypatch):
    """Reset engine manager state between tests."""
    fresh = EngineManager()
    monkeypatch.setattr("orchestrator.engine_manager.engine_manager", fresh)
    monkeypatch.setattr("orchestrator.routers.backends.engine_manager", fresh)
    try:
        monkeypatch.setattr("orchestrator.routers.health.engine_manager", fresh)
    except AttributeError:
        pass  # health router doesn't import engine_manager yet (added in Task 6)
    try:
        monkeypatch.setattr("orchestrator.routers.voices.engine_manager", fresh)
    except AttributeError:
        pass  # voices router doesn't import engine_manager yet (added in Task 5)
    yield fresh
