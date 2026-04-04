import logging

from fastapi import APIRouter, Depends
import aiosqlite

from orchestrator.db import get_db
from orchestrator.auth import get_current_user_id
from orchestrator.models import SettingsResponse, UpdateSettingsRequest

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("", response_model=SettingsResponse)
async def get_settings(user_id: int = Depends(get_current_user_id), db: aiosqlite.Connection = Depends(get_db)):
    rows = await db.execute_fetchall("SELECT key, value FROM settings WHERE user_id = ?", (user_id,))
    return SettingsResponse(settings={r["key"]: r["value"] for r in rows})


@router.patch("", response_model=SettingsResponse)
async def update_settings(req: UpdateSettingsRequest, user_id: int = Depends(get_current_user_id), db: aiosqlite.Connection = Depends(get_db)):
    for key, value in req.settings.items():
        await db.execute(
            "INSERT INTO settings (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value = ?",
            (user_id, key, value, value),
        )
    await db.commit()
    rows = await db.execute_fetchall("SELECT key, value FROM settings WHERE user_id = ?", (user_id,))
    return SettingsResponse(settings={r["key"]: r["value"] for r in rows})
