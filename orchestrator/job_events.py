import asyncio
import json


class JobEventBus:
    """User-scoped pub/sub for job progress SSE events."""

    def __init__(self):
        self._listeners: dict[int, list[asyncio.Queue]] = {}

    def subscribe(self, user_id: int) -> asyncio.Queue:
        if user_id not in self._listeners:
            self._listeners[user_id] = []
        q: asyncio.Queue = asyncio.Queue()
        self._listeners[user_id].append(q)
        return q

    def unsubscribe(self, user_id: int, queue: asyncio.Queue):
        if user_id in self._listeners:
            self._listeners[user_id] = [
                q for q in self._listeners[user_id] if q is not queue
            ]

    async def emit(self, user_id: int, event: str, data: dict):
        msg = {"event": event, "data": json.dumps(data)}
        for q in self._listeners.get(user_id, []):
            await q.put(msg)


job_event_bus = JobEventBus()
