import logging

from fastapi import APIRouter, Depends, HTTPException
import aiosqlite

from orchestrator.db import get_db
from orchestrator.auth import get_current_user_id
from orchestrator.models import CreateBookmarkRequest, UpdateBookmarkRequest, BookmarkResponse

logger = logging.getLogger(__name__)
router = APIRouter(tags=["bookmarks"])


@router.get("/reads/{read_id}/bookmarks", response_model=list[BookmarkResponse])
async def list_bookmarks(read_id: int, user_id: int = Depends(get_current_user_id), db: aiosqlite.Connection = Depends(get_db)):
    rows = await db.execute_fetchall(
        """SELECT b.* FROM bookmarks b
           JOIN reads r ON b.read_id = r.id
           WHERE b.read_id = ? AND r.user_id = ?
           ORDER BY b.segment_index, b.word_offset""",
        (read_id, user_id),
    )
    return [BookmarkResponse(**dict(r)) for r in rows]


@router.post("/reads/{read_id}/bookmarks", response_model=BookmarkResponse, status_code=201)
async def add_bookmark(read_id: int, req: CreateBookmarkRequest, user_id: int = Depends(get_current_user_id), db: aiosqlite.Connection = Depends(get_db)):
    rows = await db.execute_fetchall("SELECT id FROM reads WHERE id = ? AND user_id = ?", (read_id, user_id))
    if not rows:
        raise HTTPException(status_code=404, detail="Read not found")
    cursor = await db.execute(
        "INSERT INTO bookmarks (read_id, segment_index, word_offset, note) VALUES (?, ?, ?, ?)",
        (read_id, req.segment_index, req.word_offset, req.note),
    )
    await db.commit()
    bm_rows = await db.execute_fetchall("SELECT * FROM bookmarks WHERE id = ?", (cursor.lastrowid,))
    return BookmarkResponse(**dict(bm_rows[0]))


@router.patch("/bookmarks/{bookmark_id}", response_model=BookmarkResponse)
async def update_bookmark(bookmark_id: int, req: UpdateBookmarkRequest, user_id: int = Depends(get_current_user_id), db: aiosqlite.Connection = Depends(get_db)):
    rows = await db.execute_fetchall(
        """SELECT b.* FROM bookmarks b
           JOIN reads r ON b.read_id = r.id
           WHERE b.id = ? AND r.user_id = ?""",
        (bookmark_id, user_id),
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Bookmark not found")
    await db.execute("UPDATE bookmarks SET note = ? WHERE id = ?", (req.note, bookmark_id))
    await db.commit()
    updated = await db.execute_fetchall("SELECT * FROM bookmarks WHERE id = ?", (bookmark_id,))
    return BookmarkResponse(**dict(updated[0]))


@router.delete("/bookmarks/{bookmark_id}", status_code=204)
async def delete_bookmark(bookmark_id: int, user_id: int = Depends(get_current_user_id), db: aiosqlite.Connection = Depends(get_db)):
    rows = await db.execute_fetchall(
        """SELECT b.id FROM bookmarks b
           JOIN reads r ON b.read_id = r.id
           WHERE b.id = ? AND r.user_id = ?""",
        (bookmark_id, user_id),
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Bookmark not found")
    await db.execute("DELETE FROM bookmarks WHERE id = ?", (bookmark_id,))
    await db.commit()
