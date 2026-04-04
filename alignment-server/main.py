import logging
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, Form, UploadFile

logger = logging.getLogger(__name__)

device = "cpu"
align_model = None
align_metadata = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global align_model, align_metadata, device
    import torch
    import whisperx

    device = "cuda" if torch.cuda.is_available() else "cpu"
    logger.info(f"Loading alignment model on {device}...")
    align_model, align_metadata = whisperx.load_align_model(
        language_code="en", device=device
    )
    logger.info("Alignment model ready.")
    yield


app = FastAPI(title="Murmur Alignment Server", lifespan=lifespan)


def run_alignment(
    audio_path: str,
    text: str,
    device: str,
    model,
    metadata,
) -> list[dict]:
    """Run WhisperX forced alignment and return word timings."""
    import whisperx

    audio = whisperx.load_audio(audio_path)
    duration = len(audio) / 16000  # whisperx loads at 16kHz
    segments = [{"text": text, "start": 0.0, "end": duration}]
    result = whisperx.align(
        segments,
        model,
        metadata,
        audio,
        device,
        return_char_alignments=False,
    )
    words = []
    for seg in result.get("segments", []):
        for w in seg.get("words", []):
            if "start" in w and "end" in w:
                words.append({
                    "word": w["word"],
                    "start": round(w["start"], 3),
                    "end": round(w["end"], 3),
                })
    return words


@app.post("/align")
async def align(audio: UploadFile = File(...), text: str = Form(...)):
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tmp.write(await audio.read())
        tmp_path = tmp.name

    try:
        words = run_alignment(tmp_path, text, device, align_model, align_metadata)
    finally:
        Path(tmp_path).unlink(missing_ok=True)

    return {"words": words}


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "model_loaded": align_model is not None,
        "device": device,
    }
