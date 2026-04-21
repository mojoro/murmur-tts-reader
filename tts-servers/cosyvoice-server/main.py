import io
import os
import sys
import uuid
from pathlib import Path

import numpy as np
import scipy.io.wavfile as wavfile
import torch
from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

# CosyVoice needs both the repo root and Matcha-TTS on sys.path
REPO_DIR = Path(__file__).parent / "repo"
sys.path.insert(0, str(REPO_DIR))
sys.path.insert(0, str(REPO_DIR / "third_party" / "Matcha-TTS"))

from cosyvoice.cli.cosyvoice import CosyVoice2  # noqa: E402

app = FastAPI(title="CosyVoice TTS Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Global state ---

VOICES_DIR = Path(__file__).parent / "voices"
VOICES_DIR.mkdir(exist_ok=True)

MODEL_DIR = Path(__file__).parent / "models" / "CosyVoice2-0.5B"

cosyvoice_model: CosyVoice2 | None = None


def get_model() -> CosyVoice2:
    global cosyvoice_model
    if cosyvoice_model is None:
        model_path = str(MODEL_DIR)
        if not MODEL_DIR.exists():
            # Fall back to ModelScope ID — CosyVoice will auto-download
            model_path = "iic/CosyVoice2-0.5B"
        cosyvoice_model = CosyVoice2(model_path)
    return cosyvoice_model


# --- Helpers ---


def load_reference_wav(voice: str) -> str:
    """Resolve a voice name to a WAV file path."""
    wav_path = VOICES_DIR / f"{voice}.wav"
    if not wav_path.exists():
        raise HTTPException(404, f"Voice '{voice}' not found. Clone a voice first.")
    return str(wav_path)


def extract_prompt_text(wav_path: str) -> str:
    """Read the companion .txt file for a voice, or return a generic prompt.

    CosyVoice zero-shot needs prompt_text that matches the reference audio.
    We store it alongside the WAV as <name>.txt when cloning.
    """
    txt_path = Path(wav_path).with_suffix(".txt")
    if txt_path.exists():
        return txt_path.read_text().strip()
    # Generic English prompt text — works reasonably well as a fallback
    return "Hello, this is a sample of my voice."


def synthesize(text: str, voice: str, language: str | None = None) -> tuple[np.ndarray, int]:
    """Run CosyVoice inference and return (audio_int16, sample_rate)."""
    model = get_model()
    wav_path = load_reference_wav(voice)
    prompt_text = extract_prompt_text(wav_path)

    # Use zero-shot if we have a matching transcript, otherwise cross-lingual
    chunks = []
    if prompt_text and prompt_text != "Hello, this is a sample of my voice.":
        inference_fn = model.inference_zero_shot(text, prompt_text, wav_path, stream=False)
    else:
        inference_fn = model.inference_cross_lingual(text, wav_path, stream=False)
    for chunk in inference_fn:
        audio_tensor = chunk["tts_speech"]
        # tensor shape: (1, N) — squeeze to 1-D
        if audio_tensor.dim() > 1:
            audio_tensor = audio_tensor.squeeze(0)
        chunks.append(audio_tensor.cpu().numpy())

    if not chunks:
        raise HTTPException(500, "Model produced no audio output")

    audio = np.concatenate(chunks)
    sample_rate = model.sample_rate

    # Normalize and convert to int16 WAV
    peak = np.max(np.abs(audio))
    if peak > 0:
        audio = audio / peak
    audio_int16 = np.int16(audio * 32767)

    return audio_int16, sample_rate


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
    try:
        audio_int16, sample_rate = synthesize(req.text, req.voice, req.language)

        buf = io.BytesIO()
        wavfile.write(buf, sample_rate, audio_int16)
        buf.seek(0)

        return StreamingResponse(buf, media_type="audio/wav", headers={
            "Content-Disposition": "inline; filename=cosyvoice_tts.wav",
        })
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(500, str(e))


@app.post("/tts/clone-voice")
async def clone_voice(
    name: str = Form(...),
    file: UploadFile = File(...),
    prompt_text: str = Form(""),
):
    """Save a reference WAV for zero-shot cloning.

    Optionally include prompt_text — a transcription of the reference audio.
    This significantly improves zero-shot quality.
    """
    if not file.filename or not file.filename.lower().endswith(".wav"):
        raise HTTPException(400, "Upload a WAV file")

    safe_name = "".join(c for c in name if c.isalnum() or c in "-_ ").strip()
    if not safe_name:
        safe_name = uuid.uuid4().hex[:8]

    dest = VOICES_DIR / f"{safe_name}.wav"
    content = await file.read()
    dest.write_bytes(content)

    # Save prompt text alongside if provided
    if prompt_text.strip():
        txt_dest = VOICES_DIR / f"{safe_name}.txt"
        txt_dest.write_text(prompt_text.strip())

    return {"voice": safe_name, "message": f"Voice '{safe_name}' cloned successfully"}


@app.get("/health")
def health():
    return {
        "status": "ok",
        "model_loaded": cosyvoice_model is not None,
        "backend": "cosyvoice",
    }
