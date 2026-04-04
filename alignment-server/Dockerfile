# alignment-server/Dockerfile
FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/

WORKDIR /app

# Install CPU-only torch first (smaller than default CUDA bundle)
RUN uv pip install --system torch torchaudio --index-url https://download.pytorch.org/whl/cpu

COPY alignment-server/pyproject.toml alignment-server/uv.lock* alignment-server/
RUN cd alignment-server && uv sync --no-dev --no-install-project

COPY alignment-server/ alignment-server/

ENV HF_HOME=/app/cache

EXPOSE 8001

CMD ["alignment-server/.venv/bin/uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001", "--app-dir", "alignment-server"]
