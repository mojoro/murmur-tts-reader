import asyncio
import json
import logging
from enum import Enum
from pathlib import Path

import httpx

import orchestrator.config as config
from orchestrator.engine_registry import ENGINES, get_engine

logger = logging.getLogger(__name__)


class EngineStatus(str, Enum):
    AVAILABLE = "available"
    INSTALLED = "installed"
    RUNNING = "running"
    STOPPED = "stopped"
    UNAVAILABLE = "unavailable"


class EngineManager:
    """Manages one TTS engine subprocess at a time."""

    def __init__(self):
        self._process: asyncio.subprocess.Process | None = None
        self._active_engine: str | None = None
        self._health_task: asyncio.Task | None = None
        self._statuses: dict[str, EngineStatus] = {}
        self._listeners: list[asyncio.Queue] = []

        for name in ENGINES:
            self._statuses[name] = EngineStatus.AVAILABLE

    def _engine_dir(self, name: str) -> Path:
        engine = get_engine(name)
        repo_root = Path(__file__).parent.parent
        dev_path = repo_root / engine.repo_dir
        docker_path = config.ENGINES_DIR / engine.repo_dir
        if dev_path.exists():
            return dev_path
        if docker_path.exists():
            return docker_path
        return dev_path

    def check_installed(self):
        for name in ENGINES:
            engine_dir = self._engine_dir(name)
            if engine_dir.exists() and (engine_dir / "main.py").exists():
                if self._statuses[name] == EngineStatus.AVAILABLE:
                    self._statuses[name] = EngineStatus.INSTALLED

    @property
    def active_engine(self) -> str | None:
        return self._active_engine

    def get_status(self, name: str) -> EngineStatus:
        return self._statuses.get(name, EngineStatus.AVAILABLE)

    def get_all_statuses(self) -> dict[str, EngineStatus]:
        return dict(self._statuses)

    def get_engine_url(self) -> str | None:
        if not self._active_engine:
            return None
        return f"http://localhost:{config.ENGINE_PORT}"

    async def start_engine(self, name: str) -> bool:
        get_engine(name)
        engine_dir = self._engine_dir(name)

        if not engine_dir.exists() or not (engine_dir / "main.py").exists():
            logger.error(f"Engine {name} not installed at {engine_dir}")
            return False

        if self._active_engine and self._active_engine != name:
            await self.stop_engine()
        elif self._active_engine == name and self._process and self._process.returncode is None:
            return True

        logger.info(f"Starting engine: {name} from {engine_dir}")

        # Use venv uvicorn directly if available (works in Docker where
        # uv pip install was used), fall back to uv run for dev
        venv_uvicorn = engine_dir / ".venv" / "bin" / "uvicorn"
        if venv_uvicorn.exists():
            cmd = [str(venv_uvicorn), "main:app"]
        else:
            cmd = ["uv", "run", "uvicorn", "main:app"]

        self._process = await asyncio.create_subprocess_exec(
            *cmd,
            "--host", "0.0.0.0",
            "--port", str(config.ENGINE_PORT),
            cwd=str(engine_dir),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        self._active_engine = name
        self._statuses[name] = EngineStatus.RUNNING

        healthy = await self._wait_for_healthy(timeout=120)
        if not healthy:
            # Log subprocess output for debugging
            if self._process:
                stdout = await self._process.stdout.read() if self._process.stdout else b""
                stderr = await self._process.stderr.read() if self._process.stderr else b""
                if stdout:
                    logger.error(f"Engine {name} stdout: {stdout.decode(errors='replace')[-2000:]}")
                if stderr:
                    logger.error(f"Engine {name} stderr: {stderr.decode(errors='replace')[-2000:]}")
            logger.error(f"Engine {name} failed to become healthy")
            await self.stop_engine()
            self._statuses[name] = EngineStatus.UNAVAILABLE
            await self._emit_event("backend:status", {"name": name, "status": "unavailable"})
            return False

        self._start_health_loop()
        await self._emit_event("backend:status", {"name": name, "status": "running"})
        return True

    async def stop_engine(self):
        if self._health_task:
            self._health_task.cancel()
            self._health_task = None

        if self._process and self._process.returncode is None:
            self._process.terminate()
            try:
                await asyncio.wait_for(self._process.wait(), timeout=10)
            except asyncio.TimeoutError:
                self._process.kill()
                await self._process.wait()

        if self._active_engine:
            old = self._active_engine
            self._statuses[old] = EngineStatus.INSTALLED
            await self._emit_event("backend:status", {"name": old, "status": "stopped"})
            self._active_engine = None
            self._process = None

    async def select_engine(self, name: str) -> bool:
        return await self.start_engine(name)

    async def _wait_for_healthy(self, timeout: int = 120) -> bool:
        url = f"http://localhost:{config.ENGINE_PORT}/health"
        deadline = asyncio.get_event_loop().time() + timeout
        async with httpx.AsyncClient() as client:
            while asyncio.get_event_loop().time() < deadline:
                try:
                    resp = await client.get(url, timeout=2)
                    if resp.status_code == 200:
                        return True
                except (httpx.ConnectError, httpx.ReadTimeout):
                    pass
                await asyncio.sleep(1)
        return False

    def _start_health_loop(self):
        if self._health_task:
            self._health_task.cancel()
        self._health_task = asyncio.create_task(self._health_loop())

    async def _health_loop(self):
        url = f"http://localhost:{config.ENGINE_PORT}/health"
        fail_count = 0
        async with httpx.AsyncClient() as client:
            while True:
                await asyncio.sleep(10)
                if not self._active_engine:
                    break
                try:
                    resp = await client.get(url, timeout=5)
                    if resp.status_code == 200:
                        fail_count = 0
                        if self._statuses.get(self._active_engine) == EngineStatus.UNAVAILABLE:
                            self._statuses[self._active_engine] = EngineStatus.RUNNING
                            await self._emit_event("backend:status", {
                                "name": self._active_engine, "status": "running"
                            })
                        continue
                except (httpx.ConnectError, httpx.ReadTimeout):
                    pass
                fail_count += 1
                if fail_count >= 3 and self._active_engine:
                    self._statuses[self._active_engine] = EngineStatus.UNAVAILABLE
                    await self._emit_event("backend:status", {
                        "name": self._active_engine, "status": "unavailable"
                    })

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue()
        self._listeners.append(q)
        return q

    def unsubscribe(self, q: asyncio.Queue):
        if q in self._listeners:
            self._listeners.remove(q)

    async def _emit_event(self, event: str, data: dict):
        msg = {"event": event, "data": json.dumps(data)}
        for q in self._listeners:
            await q.put(msg)

    async def shutdown(self):
        await self.stop_engine()


# Singleton
engine_manager = EngineManager()
