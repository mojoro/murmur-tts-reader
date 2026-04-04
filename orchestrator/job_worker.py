import asyncio
import json
import logging

import httpx

import orchestrator.config as config
from orchestrator.db import open_db
from orchestrator.engine_manager import engine_manager
from orchestrator.job_events import job_event_bus

logger = logging.getLogger(__name__)


class JobWorker:
    """Background worker that processes TTS generation jobs FIFO."""

    def __init__(self):
        self._task: asyncio.Task | None = None

    async def start(self):
        self._task = asyncio.create_task(self._loop())

    async def stop(self):
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None

    async def _loop(self):
        while True:
            try:
                await self._resume_waiting_jobs()
                job = await self._pick_next_job()
                if job:
                    await self._process_job(job)
                else:
                    await asyncio.sleep(2)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Job worker loop error")
                await asyncio.sleep(5)

    async def _resume_waiting_jobs(self):
        """Reset waiting_for_backend jobs to pending when engine is available."""
        if engine_manager.get_engine_url():
            async with open_db() as db:
                await db.execute(
                    "UPDATE jobs SET status = 'pending' WHERE status = 'waiting_for_backend'"
                )
                await db.commit()

    async def _pick_next_job(self) -> dict | None:
        async with open_db() as db:
            rows = await db.execute_fetchall(
                "SELECT * FROM jobs WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1"
            )
            if not rows:
                return None
            job = dict(rows[0])
            await db.execute(
                "UPDATE jobs SET status = 'running', started_at = datetime('now') WHERE id = ?",
                (job["id"],),
            )
            await db.commit()
            job["status"] = "running"
            logger.info("Picked job id=%d read=%d voice=%s engine=%s total=%d", job["id"], job["read_id"], job["voice"], job["engine"], job["total"])
            return job

    async def _process_job(self, job: dict):
        job_id = job["id"]
        user_id = job["user_id"]
        read_id = job["read_id"]

        await job_event_bus.emit(user_id, "job:started", {
            "jobId": job_id, "readId": read_id,
        })

        # Check engine availability
        if not engine_manager.get_engine_url():
            logger.warning("Job %d: no engine available, setting waiting_for_backend", job_id)
            async with open_db() as db:
                await db.execute(
                    "UPDATE jobs SET status = 'waiting_for_backend' WHERE id = ?",
                    (job_id,),
                )
                await db.commit()
            return

        # Get ungenerated segments
        async with open_db() as db:
            segments = await db.execute_fetchall(
                """SELECT * FROM audio_segments
                   WHERE read_id = ? AND audio_generated = 0
                   ORDER BY segment_index""",
                (read_id,),
            )
            segments = [dict(s) for s in segments]

        for segment in segments:
            # Check for cancellation
            async with open_db() as db:
                rows = await db.execute_fetchall(
                    "SELECT status FROM jobs WHERE id = ?", (job_id,)
                )
                if not rows or dict(rows[0])["status"] == "cancelled":
                    await job_event_bus.emit(user_id, "job:cancelled", {
                        "jobId": job_id, "readId": read_id,
                    })
                    return

            # Check engine
            if not engine_manager.get_engine_url():
                async with open_db() as db:
                    await db.execute(
                        "UPDATE jobs SET status = 'waiting_for_backend' WHERE id = ?",
                        (job_id,),
                    )
                    await db.commit()
                return

            success = await self._process_segment(job, segment)
            if not success:
                logger.error("Job %d: segment %d failed, marking job as failed", job_id, segment["segment_index"])
                async with open_db() as db:
                    await db.execute(
                        "UPDATE jobs SET status = 'failed', error = ?, completed_at = datetime('now') WHERE id = ?",
                        ("TTS generation failed", job_id),
                    )
                    await db.commit()
                await job_event_bus.emit(user_id, "job:failed", {
                    "jobId": job_id, "readId": read_id, "error": "TTS generation failed",
                })
                return

            # Read updated progress
            async with open_db() as db:
                rows = await db.execute_fetchall(
                    "SELECT progress FROM jobs WHERE id = ?", (job_id,)
                )
                progress = dict(rows[0])["progress"]

            await job_event_bus.emit(user_id, "job:progress", {
                "jobId": job_id, "readId": read_id,
                "segment": progress, "total": job["total"],
            })

        # Mark done
        async with open_db() as db:
            await db.execute(
                "UPDATE jobs SET status = 'done', completed_at = datetime('now') WHERE id = ?",
                (job_id,),
            )
            await db.commit()
        logger.info("Job %d completed: all %d segments generated for read=%d", job_id, job["total"], read_id)

        await job_event_bus.emit(user_id, "job:completed", {
            "jobId": job_id, "readId": read_id,
        })

    async def _process_segment(self, job: dict, segment: dict) -> bool:
        read_id = job["read_id"]
        seg_index = segment["segment_index"]
        text = segment["text"]
        voice = job["voice"]
        language = job.get("language")

        engine_url = engine_manager.get_engine_url()
        if not engine_url:
            logger.error("Segment %d/%d: no engine URL available", seg_index, read_id)
            return False

        payload = {"text": text, "voice": voice}
        if language:
            payload["language"] = language

        # 1. Generate audio via TTS engine
        logger.info("Segment %d/%d: generating audio (voice=%s, %d chars)", seg_index, read_id, voice, len(text))
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.post(
                    f"{engine_url}/tts/generate",
                    json=payload,
                    timeout=120,
                )
                resp.raise_for_status()
                audio_data = resp.content
        except Exception:
            logger.exception("Segment %d/%d: TTS generation failed (engine=%s)", seg_index, read_id, engine_url)
            return False
        logger.info("Segment %d/%d: got %d bytes of audio", seg_index, read_id, len(audio_data))

        # 2. Save WAV to disk
        audio_dir = config.AUDIO_DIR / str(read_id)
        audio_dir.mkdir(parents=True, exist_ok=True)
        wav_path = audio_dir / f"{seg_index}.wav"
        wav_path.write_bytes(audio_data)

        # 3. Align (best-effort)
        word_timings = None
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.post(
                    f"{config.ALIGN_SERVER_URL}/align",
                    files={"audio": ("segment.wav", audio_data, "audio/wav")},
                    data={"text": text},
                    timeout=60,
                )
                resp.raise_for_status()
                word_timings = json.dumps(resp.json().get("words", []))
                logger.debug("Segment %d/%d: alignment returned %d words", seg_index, read_id, len(resp.json().get("words", [])))
        except Exception:
            logger.debug("Segment %d/%d: alignment unavailable (this is ok)", seg_index, read_id)

        # 4. Update DB
        async with open_db() as db:
            await db.execute(
                """UPDATE audio_segments
                   SET audio_generated = 1, word_timings_json = ?, generated_at = datetime('now')
                   WHERE read_id = ? AND segment_index = ?""",
                (word_timings, read_id, seg_index),
            )
            await db.execute(
                "UPDATE jobs SET progress = progress + 1 WHERE id = ?",
                (job["id"],),
            )
            await db.commit()

        return True


job_worker = JobWorker()
