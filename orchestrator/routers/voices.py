from fastapi import APIRouter, Depends, HTTPException
import aiosqlite

from orchestrator.db import get_db
from orchestrator.auth import get_current_user_id
from orchestrator.models import VoiceResponse

router = APIRouter(prefix="/voices", tags=["voices"])


@router.get("", response_model=list[VoiceResponse])
async def list_voices(user_id: int = Depends(get_current_user_id), db: aiosqlite.Connection = Depends(get_db)):
    rows = await db.execute_fetchall(
        "SELECT * FROM voices WHERE user_id IS NULL OR user_id = ? ORDER BY type, name",
        (user_id,),
    )
    return [VoiceResponse(**dict(r)) for r in rows]


@router.delete("/{voice_id}", status_code=204)
async def delete_voice(voice_id: int, user_id: int = Depends(get_current_user_id), db: aiosqlite.Connection = Depends(get_db)):
    rows = await db.execute_fetchall(
        "SELECT * FROM voices WHERE id = ? AND user_id = ? AND type = 'cloned'",
        (voice_id, user_id),
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Voice not found or not deletable")
    await db.execute("DELETE FROM voices WHERE id = ?", (voice_id,))
    await db.commit()
