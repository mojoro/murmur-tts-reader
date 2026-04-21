import io
import uuid
from pathlib import Path

import numpy as np
import scipy.io.wavfile as wav
import torch
# Patch torch.load for Coqui TTS compatibility with PyTorch 2.6+
_orig_load = torch.load
torch.load = lambda *a, **kw: _orig_load(*a, **{**kw, "weights_only": False})

from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from TTS.api import TTS

app = FastAPI(title="XTTS-v2 TTS Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Global state ---

VOICES_DIR = Path(__file__).parent / "voices"
VOICES_DIR.mkdir(exist_ok=True)

tts_model: TTS | None = None


def get_model() -> TTS:
    global tts_model
    if tts_model is None:
        device = "cuda" if torch.cuda.is_available() else "cpu"
        tts_model = TTS("tts_models/multilingual/multi-dataset/xtts_v2").to(device)
    return tts_model


# --- Routes ---


class GenerateRequest(BaseModel):
    text: str
    voice: str = "default"
    language: str | None = None


@app.get("/tts/voices")
def list_voices():
    custom = [p.stem for p in VOICES_DIR.glob("*.wav")]
    return {
        "builtin": [],
        "custom": custom,
    }


@app.post("/tts/generate")
def generate(req: GenerateRequest):
    m = get_model()

    # XTTS-v2 is clone-only — always needs a reference WAV
    wav_path = VOICES_DIR / f"{req.voice}.wav"
    if not wav_path.exists():
        raise HTTPException(404, f"Voice '{req.voice}' not found. Clone a voice first.")

    lang = req.language or "en"

    try:
        audio = m.tts(
            text=req.text,
            speaker_wav=str(wav_path),
            language=lang,
            split_sentences=True,
        )

        # Convert to WAV bytes
        audio_np = np.array(audio, dtype=np.float32)
        # Normalize to int16
        audio_int16 = np.int16(audio_np / np.max(np.abs(audio_np)) * 32767)

        buf = io.BytesIO()
        sample_rate = m.synthesizer.output_sample_rate if hasattr(m, "synthesizer") else 24000
        wav.write(buf, sample_rate, audio_int16)
        buf.seek(0)

        return StreamingResponse(buf, media_type="audio/wav", headers={
            "Content-Disposition": "inline; filename=xtts_tts.wav",
        })
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(500, str(e))


@app.post("/tts/clone-voice")
async def clone_voice(
    name: str = Form(...),
    file: UploadFile = File(...),
):
    if not file.filename or not file.filename.endswith(".wav"):
        raise HTTPException(400, "Upload a WAV file")

    safe_name = "".join(c for c in name if c.isalnum() or c in "-_").lower()
    if not safe_name:
        safe_name = uuid.uuid4().hex[:8]

    dest = VOICES_DIR / f"{safe_name}.wav"
    content = await file.read()
    dest.write_bytes(content)

    return {"voice": safe_name, "message": f"Voice '{safe_name}' cloned successfully"}


@app.get("/health")
def health():
    return {"status": "ok", "model_loaded": tts_model is not None, "backend": "xtts-v2"}
