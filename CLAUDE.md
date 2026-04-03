# pocket-tts

Open-source, offline alternative to ElevenReader. Paste text, select a voice, and it synthesizes audio using local TTS — no API keys, no cloud. Voice cloning supported.

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Nuxt 3 + Vue 3 Composition API (PWA, SSR disabled) |
| UI | Nuxt UI 3 + Tailwind CSS 4 (dark mode default, primary=sky, neutral=zinc) |
| Storage | SQLite in browser (sql.js WASM + Drizzle ORM) persisted to IndexedDB |
| Audio storage | IndexedDB (raw WAV blobs, keyed by `readId:segmentIndex`) |
| TTS Backends | FastAPI (Python) — 5 interchangeable engines, all on port 8000 |
| Alignment | FastAPI (Python) — WhisperX forced-alignment on port 8001 |

## Architecture

```
[TTS backend]  ←── configurable URL (localStorage)
      │
      ▼ (direct HTTP, same LAN)
[Nuxt PWA in browser]
  ├── sql.js (WASM SQLite) ──→ IndexedDB (persistence)
  ├── Drizzle ORM (typed queries)
  ├── Audio blobs ──→ IndexedDB (separate from SQLite)
  └── Service Worker (offline cache)
      │
      ▼ (direct HTTP, same LAN)
[Alignment server]  ←── configurable URL (localStorage)
```

The frontend is a client-only PWA (`ssr: false`). Each device gets its own isolated SQLite + IndexedDB. The browser calls TTS/alignment backends directly over the network.

## Dev Commands

```bash
npm run dev    # Nuxt dev server (configured for port 4000, falls back to 3000)
npm run build  # Production build
```

### TTS Backends (pick one, all use port 8000)

```bash
cd pocket-tts-server && uv run uvicorn main:app --port 8000   # 8 built-in voices, ~400MB model
cd xtts-server && uv run uvicorn main:app --port 8000          # Multilingual, clone-only, CUDA
cd f5tts-server && uv run uvicorn main:app --port 8000         # Clone-only, auto-transcribes ref
cd gptsovits-server && uv run uvicorn main:app --port 8000     # Clone-only, auto-trims ref 3-10s
cd cosyvoice-server && uv run uvicorn main:app --port 8000     # Zero-shot or cross-lingual
```

## Project Structure

```
pages/
  index.vue              # / — Library grid (search, sort, delete)
  new.vue                # /new — Create read (title, text, voice)
  read/[id].vue          # /read/:id — Reader with TTS generation, playback, bookmarks
  voices.vue             # /voices — Sync built-in, clone custom voices
  settings.vue           # /settings — TTS + alignment server URLs

components/
  AppHeader.vue          # Top bar: hamburger, health indicator, color mode toggle
  AppSidebar.vue         # Vertical nav menu (Library, New Read, Voices, Settings)
  LibraryGrid.vue        # Search/sort/grid of LibraryCards + delete modal
  LibraryCard.vue        # Individual read card with type badge, preview, timestamp
  TextInput.vue          # Textarea with char count + read time estimate
  VoiceSelector.vue      # Grouped dropdown (builtin/cloned) — used on /new and /read/:id
  VoiceCloneModal.vue    # WAV upload + drag-drop + optional prompt text
  ReaderView.client.vue  # Segment display with click-to-play and active highlighting
  AudioPlayer.client.vue # Fixed bottom bar: play/pause, skip, seek, speed control
  WordHighlighter.client.vue  # Word-by-word highlighting during playback
  BookmarkAddModal.vue   # Add bookmark at current segment with note
  BookmarkList.vue       # List/jump/delete bookmarks

composables/
  useDatabase.ts         # sql.js init, IDB persistence, singleton getDb()
  useLibrary.ts          # Read CRUD, sentence splitting into segments
  useTTS.ts              # Generation loop: TTS → align → store audio + timings
  useVoices.ts           # Voice list sync from backend, selection state
  useAudioPlayer.ts      # Playback control: play/pause/seek/skip/speed
  useAudioStorage.ts     # IndexedDB ops for audio blobs (save/load/delete)
  useBookmarks.ts        # Bookmark CRUD tied to a read ID
  useSettings.ts         # localStorage for server URLs with defaults

utils/
  tts-client.ts          # HTTP client: fetchHealth, fetchVoices, generateAudio, cloneVoice
  align-client.ts        # HTTP client: alignAudio (WhisperX)
  sentence-splitter.ts   # Smart splitting (handles abbreviations, initials, decimals)
  wav-concat.ts          # WAV blob concatenation for audio export

shared/schema.ts         # Drizzle ORM schema (single source of truth for DB)
types/db.ts              # Drizzle-inferred types (Read, AudioSegment, Voice, Bookmark)
types/tts.ts             # API types (HealthResponse, VoicesResponse, WordTiming, etc.)
layouts/default.vue      # Desktop sidebar + mobile USlideover drawer + header
app.vue                  # Root: wraps everything in UApp > NuxtLayout > NuxtPage
app.config.ts            # Nuxt UI theme: primary=sky, neutral=zinc
app.css                  # @import "tailwindcss" + @import "@nuxt/ui"
```

## Database Schema

Defined in `shared/schema.ts`. Runs in-browser via sql.js WASM.

| Table | Key columns |
|-------|-------------|
| `reads` | id, title, type (text\|url\|file), source_url, file_name, content, created_at, updated_at, progress_segment, progress_word |
| `audioSegments` | id, read_id (FK), segment_index, text, audio_path (IDB key), word_timings_json, generated_at |
| `voices` | id, name (UNIQUE), type (builtin\|cloned), wav_path, created_at |
| `bookmarks` | id, read_id (FK), segment_index, word_offset, note, created_at |

Audio WAV blobs are stored separately in IndexedDB via `useAudioStorage`, keyed by `readId:segmentIndex`. The `audio_path` column in `audioSegments` stores this key.

Drizzle migrations live in `server/db/migrations/` (generated via `npx drizzle-kit`), but are only used for reference — the browser creates tables directly from the schema.

## TTS Backend API Contract

All 5 backends implement this identical interface:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | `{status, model_loaded, backend}` |
| `/tts/voices` | GET | `{builtin: [...], custom: [...]}` |
| `/tts/generate` | POST | `{text, voice, language?}` → streams WAV (24 kHz) |
| `/tts/clone-voice` | POST | Form: `name`, `file` (WAV), `prompt_text?` → saves voice |

## Alignment Server API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/align` | POST | Form: `audio` (WAV), `text` (str) → `{words: [{word, start, end}]}` |

## Configuration

Server URLs are per-device via `/settings`, persisted in `localStorage`:

| Setting | Default |
|---------|---------|
| TTS Server URL | `http://localhost:8000` |
| Alignment Server URL | `http://localhost:8001` |

The header health indicator polls `TTS_SERVER_URL/health` every 30s.

## Key Design Decisions

- **Client-only rendering** (`ssr: false`): sql.js WASM can't run server-side. The app is a pure client PWA.
- **Dual IndexedDB storage**: SQLite (via sql.js) for structured data; raw IndexedDB for audio blobs. This avoids bloating the SQLite DB with binary data.
- **Sentence-by-sentence TTS**: `splitSentences()` breaks text into segments. Each segment is TTS'd independently, enabling progressive playback and per-sentence alignment.
- **Word-level highlighting**: After generating each segment's WAV, the alignment server runs WhisperX forced-alignment to produce word timestamps for the `WordHighlighter` component.
- **Swappable backends**: All 5 TTS backends share the same API surface. Switch by changing the URL in settings.
- **Voice requirement**: Creating a read requires selecting a voice. Voices come from the TTS backend (`/tts/voices`), so a connected backend is needed before creating reads.
- **PWA distribution**: Installable via "Add to Home Screen". Service Worker caches the app shell. Each device has isolated storage.

## What's Implemented

- Text input → sentence splitting → per-segment TTS → playback
- URL ingestion (web articles via @mozilla/readability + CORS proxy)
- Document import (PDF via pdf.js, EPUB via jszip, DOCX via mammoth, TXT)
- Voice management (sync built-in from backend, clone via WAV upload or mic recording)
- Audio player with skip, seek, speed control (0.5x–2.0x)
- Playback position saved per read, restored on reopen, progress shown on library cards
- Word-level highlighting during playback (WhisperX alignment)
- Bookmarks with notes at segment level
- Audio export (concatenates segment WAVs into single download)
- Library with search, sort, delete
- Dark mode (default) with toggle
- Responsive layout (desktop sidebar, mobile drawer)

## Not Yet Implemented

- YouTube transcript extraction (requires server-side, CORS blocks client-side)
- Ability to choose which TTS backend you want to use
- Word-by-word highlighting in playback
