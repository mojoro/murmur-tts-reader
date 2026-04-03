# Murmur — Server-Backed Architecture Design Spec

**Date:** 2026-04-03
**Status:** Approved
**Summary:** Migrate Murmur (formerly pocket-tts-ui) from a client-side PWA to a server-backed architecture with a Python orchestrator, Nuxt full-stack frontend, background job queue, multi-user auth, on-demand TTS engine management, and offline-capable PWA sync.

---

## 1. Motivation

The current architecture is a pure client-side PWA: SQLite in the browser (sql.js), audio in IndexedDB, TTS generation driven by the browser. This breaks in several ways:

- **Browser closes mid-generation** — audio is lost
- **No job queuing** — user must keep the browser open for each read
- **No multi-device** — phone and laptop have separate isolated databases
- **Data fragility** — browser can clear IndexedDB at any time
- **No multi-user** — single implicit user

The fix: a Python FastAPI orchestrator owns all data and runs generation in the background. Nuxt becomes a full-stack BFF (Backend for Frontend) that handles auth, SSR, and proxies to the orchestrator. Everything runs in Docker — the user runs `docker compose up` and opens a URL.

---

## 2. System Architecture

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
|  Volume: murmur-data (SQLite DB + audio + engines)     |
+-----------------------------------------------------------+
```

### Service responsibilities

**Nuxt (the only service exposed to the browser):**
- Serves the UI with hybrid rendering (SSR for login/register, SPA for the app)
- Server middleware validates JWT cookies, extracts user identity
- Server routes act as BFF: proxy and aggregate calls to the orchestrator
- SSE proxy: relays orchestrator events filtered to current user
- PWA service worker for offline sync

**Orchestrator (Python FastAPI, internal only):**
- Owns all persistent data (SQLite database + audio files on disk)
- Manages TTS engine lifecycle (install, start, stop, health check)
- Runs background job queue for TTS generation + alignment
- Issues JWTs for auth (bcrypt password hashing)
- Exposes REST API + SSE event streams
- Trusts requests from Nuxt (internal network, user_id passed in header)

**Alignment Server (WhisperX, internal, always running):**
- Takes WAV audio + text, returns word-level timestamps
- Enables word-by-word highlighting during playback
- Called by orchestrator after each segment is generated

**TTS Engine (one at a time, managed as subprocess by orchestrator):**
- pocket-tts installed by default on first run (~400MB)
- Other 4 engines available for on-demand download from the UI
- Only one engine runs at a time to conserve memory
- Orchestrator starts/stops the subprocess, health-checks it

---

## 3. Data Model

### Storage layout

```
./data/
  murmur.db              # SQLite database
  audio/
    {readId}/
      {segmentIndex}.wav     # Generated audio files
  engines/
    pocket-tts-server/       # Installed TTS engine code + venv
    xtts-server/             # (only if user installed it)
    ...
  voices/
    cloned/
      {userId}/
        {voiceName}.wav      # User's cloned voice reference audio
```

### Database schema

```sql
-- New tables
users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name  TEXT,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
)

jobs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  read_id       INTEGER NOT NULL REFERENCES reads(id) ON DELETE CASCADE,
  voice         TEXT NOT NULL,
  engine        TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',
    -- pending | running | waiting_for_backend | done | failed | cancelled
  progress      INTEGER NOT NULL DEFAULT 0,
  total         INTEGER NOT NULL DEFAULT 0,
  error         TEXT,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at    TIMESTAMP,
  completed_at  TIMESTAMP
)

settings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  key           TEXT NOT NULL,
  value         TEXT NOT NULL,
  UNIQUE(user_id, key)
)

-- Modified tables (from current schema)
reads (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           INTEGER NOT NULL REFERENCES users(id),  -- NEW
  title             TEXT NOT NULL,
  type              TEXT NOT NULL,  -- 'text' | 'url' | 'file'
  source_url        TEXT,
  file_name         TEXT,
  content           TEXT NOT NULL,
  created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  progress_segment  INTEGER DEFAULT 0,
  progress_word     INTEGER DEFAULT 0
)

audio_segments (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  read_id           INTEGER NOT NULL REFERENCES reads(id) ON DELETE CASCADE,
  segment_index     INTEGER NOT NULL,
  text              TEXT NOT NULL,
  audio_generated   BOOLEAN NOT NULL DEFAULT FALSE,  -- replaces audio_path
  word_timings_json TEXT,
  generated_at      TIMESTAMP
)

voices (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER REFERENCES users(id),  -- NULL = shared/built-in, non-NULL = user's clone
  name        TEXT NOT NULL,
  type        TEXT NOT NULL,  -- 'builtin' | 'cloned'
  wav_path    TEXT,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, name)
)

bookmarks (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  read_id         INTEGER NOT NULL REFERENCES reads(id) ON DELETE CASCADE,
  segment_index   INTEGER NOT NULL,
  word_offset     INTEGER NOT NULL,
  note            TEXT,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
)
```

---

## 4. TTS Engine Management

### On-demand installation

Only pocket-tts is installed on first run (~400MB). The other 4 engines are available for download from the UI.

**Engine registry** (hardcoded in orchestrator config):

| Engine | Size | Built-in voices | GPU | Notes |
|--------|------|-----------------|-----|-------|
| pocket-tts | ~400MB | 8 voices | No | Default, installed on first run |
| xtts-v2 | ~1.1GB | None (clone-only) | Optional | Multilingual |
| f5-tts | ~7.5GB | None (clone-only) | Optional | Auto-transcribes reference |
| gpt-sovits | ~5.3GB | None (clone-only) | Optional | Auto-trims reference 3-10s |
| cosyvoice2 | ~5.8GB | None (clone-only) | Optional | Zero-shot or cross-lingual |

### Engine lifecycle

```
available ──[user clicks Download]──> downloading ──> installed
                                                        |
                                          [user selects] |
                                                        v
stopped <──[user switches away]──── running
                                        |
                              [engine crashes] |
                                        v
                                  unavailable ──[auto-restart]──> running
```

### Subprocess management

- Orchestrator starts the active engine as a child process (`uvicorn main:app --port {port}`)
- Health-checks via `GET /health` every 10 seconds
- If active engine goes down mid-job: job status becomes `waiting_for_backend`, auto-retries when healthy
- Switching engines: stop current subprocess, start new one, wait for healthy, report success
- Only one engine process runs at a time

### UI states

| State | Dropdown treatment |
|-------|-------------------|
| `running` | Selected, green dot, engine name shown |
| `installed` | Selectable, click to switch (full-screen spinner during switch) |
| `downloading` | Grayed out, progress bar with percentage |
| `available` | Grayed out, shows download size, link to product page, "Download" button |
| `unavailable` | Red dot, "Restarting..." (auto-recovers) |

---

## 5. Job Queue & Background Generation

### Flow

```
User clicks "Generate Audio" on a read
  |
  v
Nuxt BFF: POST /server/api/reads/:id/generate {voice}
  |
  v
Orchestrator: creates job row (status: pending), returns job ID
  |
  v
Background worker picks up job (FIFO, one at a time):
  For each ungenerated segment:
    1. POST to active TTS engine /tts/generate {text, voice}  -> WAV blob
    2. Save WAV to disk at ./data/audio/{readId}/{segmentIndex}.wav
    3. POST to alignment server /align {audio, text}  -> word timings
    4. UPDATE audio_segments: audio_generated=true, word_timings_json=...
    5. UPDATE job: progress++
    6. Emit SSE event: job:progress

  On completion: job status -> done, emit job:completed
  On error: job status -> failed, emit job:failed
  On cancel: job status -> cancelled, stop at current segment
  On backend down: job status -> waiting_for_backend, auto-resume when healthy
```

### Queue behavior

- Jobs process sequentially (TTS backends are single-threaded / single-GPU)
- Multiple reads can be queued — FIFO order
- Jobs persist in SQLite — survive orchestrator restarts
- On restart: any `running` jobs reset to `pending` and re-enter queue
- Jobs are user-scoped: each user only sees and manages their own

### SSE event types

```
event: job:queued       data: {jobId, readId, position, total}
event: job:started      data: {jobId, readId}
event: job:progress     data: {jobId, readId, segment, total}
event: job:completed    data: {jobId, readId}
event: job:failed       data: {jobId, readId, error}
event: job:cancelled    data: {jobId, readId}
event: backend:status   data: {name, status, progress?}
```

---

## 6. Auth & Multi-User

### Model

- Open registration: anyone on the local network can create an account
- Email + password, hashed with bcrypt, stored in SQLite
- Login returns a JWT token in an httpOnly cookie
- Nuxt server middleware validates the cookie on every `/server/api/*` request
- Nuxt extracts `user_id` from JWT, passes to orchestrator as `X-User-Id` header
- Orchestrator trusts this header (internal network only)

### User isolation

| Entity | Scoped to user? |
|--------|----------------|
| Reads | Yes — user only sees their own |
| Audio segments | Yes (via read) |
| Bookmarks | Yes (via read) |
| Jobs | Yes — user only sees their own queue |
| Settings | Yes — per-user preferences |
| Built-in voices | No — shared, from TTS backend |
| Cloned voices | Yes — user's own clones |
| TTS engine selection | Yes — per-user active engine preference |

### Auth endpoints (Nuxt server routes)

```
POST /server/api/auth/register    -> create user, return JWT cookie
POST /server/api/auth/login       -> verify credentials, return JWT cookie
POST /server/api/auth/logout      -> clear cookie
GET  /server/api/auth/me          -> return current user from JWT
```

### Route protection

```
/login, /register                 -> public (no auth required)
Everything else                   -> Nuxt middleware redirects to /login if no valid JWT
```

---

## 7. Nuxt Frontend Features

### Server middleware (`server/middleware/auth.ts`)
- Validates JWT cookie on every API request
- Attaches user context to Nitro event
- Redirects unauthenticated requests to `/login`

### Server routes as BFF (`server/api/`)
- Proxy + aggregate calls to orchestrator
- Inject `X-User-Id` header from validated JWT
- Aggregate example: `GET /server/api/reads/:id` fetches read + job status + bookmarks in one call
- SSE proxy: `GET /server/api/queue/events` relays orchestrator SSE filtered to current user

### Hybrid rendering
- `/login`, `/register` — SSR (fast first paint, works without JS initially)
- App pages (`/`, `/read/:id`, `/voices`, `/settings`, `/queue`) — SSR + SPA hydration

### Data fetching
- `useFetch` / `useAsyncData` throughout — typed, cached, deduplicated
- `refresh()` after mutations
- Loading and error states handled by composables

### PWA & Offline Sync
- Service worker caches app shell
- Default behavior: auto-sync all reads + audio to device for offline use
- Setting to disable auto-sync (for devices with limited storage)
- Conflict resolution: last-write-wins based on `updated_at` timestamps
- When offline: reads from local cache, queues progress updates
- When back online: syncs pending changes, pulls new data from server

---

## 8. Orchestrator REST API

### Auth
```
POST   /auth/register              {email, password, display_name?} -> {user, token}
POST   /auth/login                 {email, password} -> {user, token}
GET    /auth/me                    -> {user}          (requires X-User-Id)
```

### Reads
```
GET    /reads                      -> [{id, title, type, progress_segment, segment_count, ...}]
POST   /reads                      {title, content, type, source_url?, file_name?} -> {read, segments}
GET    /reads/:id                  -> {read, segments, job?}
PATCH  /reads/:id                  {title?, progress_segment?, progress_word?} -> {read}
DELETE /reads/:id                  -> 204 (cascades to segments, audio files, bookmarks, jobs)
```

### Audio
```
GET    /audio/:readId/:segIndex    -> WAV file (static file serving)
GET    /reads/:id/export           -> ZIP (concatenated WAV + metadata)
```

### Generation
```
POST   /reads/:id/generate         {voice, language?} -> {job}
```

### Queue
```
GET    /queue                      -> [{job}]  (user's jobs only)
DELETE /queue/:jobId               -> 204 (cancel job)
GET    /queue/events               -> SSE stream (user's events only)
```

### Voices
```
GET    /voices                     -> [{voice}]  (built-in shared + user's clones)
POST   /voices/sync                -> [{voice}]  (sync from active TTS backend)
POST   /voices/clone               multipart: name, file, prompt_text? -> {voice}
DELETE /voices/:id                 -> 204 (user's cloned voices only)
```

### Bookmarks
```
GET    /reads/:id/bookmarks        -> [{bookmark}]
POST   /reads/:id/bookmarks        {segment_index, word_offset?, note?} -> {bookmark}
PATCH  /bookmarks/:id              {note} -> {bookmark}
DELETE /bookmarks/:id              -> 204
```

### TTS Backends
```
GET    /backends                   -> [{name, display_name, description, size, status, gpu, url}]
POST   /backends/install           {name} -> 202 (starts background install)
POST   /backends/select            {name} -> {backend}  (switch active engine)
DELETE /backends/:name             -> 204 (uninstall, free disk space)
GET    /backends/events            -> SSE stream (install progress, status changes)
```

### Settings
```
GET    /settings                   -> {key: value, ...}
PATCH  /settings                   {key: value, ...} -> {settings}
```

### Health
```
GET    /health                     -> {status, active_engine, alignment, db}
```

### Library Export/Import
```
GET    /library/export             -> ZIP (full library: all reads, audio, bookmarks, settings)
POST   /library/import             multipart: ZIP file -> {imported_count}
GET    /reads/:id/export           -> ZIP (single read: audio + metadata)
POST   /reads/import               multipart: ZIP file -> {read}
```

### Content Extraction (server-side, no CORS issues)
```
POST   /extract/url                {url} -> {title, content, excerpt?}
POST   /extract/document           multipart: file -> {title, content}
```

---

## 9. Docker Compose

```yaml
services:
  app:
    build: .
    ports: ["80:3000"]
    environment:
      - ORCHESTRATOR_URL=http://orchestrator:8000
    depends_on: [orchestrator]

  orchestrator:
    build: ./orchestrator
    volumes:
      - murmur-data:/app/data
    environment:
      - ALIGN_SERVER_URL=http://align:8001
      - DEFAULT_ENGINE=pocket-tts
    depends_on: [align]

  align:
    build: ./alignment-server

volumes:
  murmur-data:
```

TTS backends are NOT docker services. They are managed by the orchestrator as subprocesses, installed on-demand, stored in the data volume.

### User experience

```bash
# First run:
docker compose up
# -> Downloads orchestrator + Nuxt + alignment images
# -> Orchestrator auto-installs pocket-tts engine (~400MB)
# -> Open http://localhost, register, start using

# Data persists in Docker volume across restarts
# Full library export available from UI for portability
```

---

## 10. Pages & UI Components

### Pages

| Route | Purpose | Auth |
|-------|---------|------|
| `/login` | Login form | Public |
| `/register` | Registration form | Public |
| `/` | Library grid (search, sort, progress bars) | Protected |
| `/new` | Create read (text, URL, file tabs) | Protected |
| `/read/:id` | Reader with playback, bookmarks, generation | Protected |
| `/voices` | Voice management (sync, clone with mic/upload) | Protected |
| `/queue` | Job queue overview (all user's jobs, progress, cancel) | Protected |
| `/settings` | Server URLs, TTS engine selector, offline sync toggle, export/import | Protected |

### New/modified components

| Component | Purpose |
|-----------|---------|
| `QueuePanel.vue` | Job list with status badges, progress bars, cancel buttons |
| `EngineSelector.vue` | Dropdown showing engine states (running/installed/downloading/available) |
| `EngineCard.vue` | Engine details: name, description, size, product link, download/switch buttons |
| `OfflineBadge.vue` | Indicator showing sync status (synced/syncing/offline) |
| `ExportImportButtons.vue` | Library and per-read export/import actions |

---

## 11. Migration Path

This is a rewrite of the data layer, not the UI. The Vue components, pages, and layouts stay largely the same. The migration order:

1. **Build the orchestrator** — Python FastAPI with all endpoints, job queue, engine manager
2. **Refactor Nuxt composables** — replace sql.js/IndexedDB with REST calls via BFF server routes
3. **Add auth** — Nuxt middleware + orchestrator JWT
4. **Add queue UI** — new page + SSE integration
5. **Add engine management UI** — settings page engine selector
6. **Docker compose** — wire everything together
7. **PWA offline sync** — service worker + IndexedDB cache
8. **Export/import** — library and per-read ZIP bundles
9. **Server-side extraction** — move URL/document parsing to orchestrator

### What gets deleted from current codebase
- `composables/useDatabase.ts` — no more client-side SQLite
- `composables/useAudioStorage.ts` — audio served by URL from server
- `utils/align-client.ts` — orchestrator handles alignment
- `shared/schema.ts` — schema moves to orchestrator (Python)
- `types/db.ts` — replaced by API response types
- sql.js dependency, drizzle-orm dependency
- `public/sql-wasm.wasm`

### What stays
- All Vue components (modified to use new composables)
- All pages (modified data sources)
- Layout, styling, Nuxt UI components
- `utils/sentence-splitter.ts` — kept for client-side preview, also ported to Python
- `utils/wav-concat.ts` — kept for client-side export preview, server does the real export
