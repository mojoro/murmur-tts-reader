import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

logger = logging.getLogger(__name__)

import orchestrator.config as config
from orchestrator.config import AUDIO_DIR, DATA_DIR
from orchestrator.db import init_db, open_db
from orchestrator.engine_manager import engine_manager
from orchestrator.job_worker import job_worker
from orchestrator.routers.auth_router import router as auth_router
from orchestrator.routers.reads import router as reads_router
from orchestrator.routers.voices import router as voices_router
from orchestrator.routers.settings import router as settings_router
from orchestrator.routers.bookmarks import router as bookmarks_router
from orchestrator.routers.health import router as health_router
from orchestrator.routers.backends import router as backends_router
from orchestrator.routers.queue import router as queue_router


async def sync_builtin_voices():
    """Fetch builtin voices from the active engine and insert into DB."""
    engine_url = engine_manager.get_engine_url()
    if not engine_url:
        return
    try:
        import httpx
        async with httpx.AsyncClient() as client:
            resp = await client.get(f"{engine_url}/tts/voices", timeout=10)
            resp.raise_for_status()
        data = resp.json()
        async with open_db() as db:
            for voice_name in data.get("builtin", []):
                existing = await db.execute_fetchall(
                    "SELECT id FROM voices WHERE user_id IS NULL AND name = ?", (voice_name,)
                )
                if not existing:
                    await db.execute(
                        "INSERT INTO voices (user_id, name, type) VALUES (NULL, ?, 'builtin')", (voice_name,)
                    )
            await db.commit()
        logger.info(f"Synced {len(data.get('builtin', []))} builtin voices")
    except Exception as e:
        logger.warning(f"Failed to sync builtin voices: {e}")


async def reset_stale_jobs():
    """Reset jobs left in transient states after a restart."""
    async with open_db() as db:
        await db.execute(
            "UPDATE jobs SET status = 'pending', started_at = NULL WHERE status IN ('running', 'waiting_for_backend')"
        )
        await db.commit()


@asynccontextmanager
async def lifespan(app: FastAPI):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    await init_db()
    config.ENGINES_DIR.mkdir(parents=True, exist_ok=True)
    engine_manager.check_installed()
    # Auto-start pocket-tts if installed
    if engine_manager.get_status("pocket-tts").value in ("installed", "stopped"):
        logger.info("Auto-starting default engine: pocket-tts")
        started = await engine_manager.start_engine("pocket-tts")
        if started:
            await sync_builtin_voices()
    await reset_stale_jobs()
    await job_worker.start()
    yield
    await job_worker.stop()
    await engine_manager.shutdown()


app = FastAPI(title="Murmur Orchestrator", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(reads_router)
app.include_router(voices_router)
app.include_router(settings_router)
app.include_router(bookmarks_router)
app.include_router(health_router)
app.include_router(backends_router)
app.include_router(queue_router)


@app.get("/audio/{read_id}/{segment_index}")
async def serve_audio(read_id: int, segment_index: int):
    path = config.AUDIO_DIR / str(read_id) / f"{segment_index}.wav"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Audio not found")
    return FileResponse(path, media_type="audio/wav")
