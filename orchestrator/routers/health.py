from fastapi import APIRouter
from orchestrator.models import HealthResponse
import orchestrator.config as config
from orchestrator.engine_manager import engine_manager

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse)
async def health():
    db_status = "ok" if config.DB_PATH.exists() else "unavailable"
    active = engine_manager.active_engine
    return HealthResponse(
        status="ok",
        db=db_status,
        active_engine=active,
        alignment=None,
    )
