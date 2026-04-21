import io
import uuid
from pathlib import Path

import numpy as np
import scipy.io.wavfile as wav
import torch

# Patch torch.load for PyTorch 2.6+ compatibility
_orig_load = torch.load
torch.load = lambda *a, **kw: _orig_load(*a, **{**kw, "weights_only": False})

from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

app = FastAPI(title="GPT-SoVITS TTS Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Global state ---

VOICES_DIR = Path(__file__).parent / "voices"
VOICES_DIR.mkdir(exist_ok=True)

tts_model = None


def get_model():
    global tts_model
    if tts_model is not None:
        return tts_model

    from gpt_sovits_python import TTS, TTS_Config

    device = "cuda" if torch.cuda.is_available() else "cpu"
    is_half = device == "cuda"

    config_dict = {
        "default": {
            "device": device,
            "is_half": is_half,
            "t2s_weights_path": "pretrained_models/s1bert25hz-2kh-longer-epoch=68e-step=50232.ckpt",
            "vits_weights_path": "pretrained_models/s2G488k.pth",
            "cnhuhbert_base_path": "pretrained_models/chinese-hubert-base",
            "bert_base_path": "pretrained_models/chinese-roberta-wwm-ext-large",
        }
    }

    tts_config = TTS_Config(config_dict)
    tts_model = TTS(tts_config)
    return tts_model


# --- Language mapping ---

# GPT-SoVITS supports: auto, en, zh, ja, all_zh, all_ja
LANG_MAP = {
    "en": "en",
    "english": "en",
    "zh": "zh",
    "chinese": "zh",
    "ja": "ja",
    "japanese": "ja",
    "auto": "auto",
}


def resolve_language(lang: str | None) -> str:
    if lang is None:
        return "auto"
    return LANG_MAP.get(lang.lower(), "auto")


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

    wav_path = VOICES_DIR / f"{req.voice}.wav"
    if not wav_path.exists():
        raise HTTPException(404, f"Voice '{req.voice}' not found. Clone a voice first.")

    # GPT-SoVITS requires 3-10s reference audio — auto-trim if needed
    ref_path = str(wav_path)
    sr_ref, audio_ref = wav.read(ref_path)
    duration = len(audio_ref) / sr_ref
    if duration > 10:
        trimmed = audio_ref[:int(sr_ref * 9)]
        trimmed_path = str(VOICES_DIR / f"{req.voice}_trimmed.wav")
        wav.write(trimmed_path, sr_ref, trimmed)
        ref_path = trimmed_path

    text_lang = resolve_language(req.language)
    prompt_lang = resolve_language(req.language)

    inputs = {
        "text": req.text,
        "text_lang": text_lang,
        "ref_audio_path": ref_path,
        "prompt_text": "",
        "prompt_lang": prompt_lang,
        "top_k": 5,
        "top_p": 1,
        "temperature": 1,
        "text_split_method": "cut0",
        "batch_size": 1,
        "speed_factor": 1.0,
        "return_fragment": False,
        "seed": -1,
        "parallel_infer": True,
        "repetition_penalty": 1.35,
    }

    try:
        # run() is a generator yielding (sample_rate, numpy_array) tuples
        audio_chunks = []
        sample_rate = 32000
        for sr, audio_np in m.run(inputs):
            sample_rate = sr
            audio_chunks.append(audio_np)

        if not audio_chunks:
            raise HTTPException(500, "No audio generated")

        audio_data = np.concatenate(audio_chunks)

        # Normalize to int16 if needed
        if audio_data.dtype != np.int16:
            peak = np.max(np.abs(audio_data))
            if peak > 0:
                audio_data = np.int16(audio_data / peak * 32767)
            else:
                audio_data = np.int16(audio_data)

        buf = io.BytesIO()
        wav.write(buf, sample_rate, audio_data)
        buf.seek(0)

        return StreamingResponse(buf, media_type="audio/wav", headers={
            "Content-Disposition": "inline; filename=gptsovits_tts.wav",
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
    return {
        "status": "ok",
        "model_loaded": tts_model is not None,
        "backend": "gpt-sovits",
    }
