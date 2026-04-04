import json
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from orchestrator.db import init_db, open_db
from orchestrator.engine_manager import EngineManager, EngineStatus
from orchestrator.job_events import JobEventBus
from orchestrator.job_worker import JobWorker

pytestmark = pytest.mark.anyio


@pytest.fixture
def event_bus():
    return JobEventBus()


@pytest.fixture
def em():
    m = EngineManager()
    m._active_engine = "pocket-tts"
    m._statuses["pocket-tts"] = EngineStatus.RUNNING
    return m


@pytest.fixture
async def worker(tmp_path, monkeypatch, event_bus, em):
    monkeypatch.setattr("orchestrator.config.DATA_DIR", tmp_path)
    monkeypatch.setattr("orchestrator.config.DB_PATH", tmp_path / "test.db")
    monkeypatch.setattr("orchestrator.config.AUDIO_DIR", tmp_path / "audio")
    monkeypatch.setattr("orchestrator.config.ALIGN_SERVER_URL", "http://localhost:8001")
    (tmp_path / "audio").mkdir()
    await init_db()

    monkeypatch.setattr("orchestrator.job_worker.engine_manager", em)
    monkeypatch.setattr("orchestrator.job_worker.job_event_bus", event_bus)
    return JobWorker()


async def _seed_job(user_id=1, read_text="Hello world. How are you."):
    """Insert a user, read, segments, and pending job. Return (job_id, read_id)."""
    from orchestrator.sentence_splitter import split_sentences

    async with open_db() as db:
        await db.execute(
            "INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)",
            (user_id, f"u{user_id}@test.com", "hash"),
        )
        await db.execute(
            "INSERT INTO reads (id, user_id, title, content) VALUES (?, ?, ?, ?)",
            (1, user_id, "Test", read_text),
        )
        sentences = split_sentences(read_text)
        for i, text in enumerate(sentences):
            await db.execute(
                "INSERT INTO audio_segments (read_id, segment_index, text) VALUES (?, ?, ?)",
                (1, i, text),
            )
        total = len(sentences)
        await db.execute(
            "INSERT INTO jobs (user_id, read_id, voice, engine, total) VALUES (?, ?, ?, ?, ?)",
            (user_id, 1, "alba", "pocket-tts", total),
        )
        await db.commit()
        rows = await db.execute_fetchall("SELECT id FROM jobs ORDER BY id DESC LIMIT 1")
        return dict(rows[0])["id"], 1


def _mock_httpx(tts_audio=b"RIFF" + b"\x00" * 100, align_words=None):
    """Return a patched httpx.AsyncClient that mocks TTS and alignment calls."""
    if align_words is None:
        align_words = [{"word": "hello", "start": 0.0, "end": 0.5}]

    tts_resp = MagicMock()
    tts_resp.status_code = 200
    tts_resp.content = tts_audio
    tts_resp.raise_for_status = MagicMock()

    align_resp = MagicMock()
    align_resp.status_code = 200
    align_resp.json.return_value = {"words": align_words}
    align_resp.raise_for_status = MagicMock()

    mock_client = AsyncMock()

    async def route_post(url, **kwargs):
        if "/tts/generate" in url:
            return tts_resp
        if "/align" in url:
            return align_resp
        raise ValueError(f"Unexpected URL: {url}")

    mock_client.post = AsyncMock(side_effect=route_post)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    return mock_client


async def test_pick_next_job(worker):
    job_id, _ = await _seed_job()
    job = await worker._pick_next_job()
    assert job is not None
    assert job["id"] == job_id
    assert job["status"] == "running"


async def test_pick_next_job_fifo(worker):
    """Earlier job is picked first."""
    await _seed_job(user_id=1)
    # Add a second user + read + job
    async with open_db() as db:
        await db.execute(
            "INSERT INTO users (id, email, password_hash) VALUES (2, 'u2@test.com', 'hash')"
        )
        await db.execute(
            "INSERT INTO reads (id, user_id, title, content) VALUES (2, 2, 'Read2', 'One sentence.')"
        )
        await db.execute(
            "INSERT INTO audio_segments (read_id, segment_index, text) VALUES (2, 0, 'One sentence.')"
        )
        await db.execute(
            "INSERT INTO jobs (user_id, read_id, voice, engine, total) VALUES (2, 2, 'alba', 'pocket-tts', 1)"
        )
        await db.commit()

    job = await worker._pick_next_job()
    assert job["read_id"] == 1  # first job


async def test_pick_next_job_none_pending(worker):
    job = await worker._pick_next_job()
    assert job is None


async def test_process_segment(worker, tmp_path):
    job_id, read_id = await _seed_job(read_text="Hello world.")
    job = await worker._pick_next_job()

    async with open_db() as db:
        rows = await db.execute_fetchall(
            "SELECT * FROM audio_segments WHERE read_id = ? ORDER BY segment_index", (read_id,)
        )
        segment = dict(rows[0])

    mock_client = _mock_httpx()
    with patch("orchestrator.job_worker.httpx.AsyncClient") as mock_cls:
        mock_cls.return_value = mock_client
        result = await worker._process_segment(job, segment)

    assert result is True
    # Verify audio file written
    wav_path = tmp_path / "audio" / str(read_id) / "0.wav"
    assert wav_path.exists()

    # Verify DB updated
    async with open_db() as db:
        rows = await db.execute_fetchall(
            "SELECT * FROM audio_segments WHERE read_id = ? AND segment_index = 0", (read_id,)
        )
        seg = dict(rows[0])
        assert seg["audio_generated"] == 1
        assert seg["word_timings_json"] is not None
        assert seg["generated_at"] is not None

        rows = await db.execute_fetchall("SELECT * FROM jobs WHERE id = ?", (job_id,))
        assert dict(rows[0])["progress"] == 1


async def test_process_job_all_segments(worker, event_bus):
    job_id, read_id = await _seed_job()
    q = event_bus.subscribe(user_id=1)

    mock_client = _mock_httpx()
    with patch("orchestrator.job_worker.httpx.AsyncClient") as mock_cls:
        mock_cls.return_value = mock_client
        await worker._process_job(await worker._pick_next_job())

    # Job should be done
    async with open_db() as db:
        rows = await db.execute_fetchall("SELECT * FROM jobs WHERE id = ?", (job_id,))
        job = dict(rows[0])
        assert job["status"] == "done"
        assert job["completed_at"] is not None

    # Check events emitted
    events = []
    while not q.empty():
        events.append(await q.get())
    event_types = [e["event"] for e in events]
    assert "job:started" in event_types
    assert "job:progress" in event_types
    assert "job:completed" in event_types


async def test_process_job_cancelled_mid_run(worker, event_bus):
    job_id, _ = await _seed_job(read_text="One. Two. Three. Four. Five.")
    q = event_bus.subscribe(user_id=1)

    call_count = 0

    async def cancel_after_two(url, **kwargs):
        nonlocal call_count
        if "/tts/generate" in url:
            call_count += 1
            if call_count == 2:
                # Cancel the job in DB (simulates user cancel via API)
                async with open_db() as db:
                    await db.execute(
                        "UPDATE jobs SET status = 'cancelled' WHERE id = ?", (job_id,)
                    )
                    await db.commit()
            resp = MagicMock()
            resp.status_code = 200
            resp.content = b"RIFF" + b"\x00" * 100
            resp.raise_for_status = MagicMock()
            return resp
        if "/align" in url:
            resp = MagicMock()
            resp.status_code = 200
            resp.json.return_value = {"words": []}
            resp.raise_for_status = MagicMock()
            return resp
        raise ValueError(f"Unexpected: {url}")

    mock_client = AsyncMock()
    mock_client.post = AsyncMock(side_effect=cancel_after_two)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)

    with patch("orchestrator.job_worker.httpx.AsyncClient") as mock_cls:
        mock_cls.return_value = mock_client
        await worker._process_job(await worker._pick_next_job())

    # Should have processed 2 segments, then stopped
    async with open_db() as db:
        rows = await db.execute_fetchall("SELECT * FROM jobs WHERE id = ?", (job_id,))
        job = dict(rows[0])
        assert job["status"] == "cancelled"
        assert job["progress"] == 2

    events = []
    while not q.empty():
        events.append(await q.get())
    event_types = [e["event"] for e in events]
    assert "job:cancelled" in event_types


async def test_resume_waiting_jobs_when_engine_back(worker, em):
    """waiting_for_backend jobs should be reset to pending when engine is available."""
    await _seed_job()
    # Simulate: job was set to waiting_for_backend
    async with open_db() as db:
        await db.execute("UPDATE jobs SET status = 'waiting_for_backend' WHERE id = 1")
        await db.commit()

    # Engine is available (em fixture has active engine)
    await worker._resume_waiting_jobs()

    async with open_db() as db:
        rows = await db.execute_fetchall("SELECT status FROM jobs WHERE id = 1")
        assert dict(rows[0])["status"] == "pending"


async def test_resume_waiting_jobs_skipped_when_no_engine(worker, em):
    """waiting_for_backend jobs should NOT be reset when engine is still down."""
    await _seed_job()
    async with open_db() as db:
        await db.execute("UPDATE jobs SET status = 'waiting_for_backend' WHERE id = 1")
        await db.commit()

    em._active_engine = None  # engine down

    await worker._resume_waiting_jobs()

    async with open_db() as db:
        rows = await db.execute_fetchall("SELECT status FROM jobs WHERE id = 1")
        assert dict(rows[0])["status"] == "waiting_for_backend"


async def test_process_job_engine_down(worker, em, event_bus):
    job_id, _ = await _seed_job()
    q = event_bus.subscribe(user_id=1)

    # Clear active engine to simulate engine down
    em._active_engine = None

    await worker._process_job(await worker._pick_next_job())

    async with open_db() as db:
        rows = await db.execute_fetchall("SELECT * FROM jobs WHERE id = ?", (job_id,))
        job = dict(rows[0])
        assert job["status"] == "waiting_for_backend"


async def test_process_segment_tts_failure(worker, em):
    job_id, read_id = await _seed_job(read_text="Hello world.")
    job = await worker._pick_next_job()

    async with open_db() as db:
        rows = await db.execute_fetchall(
            "SELECT * FROM audio_segments WHERE read_id = ? ORDER BY segment_index", (read_id,)
        )
        segment = dict(rows[0])

    mock_client = AsyncMock()
    mock_client.post = AsyncMock(side_effect=Exception("TTS engine error"))
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)

    with patch("orchestrator.job_worker.httpx.AsyncClient") as mock_cls:
        mock_cls.return_value = mock_client
        result = await worker._process_segment(job, segment)

    assert result is False


async def test_alignment_failure_continues(worker, tmp_path):
    """Alignment failure should not fail the segment — audio is still saved."""
    job_id, read_id = await _seed_job(read_text="Hello world.")
    job = await worker._pick_next_job()

    async with open_db() as db:
        rows = await db.execute_fetchall(
            "SELECT * FROM audio_segments WHERE read_id = ? ORDER BY segment_index", (read_id,)
        )
        segment = dict(rows[0])

    tts_resp = MagicMock()
    tts_resp.status_code = 200
    tts_resp.content = b"RIFF" + b"\x00" * 100
    tts_resp.raise_for_status = MagicMock()

    async def route_post(url, **kwargs):
        if "/tts/generate" in url:
            return tts_resp
        if "/align" in url:
            raise Exception("Alignment server down")
        raise ValueError(f"Unexpected: {url}")

    mock_client = AsyncMock()
    mock_client.post = AsyncMock(side_effect=route_post)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)

    with patch("orchestrator.job_worker.httpx.AsyncClient") as mock_cls:
        mock_cls.return_value = mock_client
        result = await worker._process_segment(job, segment)

    assert result is True
    # Audio saved, but no word timings
    wav_path = tmp_path / "audio" / str(read_id) / "0.wav"
    assert wav_path.exists()

    async with open_db() as db:
        rows = await db.execute_fetchall(
            "SELECT * FROM audio_segments WHERE read_id = ? AND segment_index = 0", (read_id,)
        )
        seg = dict(rows[0])
        assert seg["audio_generated"] == 1
        assert seg["word_timings_json"] is None
