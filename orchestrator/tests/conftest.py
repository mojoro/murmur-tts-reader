import os

os.environ.setdefault("MURMUR_ALLOW_DEV_SECRET", "1")

import pytest_asyncio
from httpx import AsyncClient, ASGITransport

from orchestrator.main import app
from orchestrator.db import init_db
from orchestrator.engine_manager import EngineManager
from orchestrator.job_events import JobEventBus
from orchestrator.job_worker import JobWorker

@pytest_asyncio.fixture
async def client(tmp_path, monkeypatch):
    monkeypatch.setattr("orchestrator.config.DATA_DIR", tmp_path)
    monkeypatch.setattr("orchestrator.config.DB_PATH", tmp_path / "test.db")
    monkeypatch.setattr("orchestrator.config.AUDIO_DIR", tmp_path / "audio")
    monkeypatch.setattr("orchestrator.config.VOICES_DIR", tmp_path / "voices" / "cloned")
    monkeypatch.setattr("orchestrator.config.THUMBNAILS_DIR", tmp_path / "thumbnails")
    monkeypatch.setattr("orchestrator.config.IMAGES_DIR", tmp_path / "images")
    (tmp_path / "audio").mkdir()
    (tmp_path / "voices" / "cloned").mkdir(parents=True)
    (tmp_path / "thumbnails").mkdir()
    (tmp_path / "images").mkdir()
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
    monkeypatch.setattr("orchestrator.routers.reads.engine_manager", fresh)
    monkeypatch.setattr("orchestrator.routers.health.engine_manager", fresh)
    monkeypatch.setattr("orchestrator.routers.voices.engine_manager", fresh)
    monkeypatch.setattr("orchestrator.job_worker.engine_manager", fresh)
    yield fresh


@pytest_asyncio.fixture(autouse=True)
async def reset_job_event_bus(monkeypatch):
    """Reset job event bus state between tests."""
    fresh = JobEventBus()
    monkeypatch.setattr("orchestrator.job_events.job_event_bus", fresh)
    monkeypatch.setattr("orchestrator.routers.reads.job_event_bus", fresh)
    monkeypatch.setattr("orchestrator.routers.queue.job_event_bus", fresh)
    monkeypatch.setattr("orchestrator.job_worker.job_event_bus", fresh)
    yield fresh


@pytest_asyncio.fixture(autouse=True)
async def disable_job_worker(monkeypatch):
    """Prevent worker from running during endpoint tests."""
    fresh = JobWorker()
    monkeypatch.setattr("orchestrator.job_worker.job_worker", fresh)
    monkeypatch.setattr("orchestrator.main.job_worker", fresh)
    yield fresh
