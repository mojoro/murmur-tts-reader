import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException
from sse_starlette.sse import EventSourceResponse

from orchestrator.auth import get_current_user_id
from orchestrator.db import open_db
from orchestrator.engine_manager import engine_manager
from orchestrator.engine_registry import ENGINES
from orchestrator.models import BackendResponse, SelectBackendRequest
from orchestrator.routers.voices import sync_builtin_voices

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
async def select_backend(
    req: SelectBackendRequest,
    user_id: int = Depends(get_current_user_id),
):
    logger.info("Selecting engine: %s", req.name)
    if req.name not in ENGINES:
        logger.error("Unknown engine requested: %s", req.name)
        raise HTTPException(status_code=404, detail=f"Unknown engine: {req.name}")

    success = await engine_manager.select_engine(req.name)
    if not success:
        logger.error("Engine %s failed to start", req.name)
        raise HTTPException(status_code=503, detail=f"Failed to start engine: {req.name}")
    logger.info("Engine %s is now active", req.name)

    async with open_db() as db:
        await sync_builtin_voices(db)

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
async def install_backend(
    req: SelectBackendRequest,
    user_id: int = Depends(get_current_user_id),
):
    logger.info("Install requested for engine: %s", req.name)
    if req.name not in ENGINES:
        logger.error("Unknown engine requested for install: %s", req.name)
        raise HTTPException(status_code=404, detail=f"Unknown engine: {req.name}")

    status = engine_manager.get_status(req.name)
    if status.value in ("installed", "running", "stopped"):
        logger.info("Engine %s already installed (status=%s)", req.name, status.value)
        return {"message": f"Engine {req.name} is already installed"}

    if status.value == "installing":
        logger.info("Engine %s is already being installed", req.name)
        return {"message": f"Engine {req.name} is already installing"}

    # Run installation in background so we don't block the request
    asyncio.create_task(_install_engine_task(req.name))
    return {"message": f"Installing {req.name}..."}


async def _install_engine_task(name: str):
    success = await engine_manager.install_engine(name)
    if success:
        logger.info("Background install of %s completed", name)
    else:
        logger.error("Background install of %s failed", name)


@router.delete("/{name}")
async def uninstall_backend(
    name: str,
    user_id: int = Depends(get_current_user_id),
):
    logger.info("Uninstall requested for engine: %s", name)
    if name not in ENGINES:
        raise HTTPException(status_code=404, detail=f"Unknown engine: {name}")

    status = engine_manager.get_status(name)
    if status.value == "installing":
        raise HTTPException(status_code=409, detail=f"Engine {name} is currently installing")

    success = await engine_manager.uninstall_engine(name)
    if not success:
        raise HTTPException(status_code=500, detail=f"Failed to uninstall {name}")

    return {"message": f"Engine {name} uninstalled"}


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
