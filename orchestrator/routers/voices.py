import logging
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
import aiosqlite
import httpx

from orchestrator.db import get_db
from orchestrator.auth import get_current_user_id
from orchestrator.models import VoiceResponse
from orchestrator.engine_manager import engine_manager
import orchestrator.config as config

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/voices", tags=["voices"])


@router.get("", response_model=list[VoiceResponse])
async def list_voices(user_id: int = Depends(get_current_user_id), db: aiosqlite.Connection = Depends(get_db)):
    rows = await db.execute_fetchall(
        "SELECT * FROM voices WHERE user_id IS NULL OR user_id = ? ORDER BY type, name",
        (user_id,),
    )
    return [VoiceResponse(**dict(r)) for r in rows]


@router.post("/sync", response_model=list[VoiceResponse])
async def sync_voices(user_id: int = Depends(get_current_user_id), db: aiosqlite.Connection = Depends(get_db)):
    """Fetch voices from the active TTS engine and upsert into DB."""
    engine_url = engine_manager.get_engine_url()
    if not engine_url:
        logger.warning("Voice sync failed: no engine running (user=%d)", user_id)
        raise HTTPException(status_code=503, detail="No TTS engine running")

    logger.info("Syncing voices from engine at %s (user=%d)", engine_url, user_id)
    async with httpx.AsyncClient() as client:
        try:
            resp = await client.get(f"{engine_url}/tts/voices", timeout=10)
            resp.raise_for_status()
        except (httpx.ConnectError, httpx.HTTPStatusError) as e:
            logger.error("Voice sync failed: cannot reach engine at %s: %s", engine_url, e)
            raise HTTPException(status_code=503, detail=f"Failed to reach TTS engine: {e}")

    data = resp.json()
    builtin = data.get("builtin", [])
    custom = data.get("custom", [])
    logger.info("Engine returned %d builtin, %d custom voices", len(builtin), len(custom))
    for voice_name in builtin:
        existing = await db.execute_fetchall(
            "SELECT id FROM voices WHERE user_id IS NULL AND name = ?", (voice_name,)
        )
        if not existing:
            await db.execute(
                "INSERT INTO voices (user_id, name, type) VALUES (NULL, ?, 'builtin')", (voice_name,)
            )
    await db.commit()

    rows = await db.execute_fetchall(
        "SELECT * FROM voices WHERE user_id IS NULL OR user_id = ? ORDER BY type, name",
        (user_id,),
    )
    return [VoiceResponse(**dict(r)) for r in rows]


@router.post("/clone", response_model=VoiceResponse, status_code=201)
async def clone_voice(
    name: str = Form(...),
    file: UploadFile = File(...),
    prompt_text: str | None = Form(None),
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Clone a voice by uploading a WAV file to the active TTS engine."""
    engine_url = engine_manager.get_engine_url()
    if not engine_url:
        logger.warning("Voice clone failed: no engine running (user=%d, name=%s)", user_id, name)
        raise HTTPException(status_code=503, detail="No TTS engine running")

    logger.info("Cloning voice name=%s from file=%s (user=%d)", name, file.filename, user_id)
    user_voices_dir = config.VOICES_DIR / str(user_id)
    user_voices_dir.mkdir(parents=True, exist_ok=True)
    wav_path = user_voices_dir / f"{name}.wav"
    content = await file.read()
    wav_path.write_bytes(content)

    async with httpx.AsyncClient() as client:
        files = {"file": (f"{name}.wav", content, "audio/wav")}
        form_data = {"name": name}
        if prompt_text:
            form_data["prompt_text"] = prompt_text
        try:
            resp = await client.post(f"{engine_url}/tts/clone-voice", files=files, data=form_data, timeout=60)
            resp.raise_for_status()
        except (httpx.ConnectError, httpx.HTTPStatusError) as e:
            logger.error("Voice clone failed: engine error for name=%s: %s", name, e)
            wav_path.unlink(missing_ok=True)
            raise HTTPException(status_code=503, detail=f"Failed to clone voice: {e}")

    cursor = await db.execute(
        "INSERT INTO voices (user_id, name, type, wav_path) VALUES (?, ?, 'cloned', ?)",
        (user_id, name, str(wav_path)),
    )
    await db.commit()
    row = await db.execute_fetchall("SELECT * FROM voices WHERE id = ?", (cursor.lastrowid,))
    return VoiceResponse(**dict(row[0]))


@router.delete("/{voice_id}", status_code=204)
async def delete_voice(voice_id: int, user_id: int = Depends(get_current_user_id), db: aiosqlite.Connection = Depends(get_db)):
    rows = await db.execute_fetchall(
        "SELECT * FROM voices WHERE id = ? AND user_id = ? AND type = 'cloned'",
        (voice_id, user_id),
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Voice not found or not deletable")

    voice = dict(rows[0])
    await db.execute("DELETE FROM voices WHERE id = ?", (voice_id,))
    await db.commit()

    if voice.get("wav_path"):
        wav = Path(voice["wav_path"])
        wav.unlink(missing_ok=True)
