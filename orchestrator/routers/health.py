from fastapi import APIRouter
from orchestrator.models import HealthResponse
import orchestrator.config as config

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse)
async def health():
    db_status = "ok" if config.DB_PATH.exists() else "unavailable"
    return HealthResponse(
        status="ok",
        db=db_status,
        active_engine=None,  # Set by engine manager in Plan 2
        alignment=None,       # Set by engine manager in Plan 2
    )
