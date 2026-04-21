# orchestrator/Dockerfile
FROM python:3.12-slim AS base

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg libsndfile1 espeak-ng \
    build-essential cmake git \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/

WORKDIR /app

# Install orchestrator dependencies
COPY orchestrator/pyproject.toml orchestrator/uv.lock orchestrator/
RUN cd orchestrator && uv sync --frozen --no-dev --no-install-project

# Install default TTS engine dependencies
# CPU-only torch in Docker build; runtime installs detect GPU via nvidia-smi
COPY tts-servers/pocket-tts-server/pyproject.toml tts-servers/pocket-tts-server/
RUN cd tts-servers/pocket-tts-server && uv venv
RUN cd tts-servers/pocket-tts-server && uv pip install --python .venv/bin/python \
    torch --index-url https://download.pytorch.org/whl/cpu
RUN cd tts-servers/pocket-tts-server && uv pip install --python .venv/bin/python \
    fastapi "pocket-tts>=1.1.1" python-multipart uvicorn

# Copy source code
COPY orchestrator/ orchestrator/
COPY tts-servers/pocket-tts-server/ tts-servers/pocket-tts-server/

# Copy only lightweight source for optional engines (models download at runtime)
COPY tts-servers/xtts-server/main.py tts-servers/xtts-server/pyproject.toml tts-servers/xtts-server/post_install.py tts-servers/xtts-server/
COPY tts-servers/f5tts-server/main.py tts-servers/f5tts-server/pyproject.toml tts-servers/f5tts-server/post_install.py tts-servers/f5tts-server/
COPY tts-servers/gptsovits-server/main.py tts-servers/gptsovits-server/pyproject.toml tts-servers/gptsovits-server/post_install.py tts-servers/gptsovits-server/
COPY tts-servers/cosyvoice-server/main.py tts-servers/cosyvoice-server/pyproject.toml tts-servers/cosyvoice-server/post_install.py tts-servers/cosyvoice-server/
COPY tts-servers/cosyvoice-server/repo/ tts-servers/cosyvoice-server/repo/

ENV MURMUR_DATA_DIR=/app/data
ENV COQUI_TOS_AGREED=1
ENV TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD=1

EXPOSE 8000

CMD ["orchestrator/.venv/bin/uvicorn", "orchestrator.main:app", "--host", "0.0.0.0", "--port", "8000"]
