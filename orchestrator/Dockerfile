# orchestrator/Dockerfile
FROM python:3.12-slim AS base

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/

WORKDIR /app

# Install orchestrator dependencies
COPY orchestrator/pyproject.toml orchestrator/uv.lock orchestrator/
RUN cd orchestrator && uv sync --frozen --no-dev --no-install-project

# Install default TTS engine dependencies
# CPU-only torch first (~200MB vs ~2.5GB CUDA), then remaining deps
COPY pocket-tts-server/pyproject.toml pocket-tts-server/
RUN cd pocket-tts-server && uv venv
RUN cd pocket-tts-server && uv pip install --python .venv/bin/python \
    torch --index-url https://download.pytorch.org/whl/cpu
RUN cd pocket-tts-server && uv pip install --python .venv/bin/python \
    fastapi "pocket-tts>=1.1.1" python-multipart uvicorn

# Copy source code
COPY orchestrator/ orchestrator/
COPY pocket-tts-server/ pocket-tts-server/
COPY xtts-server/ xtts-server/
COPY f5tts-server/ f5tts-server/
COPY gptsovits-server/ gptsovits-server/
COPY cosyvoice-server/ cosyvoice-server/

ENV MURMUR_DATA_DIR=/app/data

EXPOSE 8000

CMD ["orchestrator/.venv/bin/uvicorn", "orchestrator.main:app", "--host", "0.0.0.0", "--port", "8000"]
