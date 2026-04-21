# Dockerizing Five TTS Engines: A Study in Suffering

I spent a day getting five text-to-speech engines running inside a single Docker container for Murmur, an open-source alternative to ElevenReader. The idea is simple: one orchestrator process (Python/FastAPI) that manages five interchangeable TTS backends as subprocesses, each in its own venv, installed on-demand when a user clicks "Download" in the UI. The orchestrator handles auth, job queuing, audio storage, and engine lifecycle. The frontend is a Nuxt 3 PWA that talks to the orchestrator through a Nitro BFF. Base image: `python:3.12-slim`. How hard could it be?

Seventeen failures hard, as it turns out.

## The Architecture

Each engine is a standalone FastAPI server implementing the same four endpoints: `/health`, `/tts/voices`, `/tts/generate`, and `/tts/clone-voice`. The orchestrator spawns one engine at a time on port 8100, proxies requests to it, and manages installation via `uv venv` + `uv pip install`. When a user clicks "Download" on an engine in the settings UI, the orchestrator creates a venv, installs CPU-only PyTorch, installs the engine's deps from its `pyproject.toml`, installs uvicorn, and optionally runs a `post_install.py` script for model downloads. In theory.

## The Lineup

The five engines span the spectrum from practical to ambitious:

- **Pocket TTS** -- the sensible one. CPU-friendly, 8 built-in voices, ~400MB model. Uses the `pocket-tts` PyPI package. This one mostly just worked.
- **XTTS v2** (Coqui TTS) -- multilingual, clone-only, ~1.9GB model. Requires a reference WAV for every generation. This one did not just work.
- **F5-TTS** -- clone-only, auto-transcribes reference audio via Whisper, ~1.2GB model plus a separate Vocos vocoder and Whisper ASR model.
- **GPT-SoVITS** -- Chinese/English/Japanese, clone-only with auto-trimming. Requires 4.5GB of pretrained models (HuBERT, RoBERTa, two checkpoint files).
- **CosyVoice 2** -- zero-shot or cross-lingual synthesis from Alibaba's FunAudioLLM team. Downloads via ModelScope, ~5.8GB. The final boss.

## XTTS: Three Problems Wearing a Trenchcoat

### Problem 1: torch.load weights_only

PyTorch 2.6 changed `torch.load` to default to `weights_only=True`. Coqui TTS saves its `XttsConfig` as a serialized Python object, which the new default blocks with `WeightsUnpickler error: Unsupported global`. I already had a monkey-patch in the xtts-server's `main.py`:

```python
_orig_load = torch.load
torch.load = lambda *a, **kw: _orig_load(*a, **{**kw, "weights_only": False})
```

But this only covers the server process. The `post_install.py` script that pre-downloads the model also hits this. Rather than patching everywhere, I added `TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD=1` as a global env var in the Dockerfile and in the engine subprocess environment. Belt and suspenders.

### Problem 2: CPML License Prompt

On first model download, Coqui TTS calls `input()` to ask you to agree to the CPML license:

```
> "I have purchased a commercial license from Coqui: licensing@coqui.ai"
> "Otherwise, I agree to the terms of the non-commercial CPML"
> [y/n]
```

In a headless Docker subprocess with no stdin: `EOFError: EOF when reading a line`. The engine process crashes immediately. The fix is `COQUI_TOS_AGREED=1` in the environment, which I found by reading the Coqui TTS source code for `ask_tos()`. There's no mention of this env var in their README.

### Problem 3: The Torchcodec Saga

This one took three rounds.

**Round 1:** I installed CPU-only torch from the PyTorch CPU index (`--index-url https://download.pytorch.org/whl/cpu`). But the engine's `pyproject.toml` deps pulled `torchaudio` from regular PyPI -- the CUDA build, which includes native extensions linked against `libcudart.so`. Container has no CUDA. Crash: `OSError: libcudart.so.13: cannot open shared object file`.

Fix: pre-install `torchaudio` from the CPU index alongside torch. But the latest CPU torchaudio (>=2.6) now defaults to using `torchcodec` for audio loading. Torchcodec requires FFmpeg shared libraries and, in its PyPI build, CUDA native libraries. We have neither.

**Round 2:** I tried adding `torchcodec` to the install with `--extra-index-url https://pypi.org/simple` to get it from PyPI while keeping torch from the CPU index. pip helpfully used that extra index to *also* resolve `torch`, pulling `torch 2.11.0+cu130` from PyPI and overriding my carefully installed CPU version. A ~2.5GB CUDA torch build materialized where a ~200MB CPU build used to be.

**Round 3:** Pin `torchaudio<2.6` to get the last version before torchcodec became the default audio backend. Remove `--extra-index-url`. After deps install, `pip uninstall torchcodec` in case anything else dragged it in transitively. This became a standard step in the install pipeline -- torchcodec is the cockroach of the PyTorch ecosystem in 2026.

### Problem 4: Lazy Model Downloads

The XTTS v2 model (~1.87GB) downloads on first `TTS("tts_models/multilingual/multi-dataset/xtts_v2")` call. In my original design, this happened inside `get_model()` which was called on the first `/tts/generate` request. The user clicks "Generate Audio" and watches a spinner for three minutes while 1.87GB downloads in the background, with no indication of what's happening.

I added a `post_install.py` hook: if an engine directory contains this file, the installer runs it with the engine's venv Python after deps are installed. For XTTS, it just does:

```python
from TTS.api import TTS
TTS("tts_models/multilingual/multi-dataset/xtts_v2").to(device)
```

This turned out to be one of the best decisions of the day. Every single engine needed a post_install script.

## F5-TTS: Torchcodec, The Sequel

### Missing ffmpeg

F5-TTS auto-transcribes reference audio using a Whisper pipeline from HuggingFace `transformers`. That pipeline calls `ffmpeg_read()` which shells out to `ffmpeg` to decode audio. `python:3.12-slim` doesn't have ffmpeg. Error: `FileNotFoundError: [Errno 2] No such file or directory: 'ffmpeg'`. Added `ffmpeg` to the Dockerfile's `apt-get install`.

### Torchcodec, Again

After fixing ffmpeg, generation still crashed. This time the stack trace showed `transformers/pipelines/automatic_speech_recognition.py` importing `torchcodec`. Not torchaudio this time -- `transformers` itself tries to use torchcodec for its ASR pipeline. The CUDA-only native libs crash with `RuntimeError: Could not load libtorchcodec`. Same fix: uninstall torchcodec after deps install. I added this as a permanent step in `install_engine()`:

```python
proc = await asyncio.create_subprocess_exec(
    "uv", "pip", "uninstall", "--python", venv_python, "torchcodec", ...
)
await proc.wait()
```

### Three Models, Not One

The post_install script downloaded the main F5-TTS model but not the Vocos vocoder (`charactr/vocos-mel-24khz`) or the Whisper ASR model (`openai/whisper-large-v3-turbo`). Both download lazily on first inference. Fixed by adding to post_install:

```python
from f5_tts.api import F5TTS
model = F5TTS()  # downloads main model + Vocos
from f5_tts.infer.utils_infer import initialize_asr_pipeline
initialize_asr_pipeline()  # downloads Whisper
```

### ReadTimeout

After all downloads were pre-cached, generation still failed. CPU inference with F5-TTS involves loading Whisper weights (~1.5GB), transcribing the reference audio, then running the actual TTS diffusion model. This takes well over 120 seconds on CPU. The httpx client in the job worker had a 120s timeout. Bumped to 600s.

## GPT-SoVITS: The Version That Doesn't Exist

### Missing C Compiler

The `gpt-sovits-python` package depends on `jieba-fast`, which compiles C extensions from source. And `pyopenjtalk` (Japanese phoneme support), which needs `cmake`. `python:3.12-slim` has neither `cc` nor `cmake`. Error: `error: command 'cc' failed: No such file or directory`. Added `build-essential` and `cmake` to the Dockerfile.

### The LangSegment Nightmare

This was the most absurd dependency issue of the day. GPT-SoVITS's code imports `setLangfilters` from a package called LangSegment. Here's what I tried:

1. `LangSegment<1.0` in pyproject.toml -- installs 0.2.0 (the only version on PyPI), which doesn't have `setLangfilters`.
2. `LangSegment==0.3.4` -- version doesn't exist on PyPI.
3. `LangSegment>=0.3.3,<0.4` -- only 0.2.0 is available. Dependency resolution fails.

What happened: LangSegment 0.3.5 used to be on PyPI and had `setLangfilters`. The maintainer republished 0.2.0, effectively yanking the working version. The `gpt-sovits-python` package on PyPI declares `LangSegment>=0.2.0` in its deps but internally uses functions from 0.3.5. It's a broken package.

Fix: install from the original GitHub repo in post_install.py:

```python
subprocess.check_call([
    "uv", "pip", "install", "--python", sys.executable,
    "git+https://github.com/ishine/LangSegment.git",
])
```

This required adding `git` to the Dockerfile's apt packages.

### Missing Pretrained Models

GPT-SoVITS needs four pretrained model files totaling 4.5GB:
- `s1bert25hz-2kh-longer-epoch=68e-step=50232.ckpt` (155MB)
- `s2G488k.pth` (106MB)
- `chinese-hubert-base/` (1.5GB HuggingFace model directory)
- `chinese-roberta-wwm-ext-large/` (2.9GB HuggingFace model directory)

These were in the local `pretrained_models/` directory but that directory was in `.dockerignore` (rightfully -- you don't bake 4.5GB into a Docker image). The post_install script downloads them from HuggingFace using `hf_hub_download` and `snapshot_download`.

### NLTK Data

The g2p-en package (grapheme-to-phoneme for English) needs NLTK data. It downloaded `averaged_perceptron_tagger` and `cmudict` at runtime. But the newer version needs `averaged_perceptron_tagger_eng` specifically -- not the same package. Added all three to the post_install NLTK downloads.

## CosyVoice: The Final Boss

CosyVoice broke in six different ways, each revealed only after fixing the previous one.

### Torchvision Version Mismatch

I was pre-installing `torchvision` alongside `torch` and `torchaudio` from the CPU index. CosyVoice's `pyproject.toml` pins `torch==2.3.1`. The deps install step downgraded torch from latest to 2.3.1, but torchvision stayed at the latest version (designed for latest torch). Result: `AttributeError: module 'torch.library' has no attribute 'register_fake'` -- a function added in PyTorch 2.4 that the newer torchvision was calling. Fix: stop pre-installing torchvision entirely. No TTS engine actually needs it for inference; it was getting pulled in by `transformers` as an optional import.

### Source Code in .dockerignore

CosyVoice's inference code lives in `cosyvoice-server/repo/` -- a clone of the FunAudioLLM/CosyVoice GitHub repo (73MB). This directory was in `.dockerignore` alongside model directories like `cosyvoice-server/models/`. Models should be excluded (downloaded at runtime). Source code should not. `COPY cosyvoice-server/repo/ cosyvoice-server/repo/` failed with `not found` until I removed the dockerignore entry.

### Post-Install Pipe Deadlock

The engine manager ran `post_install.py` with `stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE` and then called `await proc.wait()`. ModelScope's download progress bars (for a 5.8GB model download with 20 individual files) produced enough output to fill the 64KB pipe buffer. The subprocess blocked on write. The orchestrator blocked on wait. Classic deadlock. Fix: don't capture stdout -- let it stream directly to the container logs so you can see download progress.

### The Dependency Cascade

After install succeeded, the engine started but generation crashed. Six times in a row, each with a different missing module:

1. `ModuleNotFoundError: No module named 'diffusers'` -- Matcha-TTS decoder imports `from diffusers.models.activations import get_activation`
2. `ModuleNotFoundError: No module named 'hydra'` -- `matcha/utils/__init__.py` imports from `instantiators.py` which imports `hydra` (a training dependency imported at module load time)
3. `ModuleNotFoundError: No module named 'rich'` -- `matcha/utils/__init__.py` also imports `rich_utils.py` which imports `rich`
4. `ModuleNotFoundError: No module named 'pyarrow'` -- used by the dataset processor
5. `ModuleNotFoundError: No module named 'pyworld'` -- audio pitch processing
6. `ModuleNotFoundError: No module named 'pkg_resources'` -- `setuptools>=82` removed `pkg_resources`, but `pyworld` still imports it. Fix: pin `setuptools<81`.

I discovered these one at a time through the UI: install engine, switch to it, try to generate, read error in Docker logs, add the dep, rebuild container, repeat. After the fourth round I finally exec'd into the running container and tested imports directly. Should have done that immediately.

### Post-Install Import Error

My original `post_install.py` for CosyVoice tried to `from cosyvoice.cli.cosyvoice import CosyVoice2` to trigger model loading. This import requires `sys.path` manipulation (the code isn't a proper Python package -- it needs `repo/` and `repo/third_party/Matcha-TTS/` on sys.path). Inside the post_install subprocess, none of that was set up. Fix: use `modelscope.snapshot_download` directly, which just downloads files without importing any CosyVoice code:

```python
from modelscope import snapshot_download
snapshot_download("iic/CosyVoice2-0.5B", local_dir=str(MODEL_DIR))
```

## The Meta-Failures

Beyond the engine-specific carnage, there were orchestration bugs that affected all engines:

**Engine status race condition:** The engine manager set the engine's status to `RUNNING` immediately after spawning the subprocess, before the health check passed. When the old engine's stop event triggered a frontend refresh via SSE, the new engine appeared "running" in the UI. The frontend auto-synced voices, which tried to connect to an engine that was still loading its model. Fix: keep status as `INSTALLED` until health check passes.

**Stale builtin voices:** When switching from Pocket TTS (8 builtin voices) to a clone-only engine (0 builtins), the voice list kept showing the Pocket TTS voices. The sync endpoint only inserted new voices -- it never deleted ones missing from the current engine's response. Fix: delete builtin voices not in the current engine's response before inserting new ones.

**Cross-engine voice portability:** Cloned voices are stored as WAV files in the orchestrator's storage. When you switch engines, the new engine doesn't have the voice WAV in its own `voices/` directory. The job worker now checks if the engine has the voice, and if not, copies the WAV via the engine's `/tts/clone-voice` endpoint before generating. If the voice is a builtin from another engine (no WAV file to copy), the job fails with a clear error instead of a cryptic 404.

## The Dockerfile Evolution

The Dockerfile started as:
```dockerfile
FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/
```

By the end of the day:
```dockerfile
FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg libsndfile1 espeak-ng \
    build-essential cmake git \
    && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/
```

Seven system packages that no `pyproject.toml` mentions:
- `ffmpeg` -- transformers ASR pipeline, F5-TTS audio processing
- `libsndfile1` -- soundfile/scipy audio I/O
- `espeak-ng` -- XTTS phoneme generation
- `build-essential` -- jieba-fast, pyopenjtalk C extensions
- `cmake` -- pyopenjtalk build
- `git` -- installing LangSegment from GitHub

## The Engine Install Pipeline

The final install pipeline for each engine:

1. `uv venv` -- create isolated venv
2. `uv pip install torch torchaudio<2.6 [--index-url cpu]` -- pre-install torch stack (GPU-aware: checks for `nvidia-smi`)
3. `uv pip install --requirement pyproject.toml` -- install engine deps
4. `uv pip uninstall torchcodec` -- remove CUDA-only transitive dep
5. `uv pip install uvicorn[standard]` -- ensure ASGI server is present
6. Run `post_install.py` if it exists -- download models, fix broken deps, pre-cache data

All subprocess launches include `COQUI_TOS_AGREED=1` and `TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD=1` in the environment.

## What I Actually Learned

The Python ML ecosystem in containers is a dependency minefield. Every package has implicit system-level dependencies, version-coupled native extensions, and models that download at runtime. `pip install` succeeding means almost nothing -- you have to actually import the code and run inference to find the real failures.

**Torchcodec** was the single biggest recurring headache, pulled in transitively by both torchaudio and transformers, requiring CUDA native libraries even for CPU-only inference. Pinning torchaudio and uninstalling torchcodec became a ritual.

**Post-install hooks** that pre-download models are not optional. Lazy downloading during the first API call means your user clicks "generate" and waits five minutes staring at a spinner, assuming the app is broken. Every engine needed at least one pre-download: XTTS (model), F5-TTS (model + vocoder + Whisper), GPT-SoVITS (4 pretrained models + LangSegment + NLTK data), CosyVoice (ModelScope snapshot), even Pocket TTS (HuggingFace model).

**Test in the actual container.** My dev machine has `gcc`, `ffmpeg`, `cmake`, system Python packages, and pre-cached HuggingFace models. The `python:3.12-slim` container has none of that. Every "works on my machine" was a lie. Late in the day I started exec'ing into the container to test imports directly -- this found CosyVoice's six missing deps in one pass instead of six rebuild cycles.

**When multiple things are broken, the first error hides the rest.** Each engine had 3-6 issues, but you only see the first one until you fix it. The instinct is to fix-and-rebuild in a loop, but the smarter move is to get into the container and try to exercise the full code path manually before committing a fix.

Five engines. One container. Seventeen fixes. It works now. Until the next PyTorch release.
