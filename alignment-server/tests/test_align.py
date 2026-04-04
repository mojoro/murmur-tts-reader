import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport

from main import app


@pytest_asyncio.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest.mark.asyncio
async def test_health(client):
    resp = await client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"


@pytest.mark.asyncio
async def test_align_returns_words(client, monkeypatch):
    """POST /align with audio + text returns word timings."""
    fake_words = [
        {"word": "hello", "start": 0.0, "end": 0.4},
        {"word": "world", "start": 0.5, "end": 0.9},
    ]

    def mock_align(audio_path, text, device, model, metadata):
        return fake_words

    monkeypatch.setattr("main.run_alignment", mock_align)

    # Minimal valid WAV: 44-byte header + 0 data frames
    wav_header = (
        b"RIFF" + (36).to_bytes(4, "little") + b"WAVE"
        b"fmt " + (16).to_bytes(4, "little")
        + (1).to_bytes(2, "little")   # PCM
        + (1).to_bytes(2, "little")   # mono
        + (24000).to_bytes(4, "little")  # sample rate
        + (48000).to_bytes(4, "little")  # byte rate
        + (2).to_bytes(2, "little")   # block align
        + (16).to_bytes(2, "little")  # bits per sample
        + b"data" + (0).to_bytes(4, "little")
    )

    resp = await client.post(
        "/align",
        files={"audio": ("segment.wav", wav_header, "audio/wav")},
        data={"text": "hello world"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["words"] == fake_words


@pytest.mark.asyncio
async def test_align_missing_audio(client):
    resp = await client.post("/align", data={"text": "hello"})
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_align_missing_text(client):
    wav_header = (
        b"RIFF" + (36).to_bytes(4, "little") + b"WAVE"
        b"fmt " + (16).to_bytes(4, "little")
        + (1).to_bytes(2, "little") + (1).to_bytes(2, "little")
        + (24000).to_bytes(4, "little") + (48000).to_bytes(4, "little")
        + (2).to_bytes(2, "little") + (16).to_bytes(2, "little")
        + b"data" + (0).to_bytes(4, "little")
    )
    resp = await client.post(
        "/align",
        files={"audio": ("segment.wav", wav_header, "audio/wav")},
    )
    assert resp.status_code == 422
