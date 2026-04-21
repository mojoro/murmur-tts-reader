# Murmur

**Open-source, self-hosted text-to-speech reader.** Paste text, import a document, or grab a web article — pick a voice and listen. Runs entirely on your hardware with no API keys, no cloud dependency, and optional voice cloning.

Think of it as a self-hosted alternative to ElevenReader or Speechify.

## Features

- **Multiple input sources** — paste text, import PDF/EPUB/DOCX/TXT, or fetch any web article by URL
- **5 TTS engines** — swap between engines from the UI; only one runs at a time to conserve resources
- **Voice cloning** — upload a WAV sample or record from your mic to clone any voice
- **Word-level highlighting** — optional WhisperX alignment highlights each word as it's spoken
- **Inline images** — images from documents and articles are preserved in the reader
- **Bookmarks** — save your place with notes at any sentence
- **Offline PWA** — install on your phone, syncs audio in the background, works without a connection
- **Multi-user** — each account's reads, voices, and bookmarks are fully isolated
- **Dark mode** — dark by default, with a light mode toggle

## TTS Engines

| Engine | Voices | Size | GPU | Notes |
|--------|--------|------|-----|-------|
| **Pocket TTS** | 8 built-in | ~400 MB | No | Default engine, works well on CPU |
| **XTTS v2** | Clone only | ~1.1 GB | Recommended | Multilingual, slow on CPU |
| **F5 TTS** | Clone only | ~7.5 GB | Recommended | Auto-transcribes reference audio |
| **GPT-SoVITS** | Clone only | ~5.3 GB | Recommended | Auto-trims reference to 3-10s |
| **CosyVoice 2** | Clone only | ~5.8 GB | Recommended | Zero-shot and cross-lingual |

Engines are installed and managed through the Settings page. Switch between them at any time — audio is regenerated with the new engine.

## Quick Start (Docker)

Docker is the recommended way to run Murmur. You need [Docker](https://docs.docker.com/get-docker/) with the Compose plugin.

### 1. Clone and configure

```bash
git clone https://github.com/anthropics/murmur-tts-reader.git
cd murmur-tts-reader
cp .env.example .env
```

Edit `.env`:

```env
# Required: a random string for signing auth tokens
MURMUR_JWT_SECRET=change-me-to-a-random-string

# Required: your server's LAN IP (for HTTPS certificate + PWA install). Make sure to replace with your server's actual IP
MURMUR_HOST=192.168.1.100

# Optional: change default ports
# MURMUR_PORT=443
# MURMUR_HTTP_PORT=80

# Optional: needed for pocket-tts voice cloning. You must create a huggingface account and accept the pocket-tts disclaimer.
# HF_TOKEN=hf_...
```

### 2. Start the services

```bash
# full app with word-by-word text highlighting
docker compose --profile full up -d
# or just the core services (Caddy + app + orchestrator), no alignment server
docker compose up -d

```

This starts:
- **Caddy** — reverse proxy with automatic HTTPS on your LAN
- **App** — Nuxt frontend (SSR + PWA)
- **Orchestrator** — FastAPI backend managing the database, job queue, and TTS engines
- **Alignment server** *(optional)* — WhisperX for word-level timestamps

### 3. Open in your browser

Go to `https://<your-LAN-IP>` (e.g. `https://192.168.1.100`).

**First time on a phone?** Visit `http://<your-LAN-IP>` first to download the CA certificate and follow the on-screen setup instructions, then navigate to the HTTPS URL to install the PWA.

### 4. Create an account and start listening

Register from the login page, paste some text or import a document, select a voice, and hit generate. (your account only lives on your machine. It's never uploaded anywhere)

## Development Setup

### Prerequisites

- **Node.js** 20+
- **Python** 3.11+ with [uv](https://docs.astral.sh/uv/)

### Frontend

```bash
cd frontend
npm install
npm run dev          # Nuxt dev server on http://localhost:4000
```

### Orchestrator (required)

```bash
(cd orchestrator && uv sync)
uv --project orchestrator run uvicorn orchestrator.main:app --port 8000
```

### Alignment server (optional)

```bash
cd alignment-server
uv sync
uv run uvicorn main:app --port 8001
```

### Dev with Docker

If you prefer Docker but want hot reload on the frontend:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

This mounts the source directory into the container and runs `nuxi dev`. No Caddy/HTTPS — access the app at `http://localhost:4000`.

### Running tests

```bash
cd frontend
npm run test         # vitest run
npm run test:watch   # vitest watch mode
```

## Architecture

```
[TTS Engines]  <-- managed by orchestrator (subprocess lifecycle)
      |
      v
[Orchestrator :8000]  <-- SQLite DB + audio files on disk
      |                    job queue, engine management, auth
      v
[Nitro BFF]  <-- JWT validation, X-User-Id header injection
      |          catch-all proxy: /api/* -> orchestrator
      v
[Nuxt SSR + PWA in browser]
  |-- Auth (login/register, httpOnly cookie)
  |-- useFetch/useAsyncData against /api/* routes
  |-- Workbox caching (audio=CacheFirst, reads=NetworkFirst)
  '-- IndexedDB offline mutation queue
      |
      v (optional, for word-level alignment)
[Alignment server :8001]  <-- called by orchestrator, not frontend
```

The frontend never talks to the orchestrator directly. The Nitro BFF validates the JWT cookie and injects an `X-User-Id` header, keeping the orchestrator's internal API simple and user-scoped.

**Key design choices:**

- **Job-based generation** — TTS is async. Creating a generation request returns a job; progress streams via SSE.
- **Sentence-by-sentence TTS** — text is split into segments server-side, enabling progressive playback and per-sentence alignment.
- **One engine at a time** — the orchestrator manages engine processes (install, start, stop). Only one engine runs to keep resource usage low.
- **Offline-first PWA** — Workbox caches the app shell and API responses. Audio is CacheFirst (immutable once generated). An IndexedDB queue replays failed writes on reconnect, and background sync pre-fetches audio in batches.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `MURMUR_JWT_SECRET` | Yes (prod) | JWT signing secret |
| `MURMUR_HOST` | Yes | Server LAN IP for HTTPS cert generation |
| `MURMUR_PORT` | No | HTTPS port (default: `443`) |
| `MURMUR_HTTP_PORT` | No | HTTP port for setup page (default: `80`) |
| `HF_TOKEN` | No | Hugging Face token for voice cloning engines |
| `NUXT_ORCHESTRATOR_URL` | No | Orchestrator URL (default: `http://localhost:8000`) |

## License

MIT
