import logging
import re
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

_VOICE_NAME_RE = re.compile(r"^[A-Za-z0-9 _-]{1,64}$")


@router.get("", response_model=list[VoiceResponse])
async def list_voices(user_id: int = Depends(get_current_user_id), db: aiosqlite.Connection = Depends(get_db)):
    rows = await db.execute_fetchall(
        "SELECT * FROM voices WHERE user_id IS NULL OR user_id = ? ORDER BY type, name",
        (user_id,),
    )
    return [VoiceResponse(**dict(r)) for r in rows]


async def sync_builtin_voices(db: aiosqlite.Connection) -> None:
    """Fetch builtin voices from the active engine and replace stale ones in DB."""
    engine_url = engine_manager.get_engine_url()
    if not engine_url:
        return

    logger.info("Syncing builtin voices from engine at %s", engine_url)
    async with httpx.AsyncClient() as client:
        try:
            resp = await client.get(f"{engine_url}/tts/voices", timeout=10)
            resp.raise_for_status()
        except (httpx.HTTPStatusError, httpx.ConnectError) as e:
            logger.error("Voice sync failed: %s", e)
            return

    data = resp.json()
    builtin = data.get("builtin", [])
    logger.info("Engine returned %d builtin voices", len(builtin))

    if builtin:
        placeholders = ",".join("?" for _ in builtin)
        await db.execute(
            f"DELETE FROM voices WHERE user_id IS NULL AND type = 'builtin' AND name NOT IN ({placeholders})",
            builtin,
        )
    else:
        await db.execute("DELETE FROM voices WHERE user_id IS NULL AND type = 'builtin'")

    for voice_name in builtin:
        existing = await db.execute_fetchall(
            "SELECT id FROM voices WHERE user_id IS NULL AND name = ?", (voice_name,)
        )
        if not existing:
            await db.execute(
                "INSERT INTO voices (user_id, name, type) VALUES (NULL, ?, 'builtin')", (voice_name,)
            )
    await db.commit()


@router.post("/sync", response_model=list[VoiceResponse])
async def sync_voices(user_id: int = Depends(get_current_user_id), db: aiosqlite.Connection = Depends(get_db)):
    """Fetch voices from the active TTS engine and upsert into DB."""
    engine_url = engine_manager.get_engine_url()
    if not engine_url:
        logger.warning("Voice sync failed: no engine running (user=%d)", user_id)
        raise HTTPException(status_code=503, detail="No TTS engine running")

    await sync_builtin_voices(db)

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
    if not _VOICE_NAME_RE.fullmatch(name):
        raise HTTPException(
            status_code=400,
            detail="Voice name must be 1-64 chars, letters/digits/space/dash/underscore only",
        )

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
        except httpx.HTTPStatusError as e:
            body = e.response.text[:500] if e.response else ""
            logger.error("Voice clone failed: engine returned %d for name=%s: %s", e.response.status_code, name, body)
            wav_path.unlink(missing_ok=True)
            raise HTTPException(status_code=503, detail=f"TTS engine error: {body or e}")
        except httpx.ConnectError as e:
            logger.error("Voice clone failed: cannot connect to engine for name=%s: %s", name, e)
            wav_path.unlink(missing_ok=True)
            raise HTTPException(status_code=503, detail=f"Cannot reach TTS engine: {e}")

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
