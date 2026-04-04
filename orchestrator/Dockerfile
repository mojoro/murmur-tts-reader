# orchestrator/Dockerfile
FROM python:3.12-slim AS base

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/

WORKDIR /app

# Install orchestrator dependencies
COPY orchestrator/pyproject.toml orchestrator/uv.lock orchestrator/
RUN cd orchestrator && uv sync --frozen --no-dev --no-install-project

# Install default TTS engine dependencies (CPU-only torch — pocket-tts is CPU-friendly)
COPY pocket-tts-server/pyproject.toml pocket-tts-server/uv.lock pocket-tts-server/
ENV UV_EXTRA_INDEX_URL=https://download.pytorch.org/whl/cpu
RUN cd pocket-tts-server && uv sync --frozen --no-install-project

# Copy source code
COPY orchestrator/ orchestrator/
COPY pocket-tts-server/ pocket-tts-server/

ENV MURMUR_DATA_DIR=/app/data

EXPOSE 8000

CMD ["orchestrator/.venv/bin/uvicorn", "orchestrator.main:app", "--host", "0.0.0.0", "--port", "8000"]
