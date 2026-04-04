import asyncio

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException
from sse_starlette.sse import EventSourceResponse

from orchestrator.auth import get_current_user_id
from orchestrator.db import get_db
from orchestrator.job_events import job_event_bus
from orchestrator.models import JobResponse

router = APIRouter(prefix="/queue", tags=["queue"])


@router.get("", response_model=list[JobResponse])
async def list_queue(
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db),
):
    rows = await db.execute_fetchall(
        "SELECT * FROM jobs WHERE user_id = ? ORDER BY created_at DESC",
        (user_id,),
    )
    return [JobResponse(**dict(r)) for r in rows]


@router.delete("/{job_id}", status_code=204)
async def cancel_job(
    job_id: int,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db),
):
    rows = await db.execute_fetchall(
        "SELECT * FROM jobs WHERE id = ? AND user_id = ?", (job_id, user_id)
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Job not found")

    job = dict(rows[0])
    if job["status"] in ("done", "failed", "cancelled"):
        raise HTTPException(status_code=409, detail=f"Cannot cancel job with status: {job['status']}")

    await db.execute(
        "UPDATE jobs SET status = 'cancelled', completed_at = datetime('now') WHERE id = ?",
        (job_id,),
    )
    await db.commit()

    await job_event_bus.emit(user_id, "job:cancelled", {
        "jobId": job_id, "readId": job["read_id"],
    })


@router.get("/events")
async def queue_events(user_id: int = Depends(get_current_user_id)):
    q = job_event_bus.subscribe(user_id)

    async def event_generator():
        try:
            while True:
                msg = await q.get()
                yield {"event": msg["event"], "data": msg["data"]}
        except asyncio.CancelledError:
            job_event_bus.unsubscribe(user_id, q)

    return EventSourceResponse(event_generator())
