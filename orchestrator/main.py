from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from orchestrator.config import AUDIO_DIR, DATA_DIR
from orchestrator.db import init_db
from orchestrator.routers.auth_router import router as auth_router
from orchestrator.routers.voices import router as voices_router
from orchestrator.routers.settings import router as settings_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    await init_db()
    yield


app = FastAPI(title="Murmur Orchestrator", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(voices_router)
app.include_router(settings_router)
