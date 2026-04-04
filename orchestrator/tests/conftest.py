import pytest
import pytest_asyncio
import aiosqlite
from pathlib import Path
from httpx import AsyncClient, ASGITransport

from orchestrator.main import app
from orchestrator.config import DB_PATH, DATA_DIR
from orchestrator.db import init_db
from orchestrator.engine_manager import EngineManager, EngineStatus
from orchestrator.job_events import JobEventBus

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


@pytest_asyncio.fixture(autouse=True)
async def reset_job_event_bus(monkeypatch):
    """Reset job event bus state between tests."""
    fresh = JobEventBus()
    monkeypatch.setattr("orchestrator.job_events.job_event_bus", fresh)

    # Patch in routers if they import job_event_bus (will be added in Task 4)
    try:
        import orchestrator.routers.reads
        monkeypatch.setattr("orchestrator.routers.reads.job_event_bus", fresh)
    except (ImportError, AttributeError):
        pass

    # Queue router will be created in Task 4
    try:
        import orchestrator.routers.queue
        monkeypatch.setattr("orchestrator.routers.queue.job_event_bus", fresh)
    except (ImportError, AttributeError):
        pass

    # Job worker will be created in Task 5
    try:
        import orchestrator.job_worker
        monkeypatch.setattr("orchestrator.job_worker.job_event_bus", fresh)
    except (ImportError, AttributeError):
        pass

    yield fresh
