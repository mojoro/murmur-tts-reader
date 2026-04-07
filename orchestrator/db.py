import aiosqlite
from contextlib import asynccontextmanager
from pathlib import Path

import orchestrator.config as config

_schema_path = Path(__file__).parent / "schema.sql"


async def init_db():
    async with aiosqlite.connect(config.DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        await db.execute("PRAGMA journal_mode=WAL")
        await db.execute("PRAGMA foreign_keys=ON")
        schema = _schema_path.read_text()
        await db.executescript(schema)
        await db.commit()
        await _migrate(db)


async def _migrate(db: aiosqlite.Connection):
    """Run lightweight migrations for columns added after initial schema."""
    cols = {row[1] for row in await db.execute_fetchall("PRAGMA table_info(reads)")}
    if "voice" not in cols:
        await db.execute("ALTER TABLE reads ADD COLUMN voice TEXT")
        await db.execute("ALTER TABLE reads ADD COLUMN engine TEXT")
        await db.execute("ALTER TABLE reads ADD COLUMN generated_at TEXT")
        # Backfill from the most recent completed job per read
        await db.execute(
            """UPDATE reads SET voice = j.voice, engine = j.engine, generated_at = j.completed_at
               FROM (
                   SELECT read_id, voice, engine, completed_at
                   FROM jobs
                   WHERE status = 'done'
                   AND id IN (
                       SELECT MAX(id) FROM jobs WHERE status = 'done' GROUP BY read_id
                   )
               ) j
               WHERE reads.id = j.read_id"""
        )
        await db.commit()
    if "generated_at" not in cols and "voice" in cols:
        await db.execute("ALTER TABLE reads ADD COLUMN generated_at TEXT")
        await db.execute(
            """UPDATE reads SET generated_at = j.completed_at
               FROM (
                   SELECT read_id, completed_at
                   FROM jobs
                   WHERE status = 'done'
                   AND id IN (
                       SELECT MAX(id) FROM jobs WHERE status = 'done' GROUP BY read_id
                   )
               ) j
               WHERE reads.id = j.read_id"""
        )
        await db.commit()


async def get_db():
    db = await aiosqlite.connect(config.DB_PATH)
    db.row_factory = aiosqlite.Row
    await db.execute("PRAGMA foreign_keys=ON")
    try:
        yield db
    finally:
        await db.close()


@asynccontextmanager
async def open_db():
    """Context manager for non-request code (background workers)."""
    db = await aiosqlite.connect(config.DB_PATH)
    db.row_factory = aiosqlite.Row
    await db.execute("PRAGMA foreign_keys=ON")
    try:
        yield db
    finally:
        await db.close()
