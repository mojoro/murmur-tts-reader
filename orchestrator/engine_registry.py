from dataclasses import dataclass


@dataclass(frozen=True)
class EngineInfo:
    name: str
    display_name: str
    description: str
    size: str
    gpu: bool
    builtin_voices: bool
    repo_dir: str


ENGINES: dict[str, EngineInfo] = {
    "pocket-tts": EngineInfo(
        name="pocket-tts",
        display_name="Pocket TTS",
        description="8 built-in voices, ~400MB model, CPU-friendly",
        size="~400MB",
        gpu=False,
        builtin_voices=True,
        repo_dir="pocket-tts-server",
    ),
    "xtts-v2": EngineInfo(
        name="xtts-v2",
        display_name="XTTS v2",
        description="Multilingual, clone-only, GPU recommended (slow on CPU)",
        size="~1.1GB",
        gpu=True,
        builtin_voices=False,
        repo_dir="xtts-server",
    ),
    "f5-tts": EngineInfo(
        name="f5-tts",
        display_name="F5 TTS",
        description="Clone-only, auto-transcribes reference, GPU recommended",
        size="~7.5GB",
        gpu=True,
        builtin_voices=False,
        repo_dir="f5tts-server",
    ),
    "gpt-sovits": EngineInfo(
        name="gpt-sovits",
        display_name="GPT-SoVITS",
        description="Clone-only, auto-trims reference 3-10s, GPU recommended",
        size="~5.3GB",
        gpu=True,
        builtin_voices=False,
        repo_dir="gptsovits-server",
    ),
    "cosyvoice2": EngineInfo(
        name="cosyvoice2",
        display_name="CosyVoice 2",
        description="Zero-shot or cross-lingual, GPU recommended",
        size="~5.8GB",
        gpu=True,
        builtin_voices=False,
        repo_dir="cosyvoice-server",
    ),
}


def get_engine(name: str) -> EngineInfo:
    if name not in ENGINES:
        raise ValueError(f"Unknown engine: {name}")
    return ENGINES[name]
