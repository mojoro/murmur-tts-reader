import pytest

pytestmark = pytest.mark.anyio


async def test_health(client):
    res = await client.get("/health")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "ok"
    assert data["db"] == "ok"
