import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, Header, HTTPException, Request, UploadFile
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
    config.THUMBNAILS_DIR.mkdir(parents=True, exist_ok=True)
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

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    datefmt="%H:%M:%S",
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


THUMB_MEDIA_TYPES = {
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif",
}


@app.post("/reads/{read_id}/thumbnail", status_code=204)
async def upload_thumbnail(read_id: int, request: Request, file: UploadFile | None = None):
    content_type = request.content_type or ""

    if file and file.size:
        data = await file.read()
        ext = _ext_from_content_type(file.content_type or "image/jpeg")
    elif "application/json" in content_type:
        import httpx
        body = await request.json()
        url = body.get("url")
        if not url:
            raise HTTPException(status_code=400, detail="url required")
        try:
            async with httpx.AsyncClient(follow_redirects=True, timeout=15) as client:
                resp = await client.get(url, headers={
                    "User-Agent": "Mozilla/5.0 (compatible; Murmur/1.0)",
                })
                resp.raise_for_status()
            data = resp.content
            ext = _ext_from_content_type(resp.headers.get("content-type", "image/jpeg"))
        except Exception as e:
            logger.warning("Failed to download thumbnail from %s: %s", url, e)
            raise HTTPException(status_code=502, detail="Failed to download thumbnail")
    else:
        raise HTTPException(status_code=400, detail="Send file upload or JSON {url}")

    # Remove any existing thumbnail for this read
    for existing in config.THUMBNAILS_DIR.glob(f"{read_id}.*"):
        existing.unlink()

    path = config.THUMBNAILS_DIR / f"{read_id}{ext}"
    path.write_bytes(data)
    logger.info("Saved thumbnail for read=%d (%d bytes)", read_id, len(data))


@app.get("/thumbnails/{read_id}")
async def serve_thumbnail(read_id: int):
    for ext, media_type in THUMB_MEDIA_TYPES.items():
        path = config.THUMBNAILS_DIR / f"{read_id}{ext}"
        if path.exists():
            return FileResponse(path, media_type=media_type)
    raise HTTPException(status_code=404, detail="Thumbnail not found")


def _ext_from_content_type(ct: str) -> str:
    ct = ct.lower().split(";")[0].strip()
    for ext, mt in THUMB_MEDIA_TYPES.items():
        if mt == ct:
            return ext
    return ".jpg"
