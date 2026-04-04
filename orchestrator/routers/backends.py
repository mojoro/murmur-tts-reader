import asyncio
import logging

from fastapi import APIRouter, HTTPException
from sse_starlette.sse import EventSourceResponse

from orchestrator.engine_manager import engine_manager
from orchestrator.engine_registry import ENGINES
from orchestrator.models import BackendResponse, SelectBackendRequest

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/backends", tags=["backends"])


@router.get("", response_model=list[BackendResponse])
async def list_backends():
    statuses = engine_manager.get_all_statuses()
    return [
        BackendResponse(
            name=info.name,
            display_name=info.display_name,
            description=info.description,
            size=info.size,
            status=statuses.get(info.name, "available"),
            gpu=info.gpu,
            builtin_voices=info.builtin_voices,
        )
        for info in ENGINES.values()
    ]


@router.post("/select", response_model=BackendResponse)
async def select_backend(req: SelectBackendRequest):
    logger.info("Selecting engine: %s", req.name)
    if req.name not in ENGINES:
        logger.error("Unknown engine requested: %s", req.name)
        raise HTTPException(status_code=404, detail=f"Unknown engine: {req.name}")

    success = await engine_manager.select_engine(req.name)
    if not success:
        logger.error("Engine %s failed to start", req.name)
        raise HTTPException(status_code=503, detail=f"Failed to start engine: {req.name}")
    logger.info("Engine %s is now active", req.name)

    info = ENGINES[req.name]
    return BackendResponse(
        name=info.name,
        display_name=info.display_name,
        description=info.description,
        size=info.size,
        status=engine_manager.get_status(req.name),
        gpu=info.gpu,
        builtin_voices=info.builtin_voices,
    )


@router.post("/install")
async def install_backend(req: SelectBackendRequest):
    logger.info("Install requested for engine: %s", req.name)
    if req.name not in ENGINES:
        logger.error("Unknown engine requested for install: %s", req.name)
        raise HTTPException(status_code=404, detail=f"Unknown engine: {req.name}")

    status = engine_manager.get_status(req.name)
    if status.value in ("installed", "running", "stopped"):
        logger.info("Engine %s already installed (status=%s)", req.name, status.value)
        return {"message": f"Engine {req.name} is already installed"}

    logger.warning("Install not supported for engine %s (status=%s)", req.name, status.value)
    raise HTTPException(
        status_code=501,
        detail=f"Remote engine installation not yet supported. Mount the engine directory into the container.",
    )


@router.get("/events")
async def backend_events():
    q = engine_manager.subscribe()

    async def event_generator():
        try:
            while True:
                msg = await q.get()
                yield {"event": msg["event"], "data": msg["data"]}
        except asyncio.CancelledError:
            engine_manager.unsubscribe(q)

    return EventSourceResponse(event_generator())
