import aiosqlite
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


async def get_db():
    db = await aiosqlite.connect(config.DB_PATH)
    db.row_factory = aiosqlite.Row
    await db.execute("PRAGMA foreign_keys=ON")
    try:
        yield db
    finally:
        await db.close()
