import asyncio

from fastapi import APIRouter, HTTPException
from sse_starlette.sse import EventSourceResponse

from orchestrator.engine_manager import engine_manager
from orchestrator.engine_registry import ENGINES
from orchestrator.models import BackendResponse, SelectBackendRequest

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
    if req.name not in ENGINES:
        raise HTTPException(status_code=404, detail=f"Unknown engine: {req.name}")

    success = await engine_manager.select_engine(req.name)
    if not success:
        raise HTTPException(status_code=503, detail=f"Failed to start engine: {req.name}")

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
