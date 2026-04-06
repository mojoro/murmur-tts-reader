# alignment-server/Dockerfile
FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/

WORKDIR /app

COPY alignment-server/pyproject.toml alignment-server/uv.lock* alignment-server/

# Use CPU-only torch index to avoid downloading the massive CUDA bundle
ENV UV_EXTRA_INDEX_URL=https://download.pytorch.org/whl/cpu
RUN cd alignment-server && uv sync --no-dev --no-install-project

COPY alignment-server/ alignment-server/

ENV HF_HOME=/app/cache

EXPOSE 8001

CMD ["alignment-server/.venv/bin/uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001", "--app-dir", "alignment-server"]
