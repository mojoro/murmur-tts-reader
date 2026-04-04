# Building Murmur from Scratch

A step-by-step guide to building a self-hosted, offline-capable text-to-speech reader with voice cloning. Paste text (or import a URL, PDF, EPUB, DOCX), select a voice, and Murmur synthesizes audio with word-level highlighting — no API keys, no cloud.

## Architecture

```
+-----------------------------------------------------------+
|  Docker Compose                                           |
|                                                           |
|  +-------------------------+                              |
|  |  Nuxt (Nitro)           | <-- only exposed service     |
|  |  Port 3000 -> host :80  |                              |
|  |                         |                              |
|  |  /                      | serves SSR + SPA pages       |
|  |  /server/api/*          | BFF: proxies to orchestrator |
|  |  /server/middleware/*   | auth guards (JWT cookies)    |
|  +------------+------------+                              |
|               | internal Docker network                   |
|  +------------v------------+   +-----------------------+  |
|  |  Orchestrator (FastAPI) |   |  Alignment Server     |  |
|  |  Port 8000 internal     |   |  Port 8001 internal   |  |
|  |                         |   |  WhisperX (always on) |  |
|  |  SQLite DB              |   +-----------------------+  |
|  |  Audio file storage     |                              |
|  |  Job queue              |   +-----------------------+  |
|  |  Auth (JWT + bcrypt)    |   |  TTS Engine           |  |
|  |  TTS engine manager     +-->|  (subprocess, 1 at a  |  |
|  |  REST API               |   |   time, managed by    |  |
|  |  SSE event streams      |   |   orchestrator)       |  |
|  +-------------------------+   +-----------------------+  |
|                                                           |
|  Volume: murmur-data (SQLite DB + audio + engines)        |
+-----------------------------------------------------------+
```

**Four services:**

| Service | Tech | Role |
|---------|------|------|
| Nuxt app | Node.js, Vue 3, Nuxt 3 | SSR frontend + BFF proxy |
| Orchestrator | Python, FastAPI | Auth, data, job queue, engine management |
| Alignment server | Python, WhisperX | Word-level timestamps for audio |
| TTS engine | Python (varies) | Text-to-speech synthesis (1 running at a time) |

**Data flow:** Browser talks only to Nuxt. Nuxt validates the JWT cookie, injects `X-User-Id`, and proxies to the orchestrator. The orchestrator owns all data (SQLite + audio files on disk) and manages TTS engines as subprocesses.

---

## Part 1: TTS Engine Backends

Five interchangeable TTS backends, all implementing the same API contract. You only need one to get started — pocket-tts is the default.

### The API Contract

Every backend exposes these 4 endpoints on port 8000:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | `{status, model_loaded, backend}` |
| `/tts/voices` | GET | `{builtin: [...], custom: [...]}` |
| `/tts/generate` | POST | `{text, voice, language?}` -> streams WAV (24 kHz) |
| `/tts/clone-voice` | POST | Form: `name`, `file` (WAV), `prompt_text?` -> saves voice |

### pocket-tts-server (default, ~400MB)

The simplest backend. 8 built-in voices, CPU-friendly, fast.

```
pocket-tts-server/
  main.py           # FastAPI app
  pyproject.toml    # Deps: fastapi, uvicorn, pocket-tts, scipy, numpy
```

`main.py` structure:

- **Lifespan**: Loads the `pocket_tts.TTSModel` on startup
- **GET /tts/voices**: Returns 8 built-in voices (alba, marius, javert, jean, fantine, cosette, eponine, azelma) plus any custom voices from the `voices/` directory
- **POST /tts/generate**: Takes `{text, voice}`, runs inference, streams WAV via `StreamingResponse`
- **POST /tts/clone-voice**: Saves uploaded WAV to `voices/{name}.wav`, pre-loads voice state
- **GET /health**: Returns model status

### Other backends

| Backend | Specialty | Model size |
|---------|-----------|------------|
| xtts-v2 | Multilingual, clone-only | ~1.1 GB |
| f5-tts | Clone-only, auto-transcribes reference audio | ~7.5 GB |
| gpt-sovits | Clone-only, auto-trims reference to 3-10s | ~5.3 GB |
| cosyvoice2 | Zero-shot or cross-lingual | ~5.8 GB |

All follow the same 4-endpoint contract. The orchestrator doesn't care which is running — it just calls the API.

---

## Part 2: The Orchestrator

The orchestrator is the brain. It owns all persistent data, manages TTS engines, runs background jobs, and handles auth.

### Project setup

```
orchestrator/
  main.py              # FastAPI app, lifespan, router registration
  config.py            # Environment config (paths, JWT, ports)
  db.py                # SQLite connection (aiosqlite)
  schema.sql           # 7 tables
  models.py            # Pydantic request/response schemas
  auth.py              # JWT + bcrypt
  sentence_splitter.py # Text -> sentences
  engine_registry.py   # Metadata for 5 TTS backends
  engine_manager.py    # Subprocess lifecycle (start/stop/health)
  job_worker.py        # Background FIFO job processor
  job_events.py        # User-scoped SSE event bus
  routers/
    auth_router.py     # POST /auth/register, /login, GET /me
    reads.py           # CRUD + POST /reads/:id/generate
    voices.py          # List, sync, clone, delete
    bookmarks.py       # CRUD
    queue.py           # List, cancel, SSE events
    backends.py        # List, select, SSE events
    settings.py        # User key-value settings
    health.py          # GET /health
  pyproject.toml
```

Dependencies: `fastapi`, `uvicorn[standard]`, `aiosqlite`, `pyjwt`, `bcrypt`, `python-multipart`, `httpx`, `sse-starlette`

### Database schema

7 tables in SQLite:

```sql
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE reads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    title TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'text',   -- text | url | file
    source_url TEXT,
    file_name TEXT,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    progress_segment INTEGER NOT NULL DEFAULT 0,
    progress_word INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE audio_segments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    read_id INTEGER NOT NULL REFERENCES reads(id) ON DELETE CASCADE,
    segment_index INTEGER NOT NULL,
    text TEXT NOT NULL,
    audio_generated INTEGER NOT NULL DEFAULT 0,
    word_timings_json TEXT,
    generated_at TEXT
);

CREATE TABLE voices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'builtin',  -- builtin | cloned
    wav_path TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, name)
);

CREATE TABLE bookmarks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    read_id INTEGER NOT NULL REFERENCES reads(id) ON DELETE CASCADE,
    segment_index INTEGER NOT NULL,
    word_offset INTEGER NOT NULL DEFAULT 0,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    read_id INTEGER NOT NULL REFERENCES reads(id) ON DELETE CASCADE,
    voice TEXT NOT NULL,
    engine TEXT NOT NULL,
    language TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    progress INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    started_at TEXT,
    completed_at TEXT
);

CREATE TABLE settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    key TEXT NOT NULL,
    value TEXT,
    UNIQUE(user_id, key)
);
```

### Configuration

`config.py` reads from environment variables with sensible defaults:

```python
from pathlib import Path
import os

DATA_DIR   = Path(os.environ.get("MURMUR_DATA_DIR", "./data"))
DB_PATH    = DATA_DIR / "murmur.db"
AUDIO_DIR  = DATA_DIR / "audio"
VOICES_DIR = DATA_DIR / "voices"
ENGINES_DIR = Path(os.environ.get("MURMUR_ENGINES_DIR", "."))

JWT_SECRET       = os.environ.get("MURMUR_JWT_SECRET", "dev-secret")
JWT_ALGORITHM    = "HS256"
JWT_EXPIRY_HOURS = 72

ENGINE_PORT      = int(os.environ.get("MURMUR_ENGINE_PORT", "8100"))
ALIGN_SERVER_URL = os.environ.get("MURMUR_ALIGN_URL", "http://localhost:8001")
```

### Auth

Dual-layer auth:

1. **Orchestrator issues JWTs** — `POST /auth/register` and `/auth/login` return a token with `sub: user_id`
2. **Nuxt BFF stores the JWT in an httpOnly cookie** — the browser never sees the raw token
3. **Nuxt BFF reads the cookie, verifies it, and injects `X-User-Id` header** on every proxied request
4. **Orchestrator reads `X-User-Id` header** — it trusts Nuxt (internal network)

`auth.py`:

```python
import bcrypt
import jwt
from datetime import datetime, timedelta, timezone
from . import config

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()

def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())

def create_token(user_id: int) -> str:
    payload = {
        "sub": str(user_id),
        "exp": datetime.now(timezone.utc) + timedelta(hours=config.JWT_EXPIRY_HOURS),
    }
    return jwt.encode(payload, config.JWT_SECRET, algorithm=config.JWT_ALGORITHM)

def decode_token(token: str) -> int:
    payload = jwt.decode(token, config.JWT_SECRET, algorithms=[config.JWT_ALGORITHM])
    return int(payload["sub"])
```

### Sentence splitter

When a read is created, its content is split into individual sentences. Each sentence becomes an `audio_segment` row. This enables per-sentence TTS generation, playback, and word-level highlighting.

The splitter handles abbreviations (Mr., Dr., U.S., etc.) so they don't create false sentence breaks.

### Engine manager

Manages exactly one TTS engine subprocess at a time:

- **`start_engine(name)`**: Looks up the engine in the registry, runs `uv run uvicorn main:app --port 8100` in the engine's directory, polls `/health` until the model loads (up to 120s)
- **`stop_engine()`**: Sends SIGTERM, waits 10s, then SIGKILL if needed
- **`select_engine(name)`**: Stops current engine (if any) and starts the new one
- **Health loop**: Every 10s, pings `/health`. After 3 consecutive failures, marks the engine as `unavailable`
- **SSE events**: Publishes `backend:status` events so the frontend can update engine status in real time

### Job queue

Background FIFO processor for TTS generation:

1. User clicks "Generate Audio" → `POST /reads/:id/generate` creates a `job` row with status `pending`
2. The job worker (running as an asyncio task) picks the oldest pending job
3. For each ungenerated segment in the read:
   - Calls the active engine's `/tts/generate` endpoint with the segment text and selected voice
   - Saves the returned WAV to `data/audio/{read_id}/{segment_index}.wav`
   - Optionally calls the alignment server's `/align` endpoint with the WAV + text to get word timestamps
   - Updates the `audio_segments` row with `audio_generated = 1` and `word_timings_json`
   - Emits a `job:progress` SSE event
4. When all segments are done, marks the job as `done` and emits `job:completed`

Job states: `pending` -> `running` -> `done` | `failed` | `cancelled`

Special state: `waiting_for_backend` — if the engine goes down mid-job, the job pauses and auto-resumes when the engine comes back.

### SSE event system

Two SSE endpoints, both user-scoped:

- **`GET /queue/events`** — Job progress: `job:queued`, `job:started`, `job:progress`, `job:completed`, `job:failed`, `job:cancelled`
- **`GET /backends/events`** — Engine status: `backend:status`

The event bus uses asyncio queues — each SSE connection subscribes, gets a queue, and receives events as they're emitted.

### REST API

| Route | Method | Description |
|-------|--------|-------------|
| `/auth/register` | POST | Create account, return JWT |
| `/auth/login` | POST | Authenticate, return JWT |
| `/auth/me` | GET | Current user (via X-User-Id) |
| `/reads` | GET | List user's reads |
| `/reads` | POST | Create read (splits into segments) |
| `/reads/:id` | GET | Read detail with segments |
| `/reads/:id` | PATCH | Update title or progress |
| `/reads/:id` | DELETE | Delete read + audio + bookmarks |
| `/reads/:id/generate` | POST | Start TTS generation job |
| `/reads/:id/bookmarks` | GET | List bookmarks |
| `/reads/:id/bookmarks` | POST | Add bookmark |
| `/bookmarks/:id` | PATCH | Update bookmark note |
| `/bookmarks/:id` | DELETE | Delete bookmark |
| `/voices` | GET | List voices (builtin + cloned) |
| `/voices/sync` | POST | Sync voices from active engine |
| `/voices/clone` | POST | Upload WAV to clone a voice |
| `/voices/:id` | DELETE | Delete cloned voice |
| `/queue` | GET | List user's jobs |
| `/queue/:id` | DELETE | Cancel a job |
| `/queue/events` | GET | SSE stream for job events |
| `/backends` | GET | List engines with statuses |
| `/backends/select` | POST | Switch active engine |
| `/backends/events` | GET | SSE stream for engine events |
| `/audio/:readId/:segIndex` | GET | Serve generated WAV file |
| `/health` | GET | DB status + active engine |

---

## Part 3: Alignment Server

Optional service that produces word-level timestamps for generated audio. This powers the word-by-word highlighting during playback.

```
alignment-server/
  main.py           # FastAPI app with WhisperX
  pyproject.toml    # Deps: fastapi, uvicorn, whisperx, torch
```

Single endpoint:

- **POST /align** — Accepts multipart form (`audio`: WAV file, `text`: string). Returns `{"words": [{"word": "Hello", "start": 0.0, "end": 0.35}, ...]}`.

The model loads on startup (WhisperX forced alignment, English). Requires ~2GB RAM. CUDA optional but recommended.

---

## Part 4: Nuxt Frontend

The frontend is a Nuxt 3 app with SSR enabled. It serves as both the UI and the BFF (Backend for Frontend) that proxies authenticated requests to the orchestrator.

### Project structure

```
app.vue                    # Root: UApp wrapper, background sync init
app.config.ts              # Nuxt UI theme: primary=sky, neutral=zinc
app.css                    # Tailwind CSS imports
nuxt.config.ts             # Modules, SSR, PWA, runtime config
layouts/default.vue        # Sidebar (desktop) + drawer (mobile) + header

pages/
  login.vue                # Login form
  register.vue             # Registration form
  index.vue                # Library grid (search, sort, delete)
  new.vue                  # Create read (text, URL, file import)
  read/[id].vue            # Reader with generation, playback, bookmarks
  queue.vue                # Job queue with progress and cancel
  voices.vue               # Voice sync + clone
  settings.vue             # Engine selector + offline sync settings

components/
  AppHeader.vue            # Hamburger, offline indicator, health, color toggle
  AppSidebar.vue           # Nav links + logout
  LibraryGrid.vue          # Search/sort/grid of LibraryCards
  LibraryCard.vue          # Read card with type badge, progress
  TextInput.vue            # Textarea with char count + read time
  VoiceSelector.vue        # Grouped dropdown (builtin/cloned)
  EngineSelector.vue       # Engine cards with status badges
  ReaderView.client.vue    # Segment list with click-to-play
  AudioPlayer.client.vue   # Fixed bottom bar: play/pause, skip, seek, speed
  WordHighlighter.client.vue  # Word-by-word highlight during playback
  BookmarkAddModal.vue     # Add bookmark at current segment
  BookmarkList.vue         # List/jump/delete bookmarks
  VoiceCloneModal.vue      # WAV upload + mic recording + optional prompt
  OfflineIndicator.vue     # Offline/syncing badge

composables/
  useAuth.ts               # Login, register, logout, user state
  useLibrary.ts            # Reads CRUD
  useVoices.ts             # Voice list, sync, clone, selection
  useBackends.ts           # Engine list, select, install + SSE
  useQueue.ts              # Job list + SSE
  useGeneration.ts         # Per-read generation trigger + SSE progress
  useAudioPlayer.ts        # Playback control (module-level singleton)
  useBookmarks.ts          # Bookmark CRUD (offline-aware)
  useOffline.ts            # Online/offline state, mutation queue processing
  useBackgroundSync.ts     # Proactive cache warming

utils/
  offline-queue.ts         # IndexedDB mutation queue
  document-parser.ts       # PDF, EPUB, DOCX, HTML, Markdown parsing
  url-extractor.ts         # Article extraction via Mozilla Readability
  sentence-splitter.ts     # Client-side sentence splitting
  wav-concat.ts            # WAV blob concatenation for audio export

server/
  middleware/auth.ts        # Verify JWT cookie, set event.context.userId
  utils/jwt.ts             # JWT verification via jose
  utils/orchestrator.ts    # Fetch helper + cookie config
  api/auth/login.post.ts   # Proxy login, set cookie
  api/auth/register.post.ts # Proxy register, set cookie
  api/auth/logout.post.ts  # Clear cookie
  api/auth/me.get.ts       # Proxy /auth/me
  api/[...].ts             # Catch-all BFF proxy

types/api.ts               # TypeScript types for all API responses
```

### Key dependencies

```json
{
  "dependencies": {
    "@mozilla/readability": "^0.6.0",
    "@nuxt/ui": "^3.3.7",
    "jose": "^6.2.2",
    "jszip": "^3.10.1",
    "mammoth": "^1.12.0",
    "nuxt": "^3.21.2",
    "pdfjs-dist": "^5.6.205",
    "vue": "^3.5.30",
    "vue-router": "^4.5.0"
  },
  "devDependencies": {
    "@vite-pwa/nuxt": "^1.1.1",
    "fake-indexeddb": "^6.0.0",
    "jsdom": "^26.1.0",
    "vitest": "^4.1.2"
  }
}
```

### The BFF pattern

The Nuxt server acts as a BFF — the browser never talks to the orchestrator directly.

1. **Auth middleware** (`server/middleware/auth.ts`): Runs on every `/api/*` request. Skips public routes (`/api/auth/login`, `/api/auth/register`, `/api/auth/logout`, `/api/health`). Reads the `murmur_token` cookie, verifies the JWT using `jose`, and sets `event.context.userId`.

2. **Auth routes**: `/api/auth/login` and `/api/auth/register` proxy to the orchestrator, extract the JWT from the response, and set it as an httpOnly cookie. The raw token is never sent to the browser.

3. **Catch-all proxy** (`server/api/[...].ts`): Every other `/api/*` request strips the `/api` prefix and proxies to the orchestrator with an `X-User-Id` header.

```typescript
// server/api/[...].ts
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  const userId = event.context.userId as number
  const targetPath = event.path!.replace(/^\/api/, '')
  const target = `${config.orchestratorUrl}${targetPath}`
  return proxyRequest(event, target, {
    headers: { 'X-User-Id': String(userId) },
  })
})
```

### Composable patterns

All composables follow a consistent pattern:

**Data fetching** — `useFetch` for server-rendered data:
```typescript
export function useLibrary() {
  const { data: reads, status, refresh } = useFetch<ReadSummary[]>('/api/reads', {
    default: () => [],
  })
  // mutations use $fetch + refresh()
}
```

**SSE connections** — EventSource for real-time updates:
```typescript
export function useQueue() {
  let eventSource: EventSource | null = null
  function connectSSE() {
    eventSource = new EventSource('/api/queue/events')
    eventSource.addEventListener('job:completed', () => refresh())
  }
  onMounted(connectSSE)
  onUnmounted(() => eventSource?.close())
}
```

**Module-level singletons** — For app-wide state like audio playback:
```typescript
// Module-level refs persist across component mounts
const isPlaying = ref(false)
const currentSegmentIndex = ref(0)
let audio: HTMLAudioElement | null = null

export function useAudioPlayer() {
  // Returns refs and methods, no per-instance state
}
```

### Document import

The `/new` page supports 6 input types:

| Source | Library | How it works |
|--------|---------|-------------|
| Plain text | — | Direct input |
| URL | @mozilla/readability | Fetches via CORS proxy, extracts article |
| PDF | pdfjs-dist | Extracts text from all pages |
| EPUB | jszip | Parses OPF manifest, follows spine reading order |
| DOCX | mammoth | Converts to HTML, strips tags |
| TXT/MD/HTML | — | Raw text extraction |

---

## Part 5: Docker Compose

Three services, one exposed port.

### Nuxt Dockerfile

Multi-stage build: install deps, build Nuxt, copy `.output` to a slim runtime image.

```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=build /app/.output .output
ENV HOST=0.0.0.0 PORT=3000
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
```

### Orchestrator Dockerfile

Installs the orchestrator and the default TTS engine (pocket-tts) with CPU-only PyTorch:

```dockerfile
FROM python:3.12-slim
# Install uv, set up orchestrator venv, install pocket-tts with CPU torch
# Copy orchestrator + pocket-tts-server source
ENV MURMUR_DATA_DIR=/app/data
CMD ["orchestrator/.venv/bin/uvicorn", "orchestrator.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

### Alignment server Dockerfile

CPU-only WhisperX with model cache volume:

```dockerfile
FROM python:3.12-slim
# Install uv, sync alignment-server deps with CPU torch
ENV HF_HOME=/app/cache
CMD ["alignment-server/.venv/bin/uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001", "--app-dir", "alignment-server"]
```

### docker-compose.yml

```yaml
services:
  app:
    build: .
    ports:
      - "${MURMUR_PORT:-80}:3000"
    environment:
      - NUXT_ORCHESTRATOR_URL=http://orchestrator:8000
      - NUXT_JWT_SECRET=${MURMUR_JWT_SECRET:-dev-secret-change-in-production}
    depends_on:
      orchestrator:
        condition: service_started

  orchestrator:
    build:
      context: .
      dockerfile: orchestrator/Dockerfile
    volumes:
      - murmur-data:/app/data
    environment:
      - MURMUR_JWT_SECRET=${MURMUR_JWT_SECRET:-dev-secret-change-in-production}
      - MURMUR_ALIGN_URL=http://align:8001
      - MURMUR_DATA_DIR=/app/data
    depends_on:
      align:
        condition: service_started
        required: false

  align:
    build:
      context: .
      dockerfile: alignment-server/Dockerfile
    profiles:
      - full
    volumes:
      - murmur-align-cache:/app/cache

volumes:
  murmur-data:
  murmur-align-cache:
```

The alignment server is behind the `full` profile — it's optional and requires significant resources. Run `docker compose --profile full up` to include it.

### Environment variables

```bash
# .env
MURMUR_JWT_SECRET=change-me-to-a-random-string  # Required for production
MURMUR_PORT=3080                                  # Optional (default: 80)
```

---

## Part 6: PWA Offline Support

Murmur works offline after the first visit. The service worker caches everything needed for reading — app shell, API data, and audio files.

### How it works

Three layers of offline support:

**1. Workbox runtime caching** (transparent, in the service worker):

| What | Strategy | Why |
|------|----------|-----|
| Audio files (`/api/audio/*`) | CacheFirst | Audio is immutable once generated |
| Reads list, read details, bookmarks | NetworkFirst (3s timeout) | Prefer fresh data, fall back to cache |
| Voices list | StaleWhileRevalidate | Rarely changes, show instantly |
| Static assets (JS, CSS, icons) | Precache | App shell always available |

**2. Background sync** (proactive cache warming):

The `useBackgroundSync` composable fetches all reads, bookmarks, and audio segments in the background to populate the service worker cache. Runs on app start and every 15 minutes. Can be disabled in Settings.

**3. Offline mutation queue** (IndexedDB):

When offline, mutations (progress updates, bookmark adds/edits/deletes) are stored in an IndexedDB queue. When the browser goes back online:
- The queue is replayed in timestamp order
- Progress updates are deduplicated (only the latest per read is sent)
- Failed mutations (404, 409) are skipped
- Other errors pause the queue for retry

### Key files

- `composables/useOffline.ts` — Reactive `isOnline` state, `processQueue()` on reconnect
- `utils/offline-queue.ts` — IndexedDB wrapper: `queueMutation()`, `getAllMutations()`, `removeMutation()`, `clearMutations()`
- `composables/useBackgroundSync.ts` — Periodic `syncAll()` that warms the service worker cache
- `composables/useBookmarks.ts` — Optimistic local updates + mutation queueing when offline
- `pages/read/[id].vue` — Queues progress PATCH when offline
- `components/OfflineIndicator.vue` — Shows "Offline" badge or "Syncing (N)" spinner in header
- `pages/settings.vue` — Auto-sync toggle, storage usage display, clear cache button

---

## Running in Development

For local dev without Docker, you need three terminals:

```bash
# Terminal 1: TTS engine
cd pocket-tts-server && uv run uvicorn main:app --port 8000

# Terminal 2: Orchestrator
cd orchestrator && uv run uvicorn orchestrator.main:app --port 8000
# (Stop the TTS engine first — orchestrator manages it as a subprocess on port 8100)

# Terminal 3: Frontend
npm install && npm run dev   # http://localhost:4000
```

Or with Docker (recommended):

```bash
cp .env.example .env
docker compose up --build    # http://localhost
```

---

## Testing

```bash
# Frontend tests (vitest)
npm test

# Orchestrator tests (pytest)
cd orchestrator && uv run pytest
```

The frontend test suite covers JWT verification, the IndexedDB offline queue, and the useOffline composable. The orchestrator has tests for auth, reads CRUD, bookmarks, voices, settings, engine management, job queue, and the sentence splitter.
