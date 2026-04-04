import pytest
from orchestrator.db import open_db

pytestmark = pytest.mark.anyio


async def test_running_jobs_reset_to_pending_on_startup(client):
    """Jobs left in 'running' status should be reset to 'pending' when the app starts."""
    from orchestrator.main import reset_stale_jobs

    # Seed a job in 'running' state (simulating a crash)
    async with open_db() as db:
        await db.execute(
            "INSERT INTO users (email, password_hash) VALUES ('sr@test.com', 'hash')"
        )
        await db.execute(
            "INSERT INTO reads (user_id, title, content) VALUES (1, 'Test', 'Hello.')"
        )
        await db.execute(
            "INSERT INTO audio_segments (read_id, segment_index, text) VALUES (1, 0, 'Hello.')"
        )
        await db.execute(
            """INSERT INTO jobs (user_id, read_id, voice, engine, status, total)
               VALUES (1, 1, 'alba', 'pocket-tts', 'running', 1)"""
        )
        await db.commit()

    await reset_stale_jobs()

    async with open_db() as db:
        rows = await db.execute_fetchall("SELECT status FROM jobs WHERE id = 1")
        assert dict(rows[0])["status"] == "pending"


async def test_waiting_for_backend_reset_to_pending(client):
    from orchestrator.main import reset_stale_jobs

    async with open_db() as db:
        await db.execute(
            "INSERT INTO users (email, password_hash) VALUES ('sr2@test.com', 'hash')"
        )
        await db.execute(
            "INSERT INTO reads (user_id, title, content) VALUES (1, 'Test', 'Hello.')"
        )
        await db.execute(
            "INSERT INTO audio_segments (read_id, segment_index, text) VALUES (1, 0, 'Hello.')"
        )
        await db.execute(
            """INSERT INTO jobs (user_id, read_id, voice, engine, status, total)
               VALUES (1, 1, 'alba', 'pocket-tts', 'waiting_for_backend', 1)"""
        )
        await db.commit()

    await reset_stale_jobs()

    async with open_db() as db:
        rows = await db.execute_fetchall("SELECT status FROM jobs WHERE id = 1")
        assert dict(rows[0])["status"] == "pending"


async def test_done_jobs_not_reset(client):
    from orchestrator.main import reset_stale_jobs

    async with open_db() as db:
        await db.execute(
            "INSERT INTO users (email, password_hash) VALUES ('sr3@test.com', 'hash')"
        )
        await db.execute(
            "INSERT INTO reads (user_id, title, content) VALUES (1, 'Test', 'Hello.')"
        )
        await db.execute(
            "INSERT INTO audio_segments (read_id, segment_index, text) VALUES (1, 0, 'Hello.')"
        )
        await db.execute(
            """INSERT INTO jobs (user_id, read_id, voice, engine, status, total)
               VALUES (1, 1, 'alba', 'pocket-tts', 'done', 1)"""
        )
        await db.commit()

    await reset_stale_jobs()

    async with open_db() as db:
        rows = await db.execute_fetchall("SELECT status FROM jobs WHERE id = 1")
        assert dict(rows[0])["status"] == "done"
