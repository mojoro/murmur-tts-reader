# pocket-tts

Open-source, offline alternative to ElevenReader. Paste text, a URL, or a document — it synthesizes audio using a cloned voice, locally. No API keys required.

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Nuxt 3 + Vue 3 Composition API (PWA) |
| UI | Nuxt UI + Tailwind CSS |
| Storage | SQLite in browser (sql.js WASM + Drizzle ORM + IndexedDB persistence) |
| TTS Backends | FastAPI (Python) — 5 interchangeable engines |
| Alignment | FastAPI (Python) — WhisperX forced-alignment |

## Architecture

```
[TTS backend on Mac]  ←── configurable URL (localStorage)
        │
        ▼ (direct HTTP, same LAN)
[Nuxt PWA in browser]
  ├── sql.js (WASM SQLite) ──→ IndexedDB (persistence)
  ├── Drizzle ORM (typed queries)
  ├── Audio blobs ──→ IndexedDB
  └── Service Worker (offline cache)

[alignment-server on Mac] ←── configurable URL (localStorage)
        ▲
        │ (direct HTTP, same LAN)
[Nuxt PWA in browser]
```

All 5 TTS backends share an identical API surface. Switch between them by changing the TTS Server URL in Settings.

**PWA distribution:** Install via "Add to Home Screen" on iOS/Android — no app store required. Each device gets its own isolated SQLite database persisted in IndexedDB. The browser calls TTS/alignment backends directly over the local network.

## Dev Commands

### Frontend

```bash
npm run dev         # Nuxt dev server on port 3000
```

### TTS Backends (pick one)

```bash
# pocket-tts — 8 built-in voices, ~400MB model download on first run
cd pocket-tts-server && uv run uvicorn main:app --port 8000

# XTTS-v2 — multilingual, clone-only (no built-in voices), CUDA-aware
cd xtts-server && uv run uvicorn main:app --port 8000

# F5-TTS — clone-only, auto-transcribes reference audio
cd f5tts-server && uv run uvicorn main:app --port 8000

# GPT-SoVITS — clone-only, auto-trims reference to 3-10s
cd gptsovits-server && uv run uvicorn main:app --port 8000

# CosyVoice2 — zero-shot (with transcript) or cross-lingual
cd cosyvoice-server && uv run uvicorn main:app --port 8000
```

### Alignment Server

```bash
cd alignment-server && uv run uvicorn main:app --port 8001
```

## Configuration

Server URLs are configured per-device via the Settings page (`/settings`) and persisted in `localStorage`.

| Setting | Default | Description |
|---------|---------|-------------|
| TTS Server URL | `http://localhost:8000` | Active TTS backend URL |
| Alignment Server URL | `http://localhost:8001` | WhisperX alignment server URL |

## TTS Backend API Contract

All 5 backends implement this interface:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | `{status, model_loaded, backend}` |
| `/tts/voices` | GET | `{builtin: [...], custom: [...]}` |
| `/tts/generate` | POST | Body: `{text, voice, language?}` → streams WAV (24 kHz) |
| `/tts/clone-voice` | POST | Form: `name`, `file` (WAV), `prompt_text?` → saves voice |

## Alignment Server API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/align` | POST | Form: `audio` (WAV), `text` (str) → `{words: [{word, start, end}]}` |

## Database Schema

Schema defined in `shared/schema.ts` (Drizzle ORM, used by sql.js in browser).

```
reads           id, title, type, source_url, file_name, content, created_at, updated_at, progress_segment, progress_word
audio_segments  id, read_id, segment_index, text, audio_path (IndexedDB key), word_timings_json, generated_at
voices          id, name, type (builtin|cloned), wav_path, created_at
bookmarks       id, read_id, segment_index, word_offset, note, created_at
```

Audio WAV blobs are stored separately in IndexedDB (via `useAudioStorage`), keyed by `readId:segmentIndex`.

## Key Design Decisions

- **Sentence-by-sentence streaming**: Text is split into sentences, each TTS'd separately. SSE streams progress to the client so playback begins before full generation completes.
- **Word-level highlighting via WhisperX**: After generating each sentence WAV, the alignment server runs forced-alignment to produce word timestamps for reader highlighting.
- **Swappable TTS backends**: All 5 backends share the same API. Switch by changing `TTS_SERVER_URL`.
- **Browser-side SQLite via sql.js**: Library, audio metadata, voice profiles, and bookmarks live in a SQLite database running in the browser (sql.js WASM), persisted to IndexedDB. Audio blobs stored separately in IndexedDB. No server-side database.
- **PWA for distribution**: Installable on iOS/Android via "Add to Home Screen". Service Worker caches the app shell for offline use. Each device has its own isolated database.
- **URL ingestion**: Web articles extracted via Readability; YouTube/podcast transcripts via dedicated extractors.

## Feature Roadmap

- [x] Text input → TTS → play/download
- [x] Voice cloning (WAV upload + browser mic recording)
- [x] 5 local TTS backends (pocket-tts, XTTS, F5, GPT-SoVITS, CosyVoice)
- [x] Nuxt 3 + Nuxt UI frontend (PWA)
- [x] SQLite persistence (sql.js + Drizzle ORM + IndexedDB)
- [ ] URL ingestion (web articles + YouTube transcripts)
- [ ] Document import (PDF, EPUB, DOCX, TXT)
- [ ] Audio library with playback history
- [ ] Sentence-by-sentence streaming TTS
- [ ] Word-level highlighting (WhisperX alignment)
- [ ] Bookmarks with notes
- [ ] Playback speed control
- [ ] Voice profile management
- [ ] Audio export
