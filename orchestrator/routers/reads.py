import shutil

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException

import orchestrator.config as config
from orchestrator.auth import get_current_user_id
from orchestrator.db import get_db
from orchestrator.models import (
    CreateReadRequest,
    ReadDetail,
    ReadSummary,
    SegmentResponse,
    UpdateReadRequest,
)
from orchestrator.sentence_splitter import split_sentences

router = APIRouter(prefix="/reads", tags=["reads"])


@router.get("", response_model=list[ReadSummary])
async def list_reads(
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db),
):
    rows = await db.execute_fetchall(
        """SELECT r.*, (SELECT COUNT(*) FROM audio_segments WHERE read_id = r.id) as segment_count
           FROM reads r WHERE r.user_id = ? ORDER BY r.created_at DESC""",
        (user_id,),
    )
    return [ReadSummary(**dict(r)) for r in rows]


@router.post("", response_model=ReadDetail, status_code=201)
async def create_read(
    req: CreateReadRequest,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db),
):
    cursor = await db.execute(
        "INSERT INTO reads (user_id, title, content, type, source_url, file_name) VALUES (?, ?, ?, ?, ?, ?)",
        (user_id, req.title, req.content, req.type, req.source_url, req.file_name),
    )
    read_id = cursor.lastrowid
    sentences = split_sentences(req.content)
    for i, text in enumerate(sentences):
        await db.execute(
            "INSERT INTO audio_segments (read_id, segment_index, text) VALUES (?, ?, ?)",
            (read_id, i, text),
        )
    await db.commit()
    return await _get_read_detail(db, read_id, user_id)


@router.get("/{read_id}", response_model=ReadDetail)
async def get_read(
    read_id: int,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db),
):
    detail = await _get_read_detail(db, read_id, user_id)
    if not detail:
        raise HTTPException(status_code=404, detail="Read not found")
    return detail


@router.patch("/{read_id}", response_model=ReadDetail)
async def update_read(
    read_id: int,
    req: UpdateReadRequest,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db),
):
    updates = {k: v for k, v in req.model_dump(exclude_unset=True).items()}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    set_clause = ", ".join(f"{k} = ?" for k in updates)
    set_clause += ", updated_at = datetime('now')"
    values = list(updates.values())
    await db.execute(
        f"UPDATE reads SET {set_clause} WHERE id = ? AND user_id = ?",
        (*values, read_id, user_id),
    )
    await db.commit()
    detail = await _get_read_detail(db, read_id, user_id)
    if not detail:
        raise HTTPException(status_code=404, detail="Read not found")
    return detail


@router.delete("/{read_id}", status_code=204)
async def delete_read(
    read_id: int,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db),
):
    rows = await db.execute_fetchall(
        "SELECT id FROM reads WHERE id = ? AND user_id = ?", (read_id, user_id)
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Read not found")
    await db.execute("DELETE FROM reads WHERE id = ?", (read_id,))
    await db.commit()
    audio_dir = config.AUDIO_DIR / str(read_id)
    if audio_dir.exists():
        shutil.rmtree(audio_dir)


async def _get_read_detail(
    db: aiosqlite.Connection, read_id: int, user_id: int
) -> ReadDetail | None:
    rows = await db.execute_fetchall(
        "SELECT * FROM reads WHERE id = ? AND user_id = ?", (read_id, user_id)
    )
    if not rows:
        return None
    read = dict(rows[0])
    seg_rows = await db.execute_fetchall(
        "SELECT * FROM audio_segments WHERE read_id = ? ORDER BY segment_index",
        (read_id,),
    )
    segments = [SegmentResponse(**dict(s)) for s in seg_rows]
    return ReadDetail(**read, segments=segments)
