import io
import uuid
from pathlib import Path

import numpy as np
import scipy.io.wavfile as wav
from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

app = FastAPI(title="F5-TTS Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Global state ---

VOICES_DIR = Path(__file__).parent / "voices"
VOICES_DIR.mkdir(exist_ok=True)

f5_model = None


def get_model():
    global f5_model
    if f5_model is None:
        from f5_tts.api import F5TTS

        f5_model = F5TTS()
    return f5_model


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

    # F5-TTS is clone-only — always needs a reference WAV
    wav_path = VOICES_DIR / f"{req.voice}.wav"
    if not wav_path.exists():
        raise HTTPException(404, f"Voice '{req.voice}' not found. Clone a voice first.")

    try:
        audio, sr, _ = m.infer(
            ref_file=str(wav_path),
            ref_text="",  # empty = auto-transcribe
            gen_text=req.text,
        )

        # Convert to int16 WAV
        audio_np = np.array(audio, dtype=np.float32)
        peak = np.max(np.abs(audio_np))
        if peak > 0:
            audio_np = audio_np / peak
        audio_int16 = np.int16(audio_np * 32767)

        buf = io.BytesIO()
        wav.write(buf, sr, audio_int16)
        buf.seek(0)

        return StreamingResponse(buf, media_type="audio/wav", headers={
            "Content-Disposition": "inline; filename=f5tts_output.wav",
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

    safe_name = "".join(c for c in name if c.isalnum() or c in "-_ ").strip()
    if not safe_name:
        safe_name = uuid.uuid4().hex[:8]

    dest = VOICES_DIR / f"{safe_name}.wav"
    content = await file.read()
    dest.write_bytes(content)

    return {"voice": safe_name, "message": f"Voice '{safe_name}' cloned successfully"}


@app.get("/health")
def health():
    return {"status": "ok", "model_loaded": f5_model is not None, "backend": "f5-tts"}
