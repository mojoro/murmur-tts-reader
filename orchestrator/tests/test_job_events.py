import asyncio
import json
import pytest
from orchestrator.job_events import JobEventBus

pytestmark = pytest.mark.anyio


async def test_subscribe_and_emit():
    bus = JobEventBus()
    q = bus.subscribe(user_id=1)
    await bus.emit(user_id=1, event="job:queued", data={"jobId": 10})
    msg = await asyncio.wait_for(q.get(), timeout=1)
    assert msg["event"] == "job:queued"
    assert json.loads(msg["data"])["jobId"] == 10


async def test_emit_only_reaches_target_user():
    bus = JobEventBus()
    q1 = bus.subscribe(user_id=1)
    q2 = bus.subscribe(user_id=2)
    await bus.emit(user_id=1, event="job:started", data={"jobId": 5})
    msg = await asyncio.wait_for(q1.get(), timeout=1)
    assert msg["event"] == "job:started"
    assert q2.empty()


async def test_unsubscribe():
    bus = JobEventBus()
    q = bus.subscribe(user_id=1)
    bus.unsubscribe(user_id=1, queue=q)
    await bus.emit(user_id=1, event="job:progress", data={"jobId": 1})
    assert q.empty()


async def test_multiple_subscribers_same_user():
    bus = JobEventBus()
    q1 = bus.subscribe(user_id=1)
    q2 = bus.subscribe(user_id=1)
    await bus.emit(user_id=1, event="job:completed", data={"jobId": 1})
    msg1 = await asyncio.wait_for(q1.get(), timeout=1)
    msg2 = await asyncio.wait_for(q2.get(), timeout=1)
    assert msg1["event"] == "job:completed"
    assert msg2["event"] == "job:completed"
