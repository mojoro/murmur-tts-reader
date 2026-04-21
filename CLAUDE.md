# Murmur

Open-source, self-hosted alternative to ElevenReader. Paste text, select a voice, and it synthesizes audio using local TTS — no API keys, no cloud. Voice cloning supported.

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Nuxt 3 + Vue 3 Composition API (SSR + PWA) |
| UI | Nuxt UI 3 + Tailwind CSS 4 (dark mode default, primary=emerald, neutral=zinc) |
| Server | Nitro (Nuxt server routes) — BFF that proxies to orchestrator |
| Auth | JWT in httpOnly cookie, verified server-side (jose) |
| Orchestrator | FastAPI (Python) — owns SQLite DB, manages TTS engines, job queue |
| TTS Engines | 5 interchangeable backends (Pocket TTS, XTTS v2, F5 TTS, GPT-SoVITS, CosyVoice 2) |
| Alignment | FastAPI (Python) — WhisperX forced-alignment on port 8001 |
| Offline | Workbox service worker + IndexedDB mutation queue |

## Architecture

```
[TTS Engines]  ←── managed by orchestrator (subprocess lifecycle)
      │
      ▼
[Orchestrator :8000]  ←── SQLite DB + audio files on disk
      │                    job queue, engine management, auth
      ▼
[Nitro BFF]  ←── JWT validation, X-User-Id header injection
      │          catch-all proxy: /api/* → orchestrator
      ▼
[Nuxt SSR + PWA in browser]
  ├── Auth (login/register, httpOnly cookie)
  ├── useFetch/useAsyncData against /api/* routes
  ├── Workbox caching (audio=CacheFirst, reads=NetworkFirst)
  └── IndexedDB offline mutation queue
      │
      ▼ (optional, for word-level alignment)
[Alignment server :8001]  ←── called by orchestrator, not frontend
```

The frontend calls `/api/*` routes on the Nitro server, which validates the JWT cookie and proxies requests to the orchestrator with an `X-User-Id` header. The orchestrator owns all data (SQLite + audio WAVs on disk) and manages TTS engine processes.

## Dev Commands

Frontend commands are run from `frontend/`:

```bash
cd frontend
npm run dev        # Nuxt dev server on port 4000
npm run build      # Production build → .output/
npm run test       # vitest run
npm run test:watch # vitest watch mode
```

### Orchestrator (required)

Run from the repo root — `orchestrator/main.py` uses package imports (`import orchestrator.config`), so the `orchestrator` package must be importable from CWD:

```bash
uv --project orchestrator run uvicorn orchestrator.main:app --port 8000
```

### Alignment server (optional, enables word-level highlighting)

```bash
cd alignment-server
uv run uvicorn main:app --port 8001
```

### Docker (production — with HTTPS for PWA)

```bash
cp .env.example .env  # Set MURMUR_JWT_SECRET and MURMUR_HOST (your LAN IP)
docker compose up      # Caddy(:443) + app + orchestrator(:8000)
docker compose --profile full up  # includes alignment server
```

First-time phone setup: visit `http://<LAN_IP>` to download the CA certificate and follow the on-screen instructions, then open `https://<LAN_IP>` to install the PWA.

### Docker (dev — hot reload, no HTTPS)

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up  # app(:4000)
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `MURMUR_JWT_SECRET` | Yes (prod) | JWT signing secret. Default: `dev-secret-change-in-production` |
| `MURMUR_HOST` | Yes | Server LAN IP (e.g. `192.168.1.100`). Used for HTTPS cert generation |
| `MURMUR_PORT` | No | HTTPS port (default: `443`) |
| `MURMUR_HTTP_PORT` | No | HTTP port for setup page (default: `80`) |
| `HF_TOKEN` | No | Hugging Face token (needed for some voice cloning models) |
| `NUXT_ORCHESTRATOR_URL` | No | Orchestrator URL (default: `http://localhost:8000`) |

## Project Structure

```
frontend/                  # Nuxt app (all frontend code lives here)
  pages/
  components/
  composables/
  layouts/
  middleware/
  public/
  server/
  tests/
  types/
  utils/
  app.vue
  app.config.ts
  app.css
  error.vue
  nuxt.config.ts
  package.json
  Dockerfile             # Nuxt production image

tts-servers/               # 5 interchangeable TTS engine FastAPI servers
  pocket-tts-server/       # default, CPU-friendly, built-in voices
  xtts-server/             # multilingual clone
  f5tts-server/            # clone-only, auto-transcribes reference
  gptsovits-server/        # clone-only, auto-trims reference
  cosyvoice-server/        # zero-shot / cross-lingual

orchestrator/              # FastAPI BFF for engines + SQLite + job queue
alignment-server/          # FastAPI WhisperX forced-alignment (port 8001)
caddy/                     # Caddy setup page (served during first-time LAN setup)
docs/                      # design notes, specs, session notes
Caddyfile                  # Caddy config for production HTTPS
docker-compose.yml         # caddy + app (frontend) + orchestrator + align
docker-compose.dev.yml     # dev overrides: nuxi dev with hot reload

# Frontend details (all paths below are under frontend/)

pages/
  index.vue              # / — Library grid (search, sort, delete)
  new.vue                # /new — Create read (title, text, voice, URL/file import)
  read/[id].vue          # /read/:id — Reader with TTS generation, playback, bookmarks
  voices.vue             # /voices — Sync built-in, clone custom voices
  settings.vue           # /settings — Engine selection, offline sync, storage usage
  login.vue              # /login — Email/password login
  register.vue           # /register — New account creation
  queue.vue              # /queue — Job queue monitoring with progress

components/
  AppHeader.vue          # Top bar: hamburger, health indicator, color mode toggle
  AppSidebar.vue         # Vertical nav menu + logout button
  LibraryGrid.vue        # Search/sort/grid of LibraryCards + delete modal
  LibraryCard.vue        # Read card with type badge, preview, progress, timestamp
  TextInput.vue          # Textarea with char count + read time estimate
  VoiceSelector.vue      # Grouped dropdown (builtin/cloned) — used on /new and /read/:id
  VoiceCloneModal.vue    # WAV upload + drag-drop + optional prompt text
  EngineSelector.vue     # TTS engine install/switch UI with status indicators
  OfflineIndicator.vue   # Offline status + pending sync queue count
  ReaderView.client.vue  # Segment display with click-to-play and active highlighting
  AudioPlayer.client.vue # Fixed bottom bar: play/pause, skip, seek, speed control
  WordHighlighter.client.vue  # Word-by-word highlighting during playback
  BookmarkAddModal.vue   # Add bookmark at current segment with note
  BookmarkList.vue       # List/jump/delete bookmarks

composables/
  useAuth.ts             # Login/register/logout, fetchUser, loggedIn state
  useLibrary.ts          # Read CRUD via /api/reads
  useGeneration.ts       # Job-based audio generation with SSE progress
  useVoices.ts           # Voice list sync + clone via /api/voices
  useAudioPlayer.ts      # Playback control: play/pause/seek/skip/speed, currentTime tracking
  useBookmarks.ts        # Bookmark CRUD via /api/reads/:id/bookmarks (offline-aware)
  useBackends.ts         # Engine status polling + SSE for backend:status events
  useQueue.ts            # Job listing + SSE events via /api/queue
  useOffline.ts          # Online/offline state + mutation replay on reconnect
  useBackgroundSync.ts   # Periodic offline cache warming (15-min batched audio fetch)

utils/
  document-parser.ts     # PDF (pdf.js), EPUB (jszip), DOCX (mammoth), TXT/Markdown/HTML parsing
  url-extractor.ts       # URL fetching via CORS proxy + @mozilla/readability
  sentence-splitter.ts   # Smart splitting (handles abbreviations, initials, decimals)
  wav-concat.ts          # WAV blob concatenation for audio export
  offline-queue.ts       # IndexedDB mutation persistence for offline operations

types/api.ts             # All API types: User, ReadSummary, ReadDetail, AudioSegment,
                         # Voice, Bookmark, Job, Backend, HealthResponse, WordTiming, etc.

middleware/
  auth.global.ts         # Client-side route guard — redirects to /login if unauthenticated

server/
  middleware/auth.ts     # Validates JWT cookie on /api/* routes, sets event.context.userId
  api/auth/              # login.post, register.post, logout.post, me.get
  api/extract-url.post.ts # Server-side URL fetching (avoids CORS issues)
  api/[...].ts           # Catch-all proxy: strips /api, forwards to orchestrator with X-User-Id
  utils/jwt.ts           # JWT verification (jose)
  utils/orchestrator.ts  # orchestratorFetch() helper + cookie config

layouts/default.vue      # Desktop sidebar + mobile USlideover drawer + header
app.vue                  # Root: UApp > NuxtLayout > NuxtPage
app.config.ts            # Nuxt UI theme: primary=emerald, neutral=zinc
app.css                  # @import "tailwindcss" + @import "@nuxt/ui"
```

## Auth Flow

1. User registers/logs in via `/api/auth/*` — Nitro proxies to orchestrator
2. Orchestrator returns JWT, Nitro sets it as httpOnly cookie (`murmur_token`, 72h expiry)
3. All subsequent `/api/*` requests: Nitro middleware validates JWT, injects `X-User-Id` header
4. Client-side `auth.global.ts` middleware redirects unauthenticated users to `/login`
5. Public routes: `/login`, `/register`, `/api/health`, `/api/auth/*`

## Orchestrator API (proxied through `/api/*`)

The Nuxt BFF proxies all `/api/*` requests to the orchestrator. Frontend code calls these via `useFetch('/api/...')`.

| Frontend route | Orchestrator route | Description |
|----------------|--------------------|-------------|
| `GET /api/health` | `GET /health` | DB status, active engine, alignment status |
| `GET /api/reads` | `GET /reads` | List user's reads |
| `POST /api/reads` | `POST /reads` | Create read (sentence splitting done server-side) |
| `GET /api/reads/:id` | `GET /reads/:id` | Read detail with segments |
| `PATCH /api/reads/:id` | `PATCH /reads/:id` | Update progress, title |
| `DELETE /api/reads/:id` | `DELETE /reads/:id` | Delete read + audio files |
| `GET /api/audio/:readId/:segIdx` | `GET /audio/:readId/:segIdx` | Stream audio WAV |
| `POST /api/reads/:id/generate` | `POST /reads/:id/generate` | Start TTS job (or regenerate) → returns Job |
| `GET /api/audio/:readId/bundle?start=&end=` | `GET /audio/:readId/bundle?...` | Bundled audio download (up to 30 segments) |
| `GET /api/reads/:id/bookmarks` | `GET /reads/:id/bookmarks` | List bookmarks |
| `POST /api/reads/:id/bookmarks` | `POST /reads/:id/bookmarks` | Create bookmark |
| `DELETE /api/reads/:id/bookmarks/:bid` | ... | Delete bookmark |
| `GET /api/voices` | `GET /voices` | List voices (builtin + cloned) |
| `POST /api/voices/clone` | `POST /voices/clone` | Clone voice (FormData: name, file) |
| `GET /api/backends` | `GET /backends` | List available TTS engines |
| `POST /api/backends/:name/select` | ... | Set active engine |
| `GET /api/backends/events` | ... | SSE: engine status changes |
| `GET /api/queue` | `GET /queue` | List user's jobs |
| `DELETE /api/queue/:id` | `DELETE /queue/:id` | Cancel job |
| `GET /api/queue/events` | `GET /queue/events` | SSE: job progress |

## Key Design Decisions

- **SSR enabled**: Login/register pages are server-rendered. All data-fetching pages use `useFetch`/`useAsyncData` with SSR support.
- **BFF proxy pattern**: Frontend never talks to orchestrator directly. Nitro validates auth and injects user identity, keeping the orchestrator's internal API simple.
- **Job-based generation**: TTS generation is async — `POST /reads/:id/generate` creates a job, progress streams via SSE. The orchestrator processes jobs FIFO, one at a time.
- **Engine management**: The orchestrator manages TTS engine processes (install, start, stop). Users switch engines via the UI; only one engine runs at a time.
- **Sentence-by-sentence TTS**: Text is split into segments server-side. Each segment is TTS'd independently, enabling progressive playback and per-sentence alignment.
- **Word-level highlighting**: After generating each segment's WAV, the orchestrator calls the alignment server (WhisperX) for word timestamps used by `WordHighlighter`.
- **PWA + offline**: Workbox caches app shell + API responses. Audio uses CacheFirst (immutable once generated). An IndexedDB mutation queue replays failed writes on reconnect.
- **Per-user isolation**: All data is scoped by `X-User-Id`. Each user sees only their reads, voices, bookmarks, and jobs.

## Testing

```bash
npm run test       # Run all tests
npm run test:watch # Watch mode
```

Tests live in `tests/` and use vitest + jsdom. Current coverage:
- `tests/server/jwt.test.ts` — JWT token verification
- `tests/composables/useOffline.test.ts` — Offline state management
- `tests/utils/offline-queue.test.ts` — IndexedDB mutation queue

## What's Implemented

- User authentication (register, login, logout, JWT sessions)
- Text input → sentence splitting → job-based TTS generation → playback
- URL ingestion (web articles via @mozilla/readability + CORS proxy)
- Document import (PDF via pdf.js, EPUB via jszip, DOCX via mammoth, TXT)
- Voice management (sync built-in from backend, clone via WAV upload or mic recording)
- TTS engine management (install, switch, status monitoring via SSE)
- Job queue with progress tracking and cancellation
- Audio player with skip, seek, speed control (0.5x-2.0x)
- Word-by-word highlighting during playback (WhisperX alignment)
- Playback position saved per read, restored on reopen, progress shown on library cards
- Bookmarks with notes at segment level
- Audio export (concatenates segment WAVs into single download)
- Library with search, sort, delete
- Inline images extracted from PDF, EPUB, DOCX, and web articles — displayed in reader
- Thumbnails extracted from documents and shown on library cards
- Regenerate audio for existing reads (different voice/engine or after enabling alignment)
- PWA with offline support (Workbox caching + IndexedDB mutation queue + background sync)
- Background sync: cache-aware batched audio downloads + SSR page pre-fetching
- Docker Compose deployment (Caddy HTTPS + app + orchestrator + optional alignment server)
- Docker dev mode with hot reload (docker-compose.dev.yml)
- Dark mode (default) with toggle
- Responsive layout (desktop sidebar, mobile drawer)
