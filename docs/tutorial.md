# Building Murmur

This tutorial walks through building Murmur from scratch. Murmur is a
self-hosted, open-source alternative to ElevenReader: paste text, pick a voice,
and get back synthesized audio generated locally on your own hardware. No API
keys, no cloud round-trips, and support for cloning your own voice.

The goal here is not a reference. The goal is a build. If you are willing to
type out each subsystem in the order below, you will end up with a working
application and a real understanding of how all of the moving parts talk to
each other. Every file, every line of code, every test, and every Docker
gotcha in this tutorial is taken directly from the repo as it exists today.

## Table of Contents

- [Part 0 — The Shape of the System](#part-0--the-shape-of-the-system)
- [Part 1 — The TTS Engine](#part-1--the-tts-engine)
- [Part 2 — The Orchestrator](#part-2--the-orchestrator)
  - [2.1 Config](#21-config)
  - [2.2 Schema and the DB helper](#22-schema-and-the-db-helper)
  - [2.3 Auth](#23-auth)
  - [2.4 Sentence splitting](#24-sentence-splitting)
  - [2.5 Engine registry](#25-engine-registry)
  - [2.6 Engine manager](#26-engine-manager)
  - [2.7 Job event bus](#27-job-event-bus)
  - [2.8 Job worker](#28-job-worker)
  - [2.9 Pydantic models](#29-pydantic-models)
  - [2.10 Routers](#210-routers)
  - [2.11 `main.py` — wiring it together](#211-mainpy--wiring-it-together)
- [Part 3 — The Alignment Server](#part-3--the-alignment-server)
- [Part 4 — The Other Four TTS Engines](#part-4--the-other-four-tts-engines)
- [Part 5 — The Frontend BFF](#part-5--the-frontend-bff)
- [Part 6 — The Frontend App](#part-6--the-frontend-app)
  - [6.1 Auth middleware and composable](#61-auth-middleware-and-composable)
  - [6.2 Composables for data](#62-composables-for-data)
  - [6.3 Document parser](#63-document-parser)
  - [6.4 URL extractor](#64-url-extractor)
  - [6.5 Client sentence splitter](#65-client-sentence-splitter)
  - [6.6 Audio player and WAV concat](#66-audio-player-and-wav-concat)
  - [6.7 Offline queue and background sync](#67-offline-queue-and-background-sync)
  - [6.8 PWA and Workbox](#68-pwa-and-workbox)
- [Part 7 — Caddy and Docker](#part-7--caddy-and-docker)
- [Part 8 — Testing Everything](#part-8--testing-everything)
- [Part 9 — Gotchas and Why](#part-9--gotchas-and-why)
- [Part 10 — Running Everything](#part-10--running-everything)

## Part 0 — The Shape of the System

Before writing a single line of code it is worth seeing where every piece
sits. Murmur has four server processes and a browser app.

```
                                         Browser
                                            |
                                  HTTPS (https://<LAN_IP>)
                                            |
                                          Caddy (:443)
                                            |
                                         reverse proxy
                                            |
                                          Nuxt (SSR + PWA)  :3000
                                            |
                                    Nitro BFF validates JWT
                                    in httpOnly cookie and
                                    injects X-User-Id header
                                            |
                                      Orchestrator (FastAPI) :8000
                                            |
                 ------------------------------------------------------
                |                   |                                  |
           SQLite DB           Audio WAVs on               spawns/manages one
           (users,             disk under                  TTS engine subprocess
            reads,              data/audio/<read>/         on :8100 at a time
            jobs, voices,       <seg>.wav                       |
            bookmarks)                                          |
                                                   Pocket TTS / XTTS / F5-TTS /
                                                   GPT-SoVITS / CosyVoice 2
                                                          (FastAPI each)

                 + optional: Alignment Server (WhisperX, FastAPI) :8001
                   called by the orchestrator per segment to get word-level
                   timings for synchronised highlighting in the reader.
```

A few load-bearing decisions fall out of this:

1. **The frontend never talks to the orchestrator directly.** All browser
   traffic goes to Nitro on `/api/*`. Nitro validates the JWT cookie and
   forwards the request to the orchestrator with an `X-User-Id` header. This
   keeps the orchestrator's API simple (it trusts the header) and puts the
   cookie-handling in the one place that actually renders HTML.

2. **The orchestrator owns the data.** Every read, voice, bookmark, audio
   file, and job lives in the orchestrator. The Nuxt app is stateless; any
   instance can serve any request.

3. **Only one TTS engine runs at a time.** Each engine is a separate Python
   environment with its own PyTorch stack, model weights, and quirks. The
   orchestrator manages engine lifecycle (install, start, stop) and proxies
   generation requests to the currently-active engine on port 8100.

4. **TTS generation is job-based.** Because a single engine is the bottleneck
   and a document can have hundreds of sentences, generation is async. The
   user posts a job, a worker picks it up, and progress streams back via
   Server-Sent Events.

The reorganised repo layout is:

```
frontend/            # Nuxt 3 app (pages, components, composables, server BFF, PWA)
tts-servers/         # The 5 TTS FastAPI servers
  pocket-tts-server/
  xtts-server/
  f5tts-server/
  gptsovits-server/
  cosyvoice-server/
orchestrator/        # FastAPI orchestrator — SQLite, auth, job queue, engine mgmt
alignment-server/    # WhisperX forced alignment
caddy/               # caddy/setup.html (LAN CA trust landing page)
Caddyfile            # Caddy reverse proxy config
docker-compose.yml   # Production Compose (HTTPS + app + orchestrator)
docker-compose.dev.yml
```

We will build these in dependency order: an engine first (so there is
something to call), then the orchestrator (so there is something to call it
from), then the alignment server, then the four other engines, then the
frontend, and finally the Caddy/Docker glue.

## Part 1 — The TTS Engine

The simplest engine, Pocket TTS, is a good place to start. It uses the
`pocket-tts` PyPI package, needs no GPU, and ships with eight built-in voices,
which means you can exercise both the `voice in BUILTIN_VOICES` path and the
cloned-voice path without setting up a GPU.

Every engine is a standalone FastAPI server that implements the same four
endpoints. The orchestrator does not care which engine is running; it just
posts to those endpoints on `http://localhost:8100`.

The contract is:

| Method | Path                | Purpose                                          |
|--------|---------------------|--------------------------------------------------|
| GET    | `/health`           | Returns `{status, model_loaded, backend}`        |
| GET    | `/tts/voices`       | Returns `{builtin: [...], custom: [...]}`        |
| POST   | `/tts/generate`     | JSON `{text, voice, language?}` → WAV bytes      |
| POST   | `/tts/clone-voice`  | multipart `name` + `file` (WAV) → `{voice}`      |

Start with `tts-servers/pocket-tts-server/main.py`. The top of the file is
just FastAPI setup, CORS for local development, and a lifespan hook that
pre-loads the model so the first `/tts/generate` call is not slow:

```python
# tts-servers/pocket-tts-server/main.py
from pocket_tts import TTSModel

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Loading TTS model — first run downloads ~400 MB, please wait...")
    get_model()
    logger.info("TTS model ready.")
    yield

app = FastAPI(title="Pocket TTS Server", lifespan=lifespan)
```

Pocket TTS comes with eight named voices baked into the model, so the engine
hardcodes the list:

```python
BUILTIN_VOICES = ["alba", "marius", "javert", "jean", "fantine",
                  "cosette", "eponine", "azelma"]
```

The voices endpoint returns that list, plus any `.wav` files dropped into
`voices/` by the clone endpoint:

```python
@app.get("/tts/voices")
def list_voices():
    custom = [p.stem for p in VOICES_DIR.glob("*.wav")]
    return {"builtin": BUILTIN_VOICES, "custom": custom}
```

Generation works in two steps: get a "voice state" (the conditioned embedding
for a voice, cached after first use), and then run the model:

```python
def get_voice_state(voice: str):
    if voice in voice_states:
        return voice_states[voice]
    m = get_model()
    if voice in BUILTIN_VOICES:
        state = m.get_state_for_audio_prompt(voice)
    else:
        wav_path = VOICES_DIR / f"{voice}.wav"
        if not wav_path.exists():
            raise HTTPException(404, f"Voice '{voice}' not found")
        state = m.get_state_for_audio_prompt(str(wav_path))
    voice_states[voice] = state
    return state
```

The model returns float32 PCM samples. To serve a playable WAV we normalise
to the `[-1, 1]` range, convert to int16, and write a RIFF/WAVE header with
`scipy.io.wavfile`:

```python
@app.post("/tts/generate")
def generate(req: GenerateRequest):
    m = get_model()
    state = get_voice_state(req.voice)
    audio = m.generate_audio(state, req.text)

    audio_np = np.array(audio, dtype=np.float32)
    peak = np.max(np.abs(audio_np))
    if peak > 0:
        audio_np = audio_np / peak
    audio_int16 = np.int16(audio_np * 32767)

    buf = io.BytesIO()
    wav.write(buf, 24000, audio_int16)
    buf.seek(0)
    return StreamingResponse(buf, media_type="audio/wav", ...)
```

The int16 conversion is load-bearing. If you stream float32 WAVs the browser
will try to interpret the bytes as 16-bit PCM and you will get static and
clipping on every playback. This exact bug was fixed in commit `f404c18`.

Cloning is trivial: take a name, save the uploaded WAV into `voices/`, and
pre-warm the voice state so the first generate call is fast:

```python
@app.post("/tts/clone-voice")
async def clone_voice(name: str = Form(...), file: UploadFile = File(...)):
    if not file.filename or not file.filename.endswith(".wav"):
        raise HTTPException(400, "Upload a WAV file")
    safe_name = "".join(c for c in name if c.isalnum() or c in "-_ ").strip()
    if not safe_name:
        safe_name = uuid.uuid4().hex[:8]
    dest = VOICES_DIR / f"{safe_name}.wav"
    content = await file.read()
    dest.write_bytes(content)
    voice_states.pop(safe_name, None)
    get_voice_state(safe_name)
    return {"voice": safe_name, ...}
```

The `pyproject.toml` is deliberately minimal:

```toml
[project]
name = "pocket-tts-server"
requires-python = ">=3.12"
dependencies = ["fastapi", "pocket-tts>=1.1.1", "python-multipart", "uvicorn"]
```

Finally, there is a `post_install.py` that the orchestrator runs after
installing deps, so that the 400 MB model downloads during installation
instead of during the first user's first generation:

```python
# tts-servers/pocket-tts-server/post_install.py
from pocket_tts import TTSModel
print("Downloading Pocket TTS model...")
TTSModel.load_model()
print("Model download complete.")
```

You can now run the engine on its own:

```bash
cd tts-servers/pocket-tts-server
uv run uvicorn main:app --port 8000
```

It listens on 8000 in standalone mode, but the orchestrator will later run it
on 8100 so ports do not clash. Try `curl http://localhost:8000/tts/voices` to
see the built-ins, and `curl -X POST -H 'Content-Type: application/json' -d
'{"text":"Hello, world.","voice":"alba"}' http://localhost:8000/tts/generate
-o hello.wav` to generate audio directly.

## Part 2 — The Orchestrator

With an engine in place we need something to drive it. The orchestrator owns
the database, manages authentication, spawns/stops engines, and runs a FIFO
job worker that calls into the engines on behalf of users.

The orchestrator sits at `orchestrator/` in the repo. It imports as a Python
package (`import orchestrator.main`), which means you must always run it from
the repo root — `cd orchestrator && uvicorn main:app` will break the imports.
The correct invocation is:

```bash
uv --project orchestrator run uvicorn orchestrator.main:app --port 8000
```

Build it in pieces.

### 2.1 Config

All of the environment-derived knobs live in `orchestrator/config.py`. It is
small on purpose: one file, no side effects at import time, all paths derived
from `MURMUR_DATA_DIR`.

```python
# orchestrator/config.py
from pathlib import Path
import os

DATA_DIR = Path(os.environ.get("MURMUR_DATA_DIR", "./data"))
DB_PATH = DATA_DIR / "murmur.db"
AUDIO_DIR = DATA_DIR / "audio"
THUMBNAILS_DIR = DATA_DIR / "thumbnails"
IMAGES_DIR = DATA_DIR / "images"
VOICES_DIR = DATA_DIR / "voices" / "cloned"


def _resolve_jwt_secret() -> str:
    secret = os.environ.get("MURMUR_JWT_SECRET")
    if secret:
        return secret
    if os.environ.get("MURMUR_ALLOW_DEV_SECRET") == "1":
        return "dev-secret-change-in-production-ONLY-for-local-dev"
    raise RuntimeError("MURMUR_JWT_SECRET is not set. ...")


JWT_SECRET = _resolve_jwt_secret()
JWT_ALGORITHM = "HS256"
JWT_EXPIRY_HOURS = 72

ENGINES_DIR = DATA_DIR / "engines"
ENGINE_PORT = int(os.environ.get("MURMUR_ENGINE_PORT", "8100"))
ALIGN_SERVER_URL = os.environ.get("MURMUR_ALIGN_URL", "http://localhost:8001")
```

A few things worth noting:

- `DATA_DIR` defaults to `./data` in dev, which is where your SQLite database
  and audio files land. The Docker compose overrides this to `/app/data` and
  mounts a volume.
- `ENGINE_PORT = 8100` — TTS engines always run on 8100 when managed by the
  orchestrator, even though the standalone dev command uses 8000. That keeps
  both mental models consistent: "8100 is where the *currently active engine*
  lives."
- `JWT_SECRET` has **no default**. The orchestrator refuses to start unless
  `MURMUR_JWT_SECRET` is set — generate one with `openssl rand -base64 48`.
  For local development where you don't want to bother, set
  `MURMUR_ALLOW_DEV_SECRET=1` and the config falls back to a fixed
  placeholder. The real secret is also warned-on if shorter than 32 bytes
  (HS256's `jose` library raises `InsecureKeyLengthWarning` below that).

### 2.2 Schema and the DB helper

SQLite is the right call for a self-hosted single-node app. WAL mode lets the
job worker write while HTTP handlers read; foreign keys enforce cascade
deletes when a read is removed.

The schema lives verbatim in `orchestrator/schema.sql`:

```sql
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    title TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'text',
    source_url TEXT,
    file_name TEXT,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    progress_segment INTEGER NOT NULL DEFAULT 0,
    progress_word INTEGER NOT NULL DEFAULT 0,
    voice TEXT,
    engine TEXT,
    generated_at TEXT
);

CREATE TABLE IF NOT EXISTS audio_segments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    read_id INTEGER NOT NULL REFERENCES reads(id) ON DELETE CASCADE,
    segment_index INTEGER NOT NULL,
    text TEXT NOT NULL,
    audio_generated INTEGER NOT NULL DEFAULT 0,
    word_timings_json TEXT,
    generated_at TEXT
);

CREATE TABLE IF NOT EXISTS voices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id),
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'builtin',
    wav_path TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, name)
);

CREATE TABLE IF NOT EXISTS bookmarks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    read_id INTEGER NOT NULL REFERENCES reads(id) ON DELETE CASCADE,
    segment_index INTEGER NOT NULL,
    word_offset INTEGER NOT NULL DEFAULT 0,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS jobs (
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

CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    UNIQUE(user_id, key)
);
```

The interesting relationships:

- A `read` has many `audio_segments` and many `bookmarks`. Both cascade when
  the read is deleted.
- `audio_segments.audio_generated` is a 0/1 flag; the job worker flips it to 1
  after writing the WAV to disk.
- `jobs.status` moves through `pending → running → done` or `→ failed` or
  `→ cancelled`, with a temporary `waiting_for_backend` state when an engine
  goes down mid-job.
- `voices.user_id` is nullable — builtin voices are shared across users and
  stored with `user_id IS NULL`.

The helper in `orchestrator/db.py` is mostly plumbing. Two things worth
calling out. First, the migration block:

```python
async def _migrate(db: aiosqlite.Connection):
    """Run lightweight migrations for columns added after initial schema."""
    cols = {row[1] for row in await db.execute_fetchall("PRAGMA table_info(reads)")}
    if "voice" not in cols:
        await db.execute("ALTER TABLE reads ADD COLUMN voice TEXT")
        await db.execute("ALTER TABLE reads ADD COLUMN engine TEXT")
        await db.execute("ALTER TABLE reads ADD COLUMN generated_at TEXT")
        # Backfill from the most recent completed job per read
        await db.execute("""UPDATE reads SET voice = j.voice, engine = j.engine, ...""")
```

This is a deliberate anti-pattern. We do not use Alembic because a self-hosted
SQLite app has exactly one instance and one shape of database; the `if column
not in table` block is the simplest thing that could possibly work and is
easy for a user to reason about when upgrading.

Second, there are two ways to get a connection. The FastAPI dependency form
uses `async def get_db()` and is awaited as a generator; the non-request form
uses `async with open_db()`. The job worker needs the second because it is a
long-running background task outside any request lifecycle.

### 2.3 Auth

Authentication is split into two halves. The orchestrator owns password
hashing and JWT creation (`orchestrator/auth.py`), and the Nuxt BFF owns
JWT validation and cookie handling (`frontend/server/utils/jwt.ts`). The
orchestrator validates the incoming `X-User-Id` header instead of
re-validating JWTs on every request — the Nitro middleware is trusted.

```python
# orchestrator/auth.py
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()

def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())

def create_token(user_id: int) -> str:
    payload = {
        "sub": str(user_id),
        "exp": datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRY_HOURS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

async def get_current_user_id(x_user_id: str = Header()) -> int:
    """Used when Nuxt BFF passes the validated user_id in a header."""
    try:
        return int(x_user_id)
    except (ValueError, TypeError):
        raise HTTPException(status_code=401, detail="Invalid user ID")
```

The `Header()` dependency is explicit: if the header is missing, FastAPI
returns 422; if it is present but not numeric, we return 401 ourselves. The
Nitro middleware is the only thing that should ever set this header, but
anyone with direct network access to the orchestrator port could forge it —
which is why the orchestrator port is never exposed on the production Caddy
reverse proxy.

### 2.4 Sentence splitting

Reads are broken into sentence-sized segments before TTS. This gives three
things: audio starts playing as soon as the first sentence is ready,
generation can resume mid-document after a failure, and each sentence gets
its own word-level alignment.

There is a server-side splitter in Python and a client-side splitter in
TypeScript. The reason is simple: the server uses the splitter to decide how
many segments to insert into `audio_segments` when a read is created, but the
frontend also needs to show a rough sentence preview ("Reading time: 3 min,
42 sentences") before the user has posted anything.

The server version in `orchestrator/sentence_splitter.py` is sixty lines and
handles four edge cases that naive regex splitters get wrong:

```python
ABBREVIATIONS = {
    "mr", "mrs", "ms", "dr", "prof", ...,
    "i.e", "e.g", "etc", "al", "cf",
}
IMAGE_MARKER_RE = re.compile(r"^\[image:\d+\]$")

def split_sentences(text: str) -> list[str]:
    sentences: list[str] = []
    parts = re.split(r"(\[image:\d+\])", text)
    for part in parts:
        stripped = part.strip()
        if not stripped: continue
        if IMAGE_MARKER_RE.match(stripped):
            sentences.append(stripped)
            continue
        sentences.extend(_split_prose(stripped))
    return sentences
```

The outer `split_sentences` splits on image markers first. Images from parsed
PDFs and EPUBs show up as `[image:N]` tokens in the content stream, and each
one becomes its own "segment" that has no audio to generate — the job worker
detects these and skips TTS.

The prose splitter walks token-by-token looking for a sentence-ending
punctuation mark (`.`, `!`, `?`) and treats three cases specially:

- **Abbreviations.** "Dr. Smith went home" is one sentence, not two, because
  `dr` is in the abbreviation set.
- **Initials.** "J. K. Rowling" is one sentence because each initial is a
  single letter followed by a period.
- **Decimals.** "The value is 3.14. That is pi." is two sentences. The regex
  matches `.+?` greedily before the trailing punctuation, so a decimal number
  like `3.14` is kept as a single token with the terminal period attached.

The tests in `orchestrator/tests/test_sentence_splitter.py` pin exactly these
behaviours:

```python
def test_abbreviations():
    assert split_sentences("Dr. Smith went home.") == ["Dr. Smith went home."]

def test_initials():
    assert split_sentences("J. K. Rowling wrote books.") == ["J. K. Rowling wrote books."]

def test_decimals():
    assert split_sentences("The value is 3.14. That is pi.") == [
        "The value is 3.14.", "That is pi."
    ]
```

### 2.5 Engine registry

A static registry names the five engines and declares facts about each one.
The registry is separate from the manager so tests can import it without
dragging in `asyncio.subprocess` or `httpx`.

```python
# orchestrator/engine_registry.py
@dataclass(frozen=True)
class EngineInfo:
    name: str
    display_name: str
    description: str
    size: str
    gpu: bool
    builtin_voices: bool
    repo_dir: str

ENGINES: dict[str, EngineInfo] = {
    "pocket-tts": EngineInfo(
        name="pocket-tts",
        display_name="Pocket TTS",
        description="8 built-in voices, ~400MB model, CPU-friendly",
        size="~400MB",
        gpu=False,
        builtin_voices=True,
        repo_dir="pocket-tts-server",
    ),
    "xtts-v2": EngineInfo(..., repo_dir="xtts-server"),
    "f5-tts": EngineInfo(..., repo_dir="f5tts-server"),
    "gpt-sovits": EngineInfo(..., repo_dir="gptsovits-server"),
    "cosyvoice2": EngineInfo(..., repo_dir="cosyvoice-server"),
}
```

`repo_dir` is the directory name under `tts-servers/`. The engine manager
uses this to find the engine's source code on disk. Keeping the registry as
a frozen dataclass means `test_engine_registry.py` can assert facts about it
without starting up any subprocesses:

```python
def test_five_engines_registered():
    assert len(ENGINES) == 5

def test_pocket_tts_is_default():
    engine = get_engine("pocket-tts")
    assert engine.display_name == "Pocket TTS"
    assert engine.builtin_voices is True
```

### 2.6 Engine manager

The engine manager is the most intricate piece of the orchestrator. It
enforces three invariants:

1. **At most one engine runs at a time.** Each engine loads a multi-gigabyte
   PyTorch model; running five at once would OOM almost any machine.
2. **Status moves only on observable events.** An engine is `RUNNING` only
   after its `/health` endpoint returns 200, not just after
   `asyncio.create_subprocess_exec` returns.
3. **A listener queue fans status changes out via SSE** so the UI updates in
   real time when an install finishes or an engine crashes.

The state is a dict of engine name → `EngineStatus`:

```python
# orchestrator/engine_manager.py
class EngineStatus(str, Enum):
    AVAILABLE = "available"      # known but not installed
    INSTALLING = "installing"    # venv creation / dep install in progress
    INSTALLED = "installed"      # has .venv but not running
    RUNNING = "running"          # subprocess up and /health returning 200
    STOPPED = "stopped"          # transient between engines
    UNAVAILABLE = "unavailable"  # was running, now failing /health
```

At startup, `check_installed()` looks for each engine's `main.py` and its
`.venv/bin/uvicorn` to decide whether to mark it `AVAILABLE` or `INSTALLED`.
The engine directory is found by checking the dev location first, then the
Docker runtime location — this is how the same code runs from your checkout
and from inside `/app/tts-servers/`:

```python
def _engine_dir(self, name: str) -> Path:
    engine = get_engine(name)
    repo_root = Path(__file__).parent.parent
    dev_path = repo_root / "tts-servers" / engine.repo_dir
    docker_path = config.ENGINES_DIR / engine.repo_dir
    if dev_path.exists():
        return dev_path
    if docker_path.exists():
        return docker_path
    return dev_path
```

Starting an engine has four phases. First, stop any currently-running engine.
Second, spawn `.venv/bin/uvicorn main:app --host 0.0.0.0 --port 8100` with an
environment that pre-accepts Coqui's TOS and disables `torch.load`'s
`weights_only=True` default, both of which otherwise deadlock the subprocess
on license prompts or crash it on pickle unpickling (see Part 9). Third, wait
for the engine's `/health` endpoint. Fourth, start a 10-second health loop:

```python
async def start_engine(self, name: str) -> bool:
    # ... setup ...
    env = {
        **os.environ,
        "COQUI_TOS_AGREED": "1",
        "TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD": "1",
    }
    self._process = await asyncio.create_subprocess_exec(
        *cmd, "--host", "0.0.0.0", "--port", str(config.ENGINE_PORT),
        cwd=str(engine_dir), env=env,
    )
    self._active_engine = name
    healthy = await self._wait_for_healthy(timeout=120)
    if not healthy:
        await self.stop_engine()
        self._statuses[name] = EngineStatus.UNAVAILABLE
        await self._emit_event("backend:status", {"name": name, "status": "unavailable"})
        return False
    self._statuses[name] = EngineStatus.RUNNING
    self._start_health_loop()
    await self._emit_event("backend:status", {"name": name, "status": "running"})
    return True
```

The health loop polls `/health` every ten seconds. After three consecutive
failures the engine is marked `UNAVAILABLE` and an SSE event fires. If the
engine recovers (returns 200 again), status flips back to `RUNNING`.

Installation is its own four-step pipeline:

```python
async def install_engine(self, name: str) -> bool:
    # 1. uv venv
    # 2. uv pip install torch torchaudio<2.6  [--index-url CPU if no GPU]
    # 3. uv pip install --requirement pyproject.toml
    # 4. uv pip uninstall torchcodec  (see Part 9)
    # 5. uv pip install uvicorn[standard]
    # 6. run post_install.py if present
```

CUDA is detected at install time via `shutil.which("nvidia-smi")` — a blunt
but reliable heuristic that does not require importing torch just to check.

The SSE machinery is a small pub-sub:

```python
def subscribe(self) -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue()
    self._listeners.append(q)
    return q

async def _emit_event(self, event: str, data: dict):
    msg = {"event": event, "data": json.dumps(data)}
    for q in self._listeners:
        await q.put(msg)
```

Each SSE subscriber (one per open tab) gets its own queue. The
`/backends/events` router pulls from the queue and yields events; when the
client disconnects, `asyncio.CancelledError` triggers an unsubscribe.

### 2.7 Job event bus

There is a second SSE bus for job progress. It is scoped by user id so one
user does not see another user's generation progress:

```python
# orchestrator/job_events.py
class JobEventBus:
    def __init__(self):
        self._listeners: dict[int, list[asyncio.Queue]] = {}

    def subscribe(self, user_id: int) -> asyncio.Queue:
        if user_id not in self._listeners:
            self._listeners[user_id] = []
        q: asyncio.Queue = asyncio.Queue()
        self._listeners[user_id].append(q)
        return q

    async def emit(self, user_id: int, event: str, data: dict):
        msg = {"event": event, "data": json.dumps(data)}
        for q in self._listeners.get(user_id, []):
            await q.put(msg)
```

Events are `job:queued`, `job:started`, `job:progress`, `job:completed`,
`job:failed`, and `job:cancelled`. The test file
`tests/test_job_events.py` pins that emit only reaches the target user and
that multiple subscribers for the same user all receive the event:

```python
async def test_emit_only_reaches_target_user():
    bus = JobEventBus()
    q1 = bus.subscribe(user_id=1)
    q2 = bus.subscribe(user_id=2)
    await bus.emit(user_id=1, event="job:started", data={"jobId": 5})
    msg = await asyncio.wait_for(q1.get(), timeout=1)
    assert q2.empty()
```

### 2.8 Job worker

The worker is an `asyncio.Task` that loops forever pulling pending jobs and
processing them one at a time. It is started from the FastAPI lifespan hook
and stopped on shutdown.

```python
# orchestrator/job_worker.py
class JobWorker:
    async def _loop(self):
        while True:
            try:
                await self._resume_waiting_jobs()
                job = await self._pick_next_job()
                if job:
                    await self._process_job(job)
                else:
                    await asyncio.sleep(2)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Job worker loop error")
                await asyncio.sleep(5)
```

`_pick_next_job()` finds the oldest `pending` job and atomically claims it by
setting its status to `running` in the same transaction. That ordering means
two workers would never race if we ever grew to multiple — though with
SQLite's single writer that is not a concern today.

Processing a job walks ungenerated segments. For each segment:

```python
# 1. Check engine availability (else mark job waiting_for_backend)
# 2. POST to {engine_url}/tts/generate with {text, voice, language?}
# 3. Write the returned WAV bytes to data/audio/<read_id>/<seg_idx>.wav
# 4. POST the WAV to the alignment server for word timings (best-effort)
# 5. UPDATE audio_segments SET audio_generated=1, word_timings_json=?
# 6. UPDATE jobs SET progress = progress + 1
# 7. Emit job:progress event for the owner
```

The TTS request uses a 600-second timeout because F5-TTS and CosyVoice can
legitimately take several minutes on CPU. The alignment call is wrapped in a
broad `try/except` — if the alignment server is down or slow, we still save
the audio, we just skip word timings for that segment:

```python
# orchestrator/job_worker.py, _process_segment
try:
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{engine_url}/tts/generate", json=payload, timeout=600,
        )
        resp.raise_for_status()
        audio_data = resp.content
except Exception:
    return False

wav_path.write_bytes(audio_data)

# Align (best-effort)
word_timings = None
try:
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{config.ALIGN_SERVER_URL}/align",
            files={"audio": ("segment.wav", audio_data, "audio/wav")},
            data={"text": text}, timeout=60,
        )
        resp.raise_for_status()
        word_timings = json.dumps(resp.json().get("words", []))
except Exception:
    logger.debug("alignment unavailable (this is ok)")
```

Image-marker segments (text matching `^[image:N]$`) are short-circuited — no
TTS call is made, but `audio_generated` is still flipped to 1 so the progress
counter advances:

```python
import re
if re.match(r"^\[image:\d+\]$", text):
    async with open_db() as db:
        await db.execute("""UPDATE audio_segments SET audio_generated = 1, ... """)
        await db.execute("UPDATE jobs SET progress = progress + 1 WHERE id = ?", (job["id"],))
        await db.commit()
    return True
```

There are three additional refinements in the worker.

**Cancellation polling.** Between segments, the worker re-reads the job's
status. If the user called `DELETE /queue/:id` while the worker was mid-job,
the status is now `cancelled` and the loop exits cleanly.

**Waiting for backend.** If the engine goes down between segments (engine
switched by admin, container restarted), the worker updates the job to
`waiting_for_backend` and returns. The next loop iteration calls
`_resume_waiting_jobs()` which flips it back to `pending` once an engine is
available.

**Cross-engine voice portability.** Cloned voices live in the orchestrator's
`data/voices/cloned/<user_id>/<name>.wav`, but each TTS engine keeps its own
`voices/` directory. If a user clones a voice on XTTS and then switches to
F5-TTS, the new engine has no WAV for that voice. The worker fixes this by
checking `{engine}/tts/voices` for the voice and, if missing, uploading the
WAV via `{engine}/tts/clone-voice` before the first `tts/generate` call:

```python
async def _ensure_voice_on_engine(self, job: dict) -> bool:
    # Check engine's voice list; if voice is there, return True.
    # Else look up wav_path in DB, read the WAV, and POST it to
    # {engine}/tts/clone-voice. If there's no wav_path (voice is a
    # builtin from a different engine), fail fast with a clear error.
```

The file `tests/test_job_worker.py` covers every one of these paths with an
`httpx` mock. The noteworthy ones:

- `test_process_segment_tts_failure` — TTS returns an error, segment fails,
  `_process_segment` returns False, and the job is marked failed.
- `test_alignment_failure_continues` — alignment 500s, but the audio file
  still lands on disk and `audio_generated=1`.
- `test_process_job_cancelled_mid_run` — cancellation between segment 2 and 3
  stops the loop after 2 segments are written and emits `job:cancelled`.
- `test_resume_waiting_jobs_when_engine_back` — a `waiting_for_backend` job is
  flipped back to `pending` once `engine_manager.get_engine_url()` is
  truthy.

### 2.9 Pydantic models

`orchestrator/models.py` is one screen of Pydantic request/response models.
They exist mostly so FastAPI can generate an OpenAPI schema and so the
frontend's TypeScript types (`frontend/types/api.ts`) mirror the backend
names exactly.

The two interesting groups are `ReadSummary`/`ReadDetail` and `JobResponse`.
A `ReadSummary` is what the library grid shows; a `ReadDetail` adds the full
content and the list of `SegmentResponse`s. `ReadSummary` is derived by a
subquery that counts segments per read, which avoids N+1 queries on the
library page:

```python
class ReadSummary(BaseModel):
    id: int
    user_id: int
    title: str
    type: str
    source_url: str | None
    file_name: str | None
    progress_segment: int
    progress_word: int
    segment_count: int
    created_at: str
    updated_at: str
    voice: str | None = None
    engine: str | None = None
    generated_at: str | None = None
```

`JobResponse` returns all of the progress fields so the queue page can render
without a second SSE round-trip on load:

```python
class JobResponse(BaseModel):
    id: int
    user_id: int
    read_id: int
    voice: str
    engine: str
    language: str | None
    status: str
    progress: int
    total: int
    error: str | None
    created_at: str
    started_at: str | None
    completed_at: str | None
```

### 2.10 Routers

Each router is one concern. They are all included in `main.py`.

**`orchestrator/routers/auth_router.py`** implements `POST /auth/register`,
`POST /auth/login`, and `GET /auth/me`. Register and login hash/verify with
bcrypt and return `{user, token}`. Both are also wrapped in a tiny in-memory
sliding-window rate limiter (`orchestrator/rate_limit.py`) — 5 logins and 3
registrations per IP per minute, enough to annoy a casual brute-forcer
without getting in the way of a family member who fat-fingers their
password. `GET /auth/me` uses the `get_current_user_id` dependency which
reads `X-User-Id`:

```python
@router.post("/register", response_model=AuthResponse, status_code=201)
async def register(req: RegisterRequest, db: aiosqlite.Connection = Depends(get_db)):
    existing = await db.execute_fetchall("SELECT id FROM users WHERE email = ?", (req.email,))
    if existing:
        raise HTTPException(status_code=409, detail="Email already registered")
    cursor = await db.execute(
        "INSERT INTO users (email, password_hash, display_name) VALUES (?, ?, ?)",
        (req.email, hash_password(req.password), req.display_name),
    )
    await db.commit()
    # ... return AuthResponse with a fresh JWT ...
```

**`orchestrator/routers/reads.py`** is the biggest router: list/create/get/
patch/delete reads, plus `POST /reads/:id/generate` which creates a job.
Creating a read runs `split_sentences` and inserts a row into
`audio_segments` for each sentence:

```python
@router.post("", response_model=ReadDetail, status_code=201)
async def create_read(req, user_id, db):
    cursor = await db.execute(
        "INSERT INTO reads (user_id, title, content, type, source_url, file_name) "
        "VALUES (?, ?, ?, ?, ?, ?)", ...
    )
    read_id = cursor.lastrowid
    sentences = split_sentences(req.content)
    for i, text in enumerate(sentences):
        await db.execute(
            "INSERT INTO audio_segments (read_id, segment_index, text) VALUES (?, ?, ?)",
            (read_id, i, text),
        )
    await db.commit()
    return await _get_read_detail(db, read_id, user_id)
```

Generation has four guard clauses: the read must exist and belong to the user,
an engine must be running, there must be no pending/running job for the same
read, and there must be at least one ungenerated segment. If `regenerate=True`
is passed, the existing audio is blown away and all segments are reset:

```python
if req.regenerate:
    await db.execute(
        "UPDATE audio_segments SET audio_generated = 0, word_timings_json = NULL, "
        "generated_at = NULL WHERE read_id = ?", (read_id,),
    )
    audio_dir = config.AUDIO_DIR / str(read_id)
    if audio_dir.exists():
        shutil.rmtree(audio_dir)
```

**`orchestrator/routers/voices.py`** does three things: list voices for a
user (builtins plus their own clones), sync the active engine's builtin list
into the DB (deleting stale ones), and accept WAV uploads for cloning.
Cloning writes the WAV to disk, posts it to the engine's `/tts/clone-voice`,
and inserts a row with `type='cloned'` and `wav_path`:

```python
@router.post("/clone", response_model=VoiceResponse, status_code=201)
async def clone_voice(name, file, prompt_text, user_id, db):
    user_voices_dir = config.VOICES_DIR / str(user_id)
    user_voices_dir.mkdir(parents=True, exist_ok=True)
    wav_path = user_voices_dir / f"{name}.wav"
    content = await file.read()
    wav_path.write_bytes(content)

    async with httpx.AsyncClient() as client:
        files = {"file": (f"{name}.wav", content, "audio/wav")}
        form_data = {"name": name}
        if prompt_text: form_data["prompt_text"] = prompt_text
        resp = await client.post(f"{engine_url}/tts/clone-voice",
                                  files=files, data=form_data, timeout=60)
        resp.raise_for_status()
    # ... INSERT INTO voices ...
```

**`orchestrator/routers/backends.py`** exposes the engine registry plus
install/select/uninstall/events endpoints. Install is deliberately fire-and-
forget: the request returns immediately and the actual `uv pip install` runs
as an `asyncio.create_task` so the HTTP client does not time out on a
long-running install:

```python
@router.post("/install")
async def install_backend(req: SelectBackendRequest):
    if req.name not in ENGINES:
        raise HTTPException(status_code=404, ...)
    status = engine_manager.get_status(req.name)
    if status.value in ("installed", "running", "stopped"):
        return {"message": f"Engine {req.name} is already installed"}
    if status.value == "installing":
        return {"message": f"Engine {req.name} is already installing"}
    asyncio.create_task(_install_engine_task(req.name))
    return {"message": f"Installing {req.name}..."}
```

**`orchestrator/routers/queue.py`** lists a user's jobs, cancels jobs, and
streams events:

```python
@router.get("/events")
async def queue_events(user_id: int = Depends(get_current_user_id)):
    q = job_event_bus.subscribe(user_id)
    async def event_generator():
        try:
            while True:
                msg = await q.get()
                yield {"event": msg["event"], "data": msg["data"]}
        except asyncio.CancelledError:
            job_event_bus.unsubscribe(user_id, q)
    return EventSourceResponse(event_generator())
```

**`orchestrator/routers/bookmarks.py`** is straightforward CRUD on
`bookmarks`, joined against `reads.user_id` on every query so cross-user
access is impossible.

**`orchestrator/routers/settings.py`** is a per-user key-value store
(currently used for the "auto-sync" switch).

**`orchestrator/routers/health.py`** is used by Caddy/Docker healthchecks and
by the frontend's `useHealth()` composable:

```python
@router.get("/health", response_model=HealthResponse)
async def health():
    db_status = "ok" if config.DB_PATH.exists() else "unavailable"
    return HealthResponse(
        status="ok",
        db=db_status,
        active_engine=engine_manager.active_engine,
        alignment=None,
    )
```

### 2.11 `main.py` — wiring it together

`orchestrator/main.py` is the only file that imports every other module. Its
job is threefold: configure FastAPI, run the lifespan hook at startup, and
mount a handful of endpoints that do not fit cleanly under any router (audio
serving, image uploads, thumbnails).

The lifespan hook is the critical piece. It is where the database is
initialised, the default engine is auto-started, stale jobs are reset to
pending, and the job worker is launched:

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    config.THUMBNAILS_DIR.mkdir(parents=True, exist_ok=True)
    config.IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    await init_db()
    config.ENGINES_DIR.mkdir(parents=True, exist_ok=True)
    engine_manager.check_installed()
    if engine_manager.get_status("pocket-tts").value in ("installed", "stopped"):
        logger.info("Auto-starting default engine: pocket-tts")
        started = await engine_manager.start_engine("pocket-tts")
        if started:
            await sync_builtin_voices()
    await reset_stale_jobs()
    await job_worker.start()
    yield
    await job_worker.stop()
    await engine_manager.shutdown()
```

`reset_stale_jobs()` is worth understanding. If the orchestrator crashes
mid-generation, some jobs will be stuck in `running` or
`waiting_for_backend`. On startup we flip them all back to `pending` so the
worker picks them back up. `test_startup_recovery.py` pins this explicitly:

```python
async def test_running_jobs_reset_to_pending_on_startup(client):
    # Seed a job in 'running' state (simulating a crash)
    # ...
    await reset_stale_jobs()
    # Expect status is now 'pending'
```

The audio serving endpoints are in `main.py` because they do not need a user
context (they are scoped by read id and the BFF handles auth). `serve_audio`
returns a single segment WAV; `serve_audio_bundle` returns a ZIP of many
segments for the background-sync background download:

```python
@app.get("/audio/{read_id}/bundle")
async def serve_audio_bundle(read_id: int, segments: str | None = None):
    # ... glob or parse comma-separated indices, build a ZIP_STORED ...

@app.get("/audio/{read_id}/{segment_index}")
async def serve_audio(read_id: int, segment_index: int):
    path = config.AUDIO_DIR / str(read_id) / f"{segment_index}.wav"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Audio not found")
    return FileResponse(path, media_type="audio/wav")
```

Thumbnail and image uploads live here too because they accept either a
multipart file or a JSON URL (pull the image server-side from a source page).
The JSON path is behind an SSRF guard that rejects non-http(s) schemes,
localhost, and private/loopback/link-local IPs:

```python
def _validate_external_url(url: str):
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise HTTPException(400, "Only http/https URLs allowed")
    hostname = parsed.hostname or ""
    if not hostname or hostname == "localhost":
        raise HTTPException(400, "Internal URLs not allowed")
    for info in socket.getaddrinfo(hostname, None):
        addr = ipaddress.ip_address(info[4][0])
        if addr.is_private or addr.is_loopback or addr.is_link_local:
            raise HTTPException(400, "Internal URLs not allowed")
```

By the end of Part 2 the orchestrator is a complete, testable server. You
can:

```bash
uv --project orchestrator run uvicorn orchestrator.main:app --port 8000
curl -X POST http://localhost:8000/auth/register \
     -H 'Content-Type: application/json' \
     -d '{"email":"you@example.com","password":"hunter2!!"}'
curl -H "X-User-Id: 1" -X POST http://localhost:8000/reads \
     -H 'Content-Type: application/json' \
     -d '{"title":"Hello","content":"Hello world. How are you?"}'
```

…and if the Pocket TTS engine is installed and running on port 8100, the
job worker will start generating WAVs into `data/audio/1/`.

## Part 3 — The Alignment Server

Word-level highlighting in the reader UI needs a `[{word, start, end}]` list
for each audio segment. We get these with forced alignment via WhisperX:
given an audio clip and its known transcript, WhisperX predicts timestamps
for each word. This is a third FastAPI server so that you can opt out
(skipping WhisperX saves ~2 GB of model downloads and a lot of CPU).

The whole server is one file:

```python
# alignment-server/main.py
@asynccontextmanager
async def lifespan(app: FastAPI):
    global align_model, align_metadata, device
    import torch
    import whisperx
    device = "cuda" if torch.cuda.is_available() else "cpu"
    align_model, align_metadata = whisperx.load_align_model(
        language_code="en", device=device
    )
    yield

def run_alignment(audio_path, text, device, model, metadata) -> list[dict]:
    import whisperx
    audio = whisperx.load_audio(audio_path)
    duration = len(audio) / 16000  # whisperx loads at 16kHz
    segments = [{"text": text, "start": 0.0, "end": duration}]
    result = whisperx.align(segments, model, metadata, audio, device,
                             return_char_alignments=False)
    words = []
    for seg in result.get("segments", []):
        for w in seg.get("words", []):
            if "start" in w and "end" in w:
                words.append({
                    "word": w["word"],
                    "start": round(w["start"], 3),
                    "end": round(w["end"], 3),
                })
    return words

@app.post("/align")
async def align(audio: UploadFile = File(...), text: str = Form(...)):
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tmp.write(await audio.read())
        tmp_path = tmp.name
    try:
        words = run_alignment(tmp_path, text, device, align_model, align_metadata)
    finally:
        Path(tmp_path).unlink(missing_ok=True)
    return {"words": words}
```

The alignment tests in `alignment-server/tests/test_align.py` monkeypatch
`run_alignment` so they do not require WhisperX to actually load:

```python
@pytest.mark.asyncio
async def test_align_returns_words(client, monkeypatch):
    fake_words = [
        {"word": "hello", "start": 0.0, "end": 0.4},
        {"word": "world", "start": 0.5, "end": 0.9},
    ]
    def mock_align(audio_path, text, device, model, metadata):
        return fake_words
    monkeypatch.setattr("main.run_alignment", mock_align)
    # POST a minimal valid 44-byte WAV header
    resp = await client.post("/align",
        files={"audio": ("segment.wav", wav_header, "audio/wav")},
        data={"text": "hello world"})
    assert resp.status_code == 200
    assert resp.json()["words"] == fake_words

async def test_align_missing_audio(client):
    resp = await client.post("/align", data={"text": "hello"})
    assert resp.status_code == 422

async def test_align_missing_text(client):
    resp = await client.post("/align",
        files={"audio": ("segment.wav", wav_header, "audio/wav")})
    assert resp.status_code == 422
```

The 422 tests verify FastAPI's automatic multipart validation — if either
field is missing, the route never executes.

Run the server with:

```bash
cd alignment-server && uv run uvicorn main:app --port 8001
```

First run downloads the alignment model (~2 GB on disk, into the HuggingFace
cache directory).

## Part 4 — The Other Four TTS Engines

The remaining four engines follow the same contract as Pocket TTS but have
interesting differences in how they synthesise and what infrastructure they
need. The point of this section is to show why the orchestrator's
engine-management code has to be generic.

**XTTS v2 (`tts-servers/xtts-server/main.py`)** is clone-only. It needs a
reference WAV for every generation, and it cannot use named builtins:

```python
@app.get("/tts/voices")
def list_voices():
    custom = [p.stem for p in VOICES_DIR.glob("*.wav")]
    return {"builtin": [], "custom": custom}   # no builtins

@app.post("/tts/generate")
def generate(req):
    wav_path = VOICES_DIR / f"{req.voice}.wav"
    if not wav_path.exists():
        raise HTTPException(404, f"Voice '{req.voice}' not found. Clone a voice first.")
    lang = req.language or "en"
    audio = m.tts(text=req.text, speaker_wav=str(wav_path),
                   language=lang, split_sentences=True)
```

The monkey-patch at the top of the file is load-bearing — `torch.load`'s
default changed in PyTorch 2.6 to `weights_only=True`, which rejects Coqui
TTS's pickled `XttsConfig`:

```python
import torch
_orig_load = torch.load
torch.load = lambda *a, **kw: _orig_load(*a, **{**kw, "weights_only": False})
```

**F5-TTS (`tts-servers/f5tts-server/main.py`)** auto-transcribes the
reference WAV via Whisper when `ref_text=""`. This means one generation
triggers three models: Whisper transcription, F5-TTS diffusion, and the
Vocos vocoder. On CPU this takes several minutes per segment, which is why
the orchestrator's TTS timeout is 600 seconds.

```python
audio, sr, _ = m.infer(
    ref_file=str(wav_path),
    ref_text="",           # empty = auto-transcribe via Whisper
    gen_text=req.text,
)
```

**GPT-SoVITS (`tts-servers/gptsovits-server/main.py`)** requires a 3–10
second reference clip. If the user uploads a longer clip, the engine trims
it on the fly before inference:

```python
sr_ref, audio_ref = wav.read(ref_path)
duration = len(audio_ref) / sr_ref
if duration > 10:
    trimmed = audio_ref[:int(sr_ref * 9)]
    trimmed_path = str(VOICES_DIR / f"{req.voice}_trimmed.wav")
    wav.write(trimmed_path, sr_ref, trimmed)
    ref_path = trimmed_path
```

GPT-SoVITS also has its own language detection (`auto`, `en`, `zh`, `ja`) and
needs four large pretrained model files totalling 4.5 GB, downloaded by the
`post_install.py` from HuggingFace.

**CosyVoice 2 (`tts-servers/cosyvoice-server/main.py`)** has two inference
modes. Zero-shot cloning when a transcript of the reference audio is known,
and cross-lingual synthesis when it is not:

```python
if prompt_text and prompt_text != "Hello, this is a sample of my voice.":
    inference_fn = model.inference_zero_shot(text, prompt_text, wav_path, stream=False)
else:
    inference_fn = model.inference_cross_lingual(text, wav_path, stream=False)
```

When cloning, the engine saves the optional `prompt_text` alongside the WAV
as `<name>.txt` so it survives engine restarts:

```python
if prompt_text.strip():
    txt_dest = VOICES_DIR / f"{safe_name}.txt"
    txt_dest.write_text(prompt_text.strip())
```

CosyVoice is also the only engine whose source code is a Git clone, not a
PyPI package. The repo has to be on `sys.path` before importing the
`cosyvoice` package:

```python
REPO_DIR = Path(__file__).parent / "repo"
sys.path.insert(0, str(REPO_DIR))
sys.path.insert(0, str(REPO_DIR / "third_party" / "Matcha-TTS"))
from cosyvoice.cli.cosyvoice import CosyVoice2
```

Every engine is therefore a `main.py` + `pyproject.toml` + `post_install.py`
+ a `voices/` directory. They all speak the same four-endpoint contract and
the orchestrator is blissfully ignorant of their internals.

## Part 5 — The Frontend BFF

The frontend is a Nuxt 3 app, which means there is a Nitro server bundled
inside the project. That Nitro server is the BFF ("backend for frontend")
that the browser actually talks to. It does two jobs: it validates the JWT
cookie on every `/api/*` request, and it proxies validated requests to the
orchestrator.

### Runtime config

`frontend/nuxt.config.ts` exposes the two env-bound values:

```ts
runtimeConfig: {
  orchestratorUrl: 'http://localhost:8000',
  jwtSecret: 'dev-secret-change-in-production',
},
```

In production these are overridden by `NUXT_ORCHESTRATOR_URL` and
`NUXT_JWT_SECRET`. The Docker Compose file wires them in, and the
`:?` syntax refuses to start the stack if `MURMUR_JWT_SECRET` is missing
from `.env`:

```yaml
app:
  environment:
    - NUXT_ORCHESTRATOR_URL=http://orchestrator:8000
    - NUXT_JWT_SECRET=${MURMUR_JWT_SECRET:?MURMUR_JWT_SECRET must be set in .env}
```

### The JWT verifier

```ts
// frontend/server/utils/jwt.ts
import { jwtVerify } from 'jose'

export async function verifyToken(token: string, secret: string): Promise<number> {
  const secretKey = new TextEncoder().encode(secret)
  const { payload } = await jwtVerify(token, secretKey, {
    algorithms: ['HS256'],
  })
  if (!payload.sub) throw new Error('Token missing sub claim')
  return parseInt(payload.sub, 10)
}
```

Using `jose` (a browser-compatible JWT library) instead of `jsonwebtoken`
means the same verifier would work in an edge-runtime deployment. The tests
in `frontend/tests/server/jwt.test.ts` pin five behaviours:

```ts
it('returns userId from a valid token', async () => { ... })
it('throws for an expired token', async () => { ... })       // expired
it('throws for a tampered token', async () => { ... })       // signature invalid
it('throws for wrong secret', async () => { ... })           // key mismatch
it('throws for garbage input', async () => { ... })          // not a JWT at all
```

### The orchestrator helper

`frontend/server/utils/orchestrator.ts` gives you one primitive: a typed
`$fetch` against the orchestrator with an optional `X-User-Id` header, plus
cookie configuration shared across auth endpoints.

```ts
export async function orchestratorFetch<T>(event, path, options = {}): Promise<T> {
  const config = useRuntimeConfig(event)
  const headers: Record<string, string> = {}
  if (options.userId != null) headers['X-User-Id'] = String(options.userId)
  return $fetch<T>(path, {
    baseURL: config.orchestratorUrl,
    method: options.method as any || 'GET',
    body: options.body,
    headers,
  })
}

export const AUTH_COOKIE_NAME = 'murmur_token'
export function authCookieOptions() {
  return {
    httpOnly: true,
    secure: !import.meta.dev,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 72 * 60 * 60, // matches orchestrator JWT_EXPIRY_HOURS
  }
}
```

`httpOnly: true` means the cookie is never accessible to client-side
JavaScript, which makes XSS-based token theft a non-issue. `secure` is
tied to `!import.meta.dev`: in dev (Nuxt's `nuxi dev`) the cookie is
allowed on plain HTTP, but in a production build it is `Secure`-only.
This means plain-HTTP access to a production build — even on a LAN — will
silently drop the auth cookie and login will appear to "succeed and
immediately log out." In production, run behind Caddy HTTPS (the default
compose setup does this).

### The middleware and proxy

One middleware guards every `/api/*` request. It skips three auth endpoints
and `/api/health` (so the health check can run unauthenticated), verifies
the cookie, and stashes the user id on `event.context`:

```ts
// frontend/server/middleware/auth.ts
export default defineEventHandler(async (event) => {
  const path = getRequestURL(event).pathname
  if (!path.startsWith('/api/')) return

  if (path.startsWith('/api/auth/login') ||
      path.startsWith('/api/auth/register') ||
      path.startsWith('/api/auth/logout') ||
      path === '/api/health') return

  const token = getCookie(event, AUTH_COOKIE_NAME)
  if (!token) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  try {
    const config = useRuntimeConfig(event)
    const userId = await verifyToken(token, config.jwtSecret)
    event.context.userId = userId
  } catch {
    throw createError({ statusCode: 401, statusMessage: 'Invalid token' })
  }
})
```

And then a catch-all at `frontend/server/api/[...].ts` proxies authenticated
traffic through to the orchestrator with the `X-User-Id` header that the
orchestrator uses to scope every query:

```ts
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

`proxyRequest` streams both ways, which is what makes SSE work through the
BFF: the orchestrator's `text/event-stream` body is streamed to the browser
without buffering.

### The auth endpoints

`frontend/server/api/auth/register.post.ts` and `login.post.ts` are
structurally identical. They call the orchestrator's `/auth/*`, grab the
`{user, token}` response, and set the token as an httpOnly cookie:

```ts
// frontend/server/api/auth/login.post.ts
const data = await orchestratorFetch<{ user, token }>(event, '/auth/login',
    { method: 'POST', body })
setCookie(event, AUTH_COOKIE_NAME, data.token, authCookieOptions())
return data.user
```

Logout is one line — delete the cookie:

```ts
// frontend/server/api/auth/logout.post.ts
deleteCookie(event, AUTH_COOKIE_NAME, { path: '/' })
```

`me.get.ts` calls through to `/auth/me` passing the decoded user id, so the
client can bootstrap the logged-in state on SSR:

```ts
export default defineEventHandler(async (event) => {
  const userId = event.context.userId as number
  return await orchestratorFetch(event, '/auth/me', { userId })
})
```

### The URL extractor

`frontend/server/api/extract-url.post.ts` is the one non-auth, non-proxy
route. It exists because `@mozilla/readability` in the browser needs the HTML
of an external page, but fetching that HTML from the browser is blocked by
CORS. So we do the fetch server-side:

```ts
export default defineEventHandler(async (event) => {
  const { url } = await readBody<{ url: string }>(event)
  if (!url || typeof url !== 'string') throw createError({ statusCode: 400, ... })
  try { new URL(url) } catch { throw createError({ statusCode: 400, ... }) }

  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 ...', 'Accept': 'text/html,...', 'Accept-Language': 'en-US,...' },
    redirect: 'follow',
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw createError({ statusCode: response.status, ... })

  const html = await response.text()
  // Extract og:image for thumbnail via two regex orderings
  let thumbnailUrl: string | null = null
  const ogMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)
  if (ogMatch?.[1]) { try { thumbnailUrl = new URL(ogMatch[1], url).href } catch {} }
  return { html, thumbnailUrl }
})
```

A 15-second timeout, a real User-Agent (some sites bot-filter obvious ones),
and an `og:image` scraper so the library card shows a thumbnail. The
`frontend/utils/url-extractor.ts` on the client calls this endpoint and then
runs Readability on the returned HTML.

## Part 6 — The Frontend App

### 6.1 Auth middleware and composable

The global route middleware runs before every navigation on the client and
redirects unauthenticated users to `/login`:

```ts
// frontend/middleware/auth.global.ts
export default defineNuxtRouteMiddleware(async (to) => {
  const { loggedIn, initialized, fetchUser } = useAuth()
  if (!initialized.value) await fetchUser()
  const publicRoutes = ['/login', '/register']
  if (!loggedIn.value && !publicRoutes.includes(to.path)) return navigateTo('/login')
  if (loggedIn.value && publicRoutes.includes(to.path)) return navigateTo('/')
})
```

The composable `frontend/composables/useAuth.ts` holds the logged-in user in
`useState` (so SSR and client agree on the same value) and exposes
login/register/logout:

```ts
export function useAuth() {
  const user = useState<User | null>('auth-user', () => null)
  const initialized = useState('auth-initialized', () => false)
  const loggedIn = computed(() => !!user.value)

  async function fetchUser() {
    try {
      // useRequestFetch forwards cookies during SSR so the auth middleware sees the JWT
      const $api = useRequestFetch()
      user.value = await $api<User>('/api/auth/me')
    } catch { user.value = null }
    initialized.value = true
  }
  // login, register, logout each call $fetch against /api/auth/*
}
```

The key subtlety is `useRequestFetch()`. During SSR, the server renders the
page before the browser has attached its cookies; `useRequestFetch` forwards
the incoming request's headers (including the cookie) to any `$fetch` call,
so the JWT is visible to the auth middleware during server-side rendering.
Without this, SSR renders as if the user were logged out.

### 6.2 Composables for data

Every domain has a composable. They are all thin wrappers around
`useFetch('/api/...')` plus SSE subscriptions where relevant. The pattern is
worth studying because it repeats.

**`useLibrary.ts`** is the simplest:

```ts
export function useLibrary() {
  const { data: reads, status, refresh } = useFetch<ReadSummary[]>('/api/reads', {
    default: () => [],
  })
  async function createRead(body) { ... ; await refresh(); return result }
  async function deleteRead(id) { await $fetch(`/api/reads/${id}`, { method: 'DELETE' }); await refresh() }
  return { reads, loading: computed(() => status.value === 'pending'), refresh, createRead, deleteRead }
}
```

`useFetch` is SSR-aware — on the server it runs synchronously during render;
on the client it kicks off a request and returns a reactive ref. The whole
"show a spinner on first load, refresh on mutate" pattern is four lines.

**`useGeneration.ts`** is the first composable that needs SSE. When the user
clicks "Generate audio" we `POST /api/reads/:id/generate` to create a job and
then open an SSE connection to `/api/queue/events` to watch its progress:

```ts
async function generate(voice, language, regenerate) {
  const result = await $fetch<Job>(`/api/reads/${readId.value}/generate`,
    { method: 'POST', body: { voice, language, regenerate } })
  job.value = result
  connectSSE()
}

function connectSSE() {
  if (!import.meta.client || !job.value) return
  disconnectSSE()
  eventSource = new EventSource('/api/queue/events')
  eventSource.onerror = () => disconnectSSE()

  eventSource.addEventListener('job:progress', (e) => {
    const data = JSON.parse(e.data)
    if (data.jobId === job.value?.id) {
      job.value = { ...job.value!, progress: data.segment, status: 'running' }
      options.onSegmentDone?.(data.segment - 1)
    }
  })
  eventSource.addEventListener('job:completed', ...)
  eventSource.addEventListener('job:failed', ...)
  eventSource.addEventListener('job:cancelled', ...)
}
```

The `onSegmentDone` callback is how `pages/read/[id].vue` knows when to start
playing the first segment — the reader subscribes to it and starts audio
playback as soon as segment 0's WAV is ready. There is no polling; audio
plays seconds after the first sentence generation completes.

A small but important detail: the SSE connection is closed when the tab
becomes hidden and reopened when it returns, driven by
`document.visibilitychange`. This is because browsers are increasingly
aggressive about killing long-lived connections on backgrounded tabs, and
reopening on visibility change is more reliable than hoping the connection
survives:

```ts
function onVisibilityChange() {
  if (document.hidden) disconnectSSE()
  else if (generating.value) connectSSE()
}
```

**`useBackends.ts`** does the same dance for `backend:status` events, calling
`refresh()` on every event so the UI picks up install/start/stop transitions
in real time.

**`useQueue.ts`** listens on the same `/api/queue/events` stream as
`useGeneration`, but refreshes the full queue list on any event. This is the
data source for `/queue`, the jobs page.

**`useVoices.ts`** has a sticky "currently selected voice" state in
`useState` so that the voice a user picks on `/new` is still selected when
they open `/read/:id` and want to regenerate.

**`useBookmarks.ts`** is the first composable that integrates with the
offline queue:

```ts
async function addBookmark(segmentIndex, wordOffset = 0, note?) {
  const url = `/api/reads/${readId.value}/bookmarks`
  const body = { segment_index: segmentIndex, word_offset: wordOffset, note }
  if (isOnline.value) {
    await $fetch(url, { method: 'POST', body })
    await refresh()
  } else {
    // Optimistic local update
    const optimistic: Bookmark = { id: -Date.now(), ..., created_at: new Date().toISOString() }
    bookmarks.value = [...bookmarks.value, optimistic]
    await queueMutation({ url, method: 'POST', body })
  }
}
```

Online, it is a normal POST. Offline, the mutation is pushed to IndexedDB
and the UI is updated optimistically (with a negative id so the real id can
replace it later). When the `online` event fires, `useOffline`'s
`processQueue()` replays the pending mutations in timestamp order.

### 6.3 Document parser

`frontend/utils/document-parser.ts` is almost 600 lines and handles five file
formats. Every branch ends up at the same shape: `{title, content, thumbnail?,
images?}`. The dispatcher is one switch:

```ts
switch (ext) {
  case 'txt': return { title: baseName, content: await file.text() }
  case 'md': return { title: baseName, content: parseMarkdown(await file.text()) }
  case 'html': case 'htm': return parseHtml(baseName, await file.text())
  case 'pdf': return { title: baseName, ...(await parsePdf(file)) }
  case 'docx': return { title: baseName, ...(await parseDocx(file)) }
  case 'epub': return { title: baseName, ...(await parseEpub(file)) }
  default: throw new Error(`Unsupported file type: .${ext}`)
}
```

**Markdown** is a string of regex substitutions that strip code blocks,
images, emphasis markers, horizontal rules, and HTML tags while preserving
link text. It is deliberately simple — Markdown is for notes, not for
publishing, and the goal is readable speech output, not faithful rendering.

**HTML** goes through Readability and falls back to raw `body.textContent`:

```ts
function parseHtml(fallbackTitle: string, html: string): ParsedDocument {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const reader = new Readability(doc)
  const article = reader.parse()
  if (article?.textContent?.trim()) {
    return { title: article.title || fallbackTitle, content: article.textContent.trim() }
  }
  const text = doc.body?.textContent?.trim()
  if (!text) throw new Error('Could not extract text from HTML file')
  const title = doc.querySelector('title')?.textContent?.trim() || fallbackTitle
  return { title, content: text }
}
```

**PDF** is the most complex format. The `parsePdf` function uses `pdfjs-dist`
(lazily imported because it is ~2 MB). For each page it extracts text items
with their y-positions, groups them into lines, then merges lines with
similar spacing into paragraphs. Separately, it walks the page's operator
list (`getOperatorList()`) to find `paintImageXObject` ops and extract
embedded images, filtering out icons smaller than 50 pixels:

```ts
for (let i = 0; i < fnArray.length; i++) {
  const op = fnArray[i]
  if (op === pdfjs.OPS.transform || op === pdfjs.OPS.setTransform) {
    const args = argsArray[i]
    if (args && args.length >= 6) lastTransformY = args[5]
  }
  if (op === pdfjs.OPS.paintImageXObject || op === pdfjs.OPS.paintImageXObjectRepeat) {
    const objId = argsArray[i][0] as string
    // ... get image data from page.objs or page.commonObjs ...
    // ... convert to JPEG Blob via a canvas ...
    results.push({ data: blob, y: lastTransformY })
  }
}
```

Images and paragraphs are then merged by y-position so that `[image:N]`
markers appear in roughly the right place in the content stream. The first
page is rendered to a 300-pixel-wide canvas as the thumbnail.

**DOCX** uses `mammoth`, which converts `.docx` to HTML. The trick is the
custom image handler — instead of letting mammoth embed base64 images into
the HTML, we redirect them to our own index-based sentinel `murmur-image:N`:

```ts
const result = await mammoth.convertToHtml({ arrayBuffer }, {
  convertImage: mammoth.images.imgElement(async (image) => {
    const index = images.length
    const buffer = await image.readAsArrayBuffer()
    images.push({ data: new Blob([buffer], { type: image.contentType }) })
    return { src: `murmur-image:${index}` }
  }),
})
```

Then a block-level walker turns each `<p>`, `<h1>`…`<h6>`, `<li>`, `<div>`,
`<blockquote>` into a paragraph string and each `<img src="murmur-image:N">`
into `[image:N]`.

**EPUB** is a ZIP of HTML files. `parseEpub` uses `jszip` to read the
container manifest at `META-INF/container.xml`, finds the content OPF file,
and walks its spine in reading order. For each chapter HTML file it walks
block elements and images with a TreeWalker, extracts inline images from
the ZIP, and appends `[image:N]` markers. The cover image is detected via
`manifest item[properties~="cover-image"]` or the legacy `meta name="cover"`
pointer:

```ts
let coverHref: string | null = null
const coverImageItem = opfDoc.querySelector('manifest item[properties~="cover-image"]')
if (coverImageItem) coverHref = coverImageItem.getAttribute('href')
else {
  const coverMeta = opfDoc.querySelector('metadata meta[name="cover"]')
  const coverId = coverMeta?.getAttribute('content')
  if (coverId) {
    const coverItem = opfDoc.querySelector(`manifest item[id="${coverId}"]`)
    coverHref = coverItem?.getAttribute('href') ?? null
  }
}
```

All of the parser paths produce inline image blobs. `pages/new.vue` uploads
them alongside the read so the reader can render them inline by fetching
`/api/images/:readId/:index`.

### 6.4 URL extractor

`frontend/utils/url-extractor.ts` is the client side of the URL flow. It
calls `/api/extract-url` (the server route from Part 5) to get the page
HTML, then runs Readability over it:

```ts
export async function extractArticle(url: string): Promise<ExtractedArticle> {
  const { html, thumbnailUrl } = await $fetch<{ html: string; thumbnailUrl: string | null }>(
    '/api/extract-url', { method: 'POST', body: { url } },
  )
  const doc = new DOMParser().parseFromString(html, 'text/html')

  // Set the base URL so relative links resolve correctly
  const base = doc.createElement('base')
  base.href = url
  doc.head.prepend(base)
  // ...
  const reader = new Readability(doc)
  const article = reader.parse()
  if (!article?.content) throw new Error('Could not extract article content from this URL')

  const { text, images } = htmlToText(article.content, url)
  return {
    title: pageTitle || article.title,
    content: text,
    excerpt: article.excerpt ?? undefined,
    siteName: article.siteName ?? undefined,
    thumbnailUrl: thumbnailUrl ?? undefined,
    images: images.length > 0 ? images : undefined,
  }
}
```

Two small decisions pay off here. First, the `<base href=url>` injection —
without it, relative image URLs like `src="/images/foo.jpg"` do not resolve
to absolute URLs. Second, Readability's output is run through another
`htmlToText` pass that replaces `<figure>` elements with `[image:N]`
markers before extracting prose. This preserves image placement in the
content stream, just like the PDF and EPUB paths do.

There is also explicit pre-processing to work around specific anti-patterns:
skeleton placeholders are removed so Readability does not pick them as the
article body, and `[hidden]` attributes are stripped so streaming SSR content
from Next.js pages becomes visible.

### 6.5 Client sentence splitter

`frontend/utils/sentence-splitter.ts` is the TypeScript port of the
orchestrator's splitter. It mirrors the same abbreviation list and the same
edge-case rules. The reason it exists on the client is so that `/new` can
show a "42 sentences, ~4 minutes reading time" preview *before* the user
clicks Create — at that point the content has not yet been POSTed to the
server and the server has no idea how many segments it will produce.

```ts
export function splitSentences(text: string): string[] {
  const sentences: string[] = []
  let current = ''
  const tokens = text.split(/(\s+)/)
  for (const token of tokens) {
    current += token
    const match = token.match(/^(.+?)([.!?]+)$/)
    if (!match) continue
    const word = match[1].toLowerCase().replace(/[^a-z.]/g, '')
    if (ABBREVIATIONS.has(word)) continue
    if (word.length === 1) continue
    if (/\d$/.test(match[1]) && match[2] === '.') continue
    const trimmed = current.trim()
    if (trimmed) { sentences.push(trimmed); current = '' }
  }
  const remaining = current.trim()
  if (remaining) sentences.push(remaining)
  return sentences
}
```

Having two implementations is the right tradeoff: once a read is created,
server splitting is canonical, so slight differences between the two do not
affect playback or alignment.

### 6.6 Audio player and WAV concat

`frontend/composables/useAudioPlayer.ts` is module-level singleton state —
there is exactly one `<audio>` element on the page at a time and the player
survives route transitions (the audio bar stays visible when the user
navigates away from the reader).

The central function is `playSegment`:

```ts
async function playSegment(index, startOffset?) {
  if (!import.meta.client) return
  const segment = segments.value[index]
  if (!segment?.audio_generated) return
  const url = `/api/audio/${segment.read_id}/${segment.segment_index}`
  currentSegmentIndex.value = index
  const el = ensureAudio()
  el.src = url
  el.defaultPlaybackRate = playbackRate.value
  el.playbackRate = playbackRate.value
  if (startOffset && startOffset > 0) {
    await new Promise<void>((resolve) => {
      const handler = () => { el.removeEventListener('loadedmetadata', handler); el.currentTime = startOffset; resolve() }
      el.addEventListener('loadedmetadata', handler)
    })
  }
  await el.play()
}
```

Key decisions:

- **Seeking with metadata.** Setting `currentTime` before `loadedmetadata`
  fires is a no-op in some browsers — the audio starts from 0. The
  `loadedmetadata` wait is the fix.
- **Re-apply playback rate on `playing`.** Some browsers reset the rate on
  `src` change; a `playing` listener re-applies it.
- **Image segments are skipped.** `findNextPlayable` walks past
  `[image:N]` segments when skipping forward/back or on natural `ended`
  advancement.
- **Cross-read invalidation.** `setSegments()` clears the cached per-segment
  duration map when the read id changes, because segments from one read are
  not comparable to another.

`estimateSegmentDuration` uses a words-per-minute heuristic until the browser
has actually loaded the audio for that segment, after which it stores the
real duration in a reactive Map. The `totalDuration` computed prop uses
these estimates so the scrubber shows a roughly-correct total immediately
and becomes accurate as the user plays through.

`frontend/utils/wav-concat.ts` is a small helper for the "download audio"
feature. Each segment is a 44-byte RIFF/WAVE header plus PCM data. To merge
them, we parse the first header to get sample rate/channels/bits-per-sample,
then write a new header and concatenate the PCM of each file (skipping the
44-byte headers):

```ts
export async function concatWavBlobs(blobs: Blob[]): Promise<Blob> {
  if (blobs.length === 0) throw new Error('No audio to export')
  if (blobs.length === 1) return blobs[0]
  const buffers = await Promise.all(blobs.map((b) => b.arrayBuffer()))
  const firstView = new DataView(buffers[0])
  const numChannels = firstView.getUint16(22, true)
  const sampleRate = firstView.getUint32(24, true)
  const bitsPerSample = firstView.getUint16(34, true)
  let totalDataSize = 0
  for (const buf of buffers) totalDataSize += buf.byteLength - 44
  const output = new ArrayBuffer(44 + totalDataSize)
  // ... write RIFF/fmt/data headers and PCM data ...
  return new Blob([output], { type: 'audio/wav' })
}
```

This assumes every segment has the same sample rate and channel layout,
which is true within a single engine. If the user regenerates with a
different engine mid-read, existing audio is wiped first (see the
regenerate path in Part 2.10) so the invariant holds.

### 6.7 Offline queue and background sync

The PWA has two moving parts for offline: a mutation queue in IndexedDB, and
a background sync that pre-downloads audio on a 15-minute timer.

`frontend/utils/offline-queue.ts` is a minimal IndexedDB wrapper with four
functions — `queueMutation`, `getAllMutations`, `removeMutation`, and
`clearMutations`. Each mutation is `{id, url, method, body?, timestamp}`.
Tests in `frontend/tests/utils/offline-queue.test.ts` pin the round-trip
behaviour using `fake-indexeddb`:

```ts
it('queues a mutation and retrieves it', async () => {
  await queueMutation({ url: '/api/reads/1', method: 'PATCH', body: { progress_segment: 5 } })
  const mutations = await getAllMutations()
  expect(mutations).toHaveLength(1)
  expect(mutations[0].url).toBe('/api/reads/1')
})

it('assigns unique ids to each mutation', async () => {
  await queueMutation({ url: '/api/reads/1', method: 'PATCH', body: {} })
  await queueMutation({ url: '/api/reads/1', method: 'PATCH', body: {} })
  const mutations = await getAllMutations()
  expect(mutations[0].id).not.toBe(mutations[1].id)
})
```

`fake-indexeddb` is wired in via `frontend/tests/setup.ts`, which is just
one line:

```ts
import 'fake-indexeddb/auto'
```

`useOffline` exposes `isOnline`, `isSyncing`, `pendingCount`, and the
`processQueue` replayer. `processQueue` has a neat optimisation for
progress updates: during a long offline session, the reader will have
enqueued a PATCH for every second of playback (`{progress_segment: 12}`,
`{progress_segment: 13}`, …). We deduplicate these down to the latest PATCH
per URL before replaying:

```ts
// Deduplicate progress updates: keep only the latest PATCH per URL
const latestPatch = new Map<string, OfflineMutation>()
const nonPatch: OfflineMutation[] = []
for (const m of mutations) {
  if (m.method === 'PATCH' && /\/api\/reads\/\d+$/.test(m.url)) {
    latestPatch.set(m.url, m)
  } else {
    nonPatch.push(m)
  }
}
const toProcess = [...nonPatch, ...latestPatch.values()]
```

`composables/useOffline.test.ts` pins navigator.onLine tracking:

```ts
it('updates when offline event fires', async () => {
  Object.defineProperty(navigator, 'onLine', { value: true, writable: true, configurable: true })
  const { useOffline } = await import('../../composables/useOffline')
  const { isOnline } = useOffline()
  Object.defineProperty(navigator, 'onLine', { value: false, writable: true, configurable: true })
  window.dispatchEvent(new Event('offline'))
  expect(isOnline.value).toBe(false)
})
```

`useBackgroundSync.ts` is the periodic downloader. Every fifteen minutes, if
online and enabled, it:

1. Warms the SSR HTML for `/` and each `/read/:id` so the PWA can navigate
   offline.
2. Fetches `/api/reads` to warm the list cache.
3. For each completed read, computes which segment WAVs are missing from the
   `audio-cache` Workbox cache.
4. Requests them in batches of 30 via `/api/audio/:readId/bundle?segments=...`,
   which the orchestrator serves as a single ZIP_STORED.
5. Unzips the bundle in the browser and writes each WAV into the audio cache
   under the same URL Workbox would cache them at (`/api/audio/:read/:seg`).

```ts
async function syncAudioBundle(readId, segmentIndices, signal) {
  const query = segmentIndices.join(',')
  const resp = await fetch(`/api/audio/${readId}/bundle?segments=${query}`, { signal })
  if (!resp.ok) return
  const blob = await resp.blob()
  const zip = await JSZip.loadAsync(blob)
  const cache = await caches.open(AUDIO_CACHE_NAME)
  for (const [filename, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue
    const segIndex = parseInt(filename.replace('.wav', ''), 10)
    if (isNaN(segIndex)) continue
    const data = await entry.async('arraybuffer')
    await cache.put(
      `/api/audio/${readId}/${segIndex}`,
      new Response(data, { headers: { 'Content-Type': 'audio/wav' } }),
    )
  }
}
```

There are two pauses built in: three seconds between reads and one second
between batches within a read. The sync is abortable — starting a new sync
cancels the previous one — and each batch has its own two-minute timeout so
a single slow download does not block the whole run.

### 6.8 PWA and Workbox

The PWA config in `frontend/nuxt.config.ts` configures `@vite-pwa/nuxt`. The
manifest gives the app its icon and name, and `workbox.runtimeCaching` sets
up cache strategies per URL pattern:

```ts
runtimeCaching: [
  // SSR HTML for offline navigation
  { urlPattern: /^https?:\/\/[^/]+\/(new|login|register|voices|settings|queue|read\/\d+)?(\?.*)?$/,
    handler: 'NetworkFirst',
    options: { cacheName: 'pages', networkTimeoutSeconds: 3, expiration: { maxEntries: 100 } } },

  // Individual audio segments — immutable once generated
  { urlPattern: /\/api\/audio\/\d+\/\d+$/,
    handler: 'CacheFirst',
    options: { cacheName: 'audio-cache', expiration: { maxEntries: 5000, maxAgeSeconds: 30*24*60*60 } } },

  // Reads list — network first, fall back to cache after 3s
  { urlPattern: /\/api\/reads(\?.*)?$/,
    handler: 'NetworkFirst', ... },

  // Read detail
  { urlPattern: /\/api\/reads\/\d+$/,
    handler: 'NetworkFirst', ... },

  // Bookmarks
  { urlPattern: /\/api\/reads\/\d+\/bookmarks/,
    handler: 'NetworkFirst', ... },

  // Voices
  { urlPattern: /\/api\/voices(\?.*)?$/,
    handler: 'StaleWhileRevalidate', ... },
],
```

The strategies are chosen per-content-type:

- **CacheFirst for audio** because a generated WAV never changes. We keep up
  to 5000 entries (~5 GB at 1 MB per segment, plenty for a serious library)
  for 30 days.
- **NetworkFirst for everything else** with a 3-second timeout — online users
  always see fresh data; offline users get last-seen data after 3 seconds.
- **StaleWhileRevalidate for voices** because the list changes rarely and
  showing the cache immediately is fine.

The `navigateFallback: null` is intentional: the generated service worker
does not install a fallback page for unknown routes, because `useFetch` in
SSR needs to handle 404s properly and a catch-all fallback would break the
auth redirect for `/login`.

The Nuxt dev server runs on port 4000 per `devServer.port`, and the build
binds to `HOST=0.0.0.0 PORT=3000` in Docker. Caddy proxies to `app:3000`.

## Part 7 — Caddy and Docker

A self-hosted PWA on a LAN wants two things: a trusted HTTPS certificate
(browsers reject service worker registration on plain HTTP) and a setup page
so people can install that certificate on their phones. Caddy does both.

`Caddyfile` has three blocks:

```caddy
{
    default_sni {$MURMUR_HOST}
    skip_install_trust
    auto_https disable_redirects
}

# HTTP — setup page + CA cert download
http://:80 {
    handle /ca.crt {
        root * /data/caddy/pki/authorities/local
        rewrite * /root.crt
        header Content-Type application/x-x509-ca-cert
        header Content-Disposition "attachment; filename=\"murmur-ca.crt\""
        file_server
    }
    handle {
        root * /srv
        try_files /setup.html
        file_server
    }
}

# HTTPS — main app
https://{$MURMUR_HOST} {
    tls internal

    # SSE endpoints need immediate flushing
    handle /api/backends/events {
        reverse_proxy app:3000 { flush_interval -1 }
    }
    handle /api/queue/events {
        reverse_proxy app:3000 { flush_interval -1 }
    }
    handle {
        reverse_proxy app:3000
    }
}
```

The `tls internal` directive tells Caddy to mint a self-signed certificate
via its built-in local CA. The CA's root certificate is saved to
`/data/caddy/pki/authorities/local/root.crt`, which the HTTP block exposes
at `/ca.crt`. The `/ca.crt` download is what the setup page points to.

`skip_install_trust` stops Caddy from trying to add its CA to the host's
trust store (no interactive prompts during container startup).
`auto_https disable_redirects` means HTTP requests do not auto-redirect to
HTTPS, which keeps the setup page reachable from a device that does not yet
trust the CA.

The SSE `handle` blocks with `flush_interval -1` are load-bearing. Without
them, Caddy buffers the response and SSE events are delivered in batches
every few seconds — unusable for progress bars. `-1` means flush every
write immediately. The default buffered flushing is preserved for all other
requests to avoid saturating the WiFi tx queue during bulk audio downloads.

The setup page at `caddy/setup.html` sniffs the user agent and shows iOS or
Android instructions for installing the CA, then a link to
`https://<LAN_IP>` with the actual app.

### Docker Compose

The production compose file is four services:

```yaml
services:
  caddy:
    image: caddy:2-alpine
    ports:
      - "${MURMUR_HTTP_PORT:-80}:80"
      - "${MURMUR_PORT:-443}:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - ./caddy/setup.html:/srv/setup.html:ro
      - caddy_data:/data
      - caddy_config:/config
    environment:
      - MURMUR_HOST=${MURMUR_HOST}
    depends_on:
      - app

  app:
    build: ./frontend
    ports:
      - "4000:3000"
    environment:
      - NUXT_ORCHESTRATOR_URL=http://orchestrator:8000
      - NUXT_JWT_SECRET=${MURMUR_JWT_SECRET:?MURMUR_JWT_SECRET must be set in .env}
    depends_on:
      orchestrator:
        condition: service_started

  orchestrator:
    build:
      context: .
      dockerfile: orchestrator/Dockerfile
      args:
        UID: ${UID:-1000}
        GID: ${GID:-1000}
    volumes:
      - ./data:/app/data
    environment:
      - MURMUR_JWT_SECRET=${MURMUR_JWT_SECRET:?MURMUR_JWT_SECRET must be set in .env}
      - MURMUR_ALIGN_URL=http://align:8001
      - MURMUR_DATA_DIR=/app/data
      - HF_TOKEN=${HF_TOKEN:-}
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
```

`align` is behind a `full` profile so `docker compose up` skips it; you opt
into WhisperX with `docker compose --profile full up`. The orchestrator's
dependency on `align` has `required: false` so it can still start when the
profile is disabled.

The frontend Dockerfile is a two-stage Node build:

```dockerfile
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
RUN apk update && apk upgrade --no-cache
WORKDIR /app
COPY --from=build /app/.output .output
ENV HOST=0.0.0.0
ENV PORT=3000
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
```

The orchestrator Dockerfile is more interesting — it pre-installs Pocket TTS
so the default engine is immediately usable on first boot:

```dockerfile
FROM python:3.12-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg libsndfile1 espeak-ng \
    build-essential cmake git \
    && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/

# Non-root runtime user. UID/GID are build args so the image can be rebuilt
# on hosts where the bind-mounted ./data is owned by a non-1000 UID.
ARG UID=1000
ARG GID=1000
RUN groupadd -g $GID app && useradd -u $UID -g $GID -m -d /home/app -s /bin/bash app
WORKDIR /app
RUN chown $UID:$GID /app
USER app
ENV HOME=/home/app
ENV PATH=/home/app/.local/bin:$PATH

COPY --chown=app:app orchestrator/pyproject.toml orchestrator/uv.lock orchestrator/
RUN cd orchestrator && uv sync --frozen --no-dev --no-install-project

# Pre-install Pocket TTS so first boot has a working engine
COPY tts-servers/pocket-tts-server/pyproject.toml tts-servers/pocket-tts-server/
RUN cd tts-servers/pocket-tts-server && uv venv
RUN cd tts-servers/pocket-tts-server && uv pip install --python .venv/bin/python \
    torch --index-url https://download.pytorch.org/whl/cpu
RUN cd tts-servers/pocket-tts-server && uv pip install --python .venv/bin/python \
    fastapi "pocket-tts>=1.1.1" python-multipart uvicorn

COPY orchestrator/ orchestrator/
COPY tts-servers/pocket-tts-server/ tts-servers/pocket-tts-server/

# Only lightweight source for optional engines; full install at runtime via UI
COPY tts-servers/xtts-server/main.py tts-servers/xtts-server/pyproject.toml \
     tts-servers/xtts-server/post_install.py tts-servers/xtts-server/
# ... same for f5tts, gptsovits, cosyvoice ...

# CosyVoice's inference code is a git clone, not a PyPI package
RUN git clone --depth 1 --recurse-submodules --shallow-submodules \
    https://github.com/FunAudioLLM/CosyVoice.git \
    tts-servers/cosyvoice-server/repo

ENV MURMUR_DATA_DIR=/app/data
ENV COQUI_TOS_AGREED=1
ENV TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD=1

EXPOSE 8000
CMD ["orchestrator/.venv/bin/uvicorn", "orchestrator.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

Six apt packages that no `pyproject.toml` mentions:

- `ffmpeg` — `transformers` ASR pipeline, F5-TTS audio processing
- `libsndfile1` — `soundfile`/`scipy` audio I/O
- `espeak-ng` — XTTS phoneme generation
- `build-essential` — `jieba-fast`, `pyopenjtalk` C extensions
- `cmake` — `pyopenjtalk` build
- `git` — installing LangSegment from GitHub (see Part 9)

The CMD uses the venv's `uvicorn` directly rather than `uv run` because it
is marginally faster and does not need to re-resolve deps on container
start.

The dev compose file is a one-file overlay:

```yaml
# docker-compose.dev.yml
services:
  caddy:
    profiles:
      - disabled
  app:
    build:
      context: ./frontend
      target: build
    command: npx nuxi dev --host 0.0.0.0 --port 3000
    ports:
      - "4000:3000"
    volumes:
      - ./frontend:/app
      - /app/node_modules
```

Running `docker compose -f docker-compose.yml -f docker-compose.dev.yml up`
disables Caddy, swaps the Nuxt start command for `nuxi dev`, and mounts the
frontend source so saves hot-reload. The `/app/node_modules` volume
override keeps the container's node_modules instead of shadowing them with
the host's.

## Part 8 — Testing Everything

There are three test suites. Run them from the repo root.

### Frontend (vitest + jsdom)

```bash
cd frontend && npm test
```

The tests live in `frontend/tests/`. Structure:

- `tests/setup.ts` — one line: `import 'fake-indexeddb/auto'`. This polyfills
  IndexedDB for the Node test environment.
- `tests/server/jwt.test.ts` — verifies `verifyToken` against `jose.SignJWT`
  outputs. Five cases: valid token returns the userId, expired throws,
  tampered signature throws, wrong secret throws, garbage input throws.
- `tests/utils/offline-queue.test.ts` — six cases covering the IndexedDB
  mutation queue: starts empty, round-trips a single mutation, holds
  multiple mutations concurrently, removes one by id, clears all, and
  assigns unique ids.
- `tests/composables/useOffline.test.ts` — five cases against the
  `useOffline` composable: reflects `navigator.onLine`, updates on `offline`
  and `online` events, exposes `isSyncing` as false initially, exposes
  `pendingCount` as 0 initially. Uses `@vitest-environment jsdom` and
  `vi.resetModules()` between tests because the composable has
  module-level state.

The vitest config aliases `~` to the frontend root so tests can use the same
imports as source:

```ts
// frontend/vitest.config.ts
export default defineConfig({
  resolve: { alias: { '~': resolve(__dirname) } },
  test: {
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
  },
})
```

### Orchestrator (pytest + httpx AsyncClient)

```bash
cd orchestrator && uv run pytest
```

Or, if you want to run a single test file:

```bash
cd orchestrator && uv run pytest tests/test_job_worker.py -v
```

The core fixtures are in `orchestrator/tests/conftest.py`. Three autouse
fixtures run for every test:

- `client` — the test's primary fixture. It redirects `DATA_DIR`, `DB_PATH`,
  `AUDIO_DIR`, and `VOICES_DIR` to a `tmp_path`, creates the directories,
  initializes the DB, and yields an `httpx.AsyncClient` wired to the
  FastAPI app via `ASGITransport`. No network, no filesystem leakage.
- `reset_engine_manager` — replaces the module-global `engine_manager`
  singleton with a fresh `EngineManager`, and patches every module that
  imports it directly (routers, job worker, main). Without this patch,
  tests would see engine state from other tests.
- `reset_job_event_bus` — same pattern for `JobEventBus`.
- `disable_job_worker` — replaces the module-global `job_worker` with an
  unstarted `JobWorker`, so it does not consume jobs during endpoint tests
  and does not try to call real engines.

```python
# conftest.py
@pytest_asyncio.fixture
async def client(tmp_path, monkeypatch):
    monkeypatch.setattr("orchestrator.config.DATA_DIR", tmp_path)
    monkeypatch.setattr("orchestrator.config.DB_PATH", tmp_path / "test.db")
    monkeypatch.setattr("orchestrator.config.AUDIO_DIR", tmp_path / "audio")
    monkeypatch.setattr("orchestrator.config.VOICES_DIR", tmp_path / "voices" / "cloned")
    (tmp_path / "audio").mkdir()
    (tmp_path / "voices" / "cloned").mkdir(parents=True)
    await init_db()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
```

Each test file pins one slice of behaviour:

- `test_auth.py` — register, duplicate-email, login, wrong password, /me with X-User-Id header.
- `test_reads.py` — create, list, get, patch, delete, and cross-user isolation
  (`test_user_isolation` creates a read as user A and confirms user B
  cannot see it).
- `test_generate.py` — all the guard clauses on `POST /reads/:id/generate`:
  no engine → 503, creates job with correct shape, honours `language`,
  rejects if read is missing → 404, rejects duplicate pending job → 409.
- `test_engine_registry.py` — the five engines are registered, `pocket-tts`
  defaults, every engine has `repo_dir`, `get_engine('nonexistent')` raises.
- `test_engine_manager.py` — initial status is AVAILABLE for all engines,
  `check_installed` detects an engine dir, `stop_engine` is a no-op when
  nothing is running, subscribe/unsubscribe on the listener queue, and
  emitted events reach subscribers.
- `test_job_events.py` — subscribe/emit round-trip, user isolation (emits
  only reach the target user), unsubscribe, multiple subscribers per user.
- `test_job_worker.py` — the biggest test file. Mocks `httpx.AsyncClient`
  via `unittest.mock.patch` to return canned TTS and alignment responses,
  then exercises: `_pick_next_job` picks FIFO order, `_process_segment`
  writes the WAV to disk and updates DB, `_process_job` runs all segments
  and emits `job:started` → `job:progress`* → `job:completed`, cancellation
  mid-run stops the loop after N segments, `waiting_for_backend` resumes
  when engine returns, TTS failure marks the segment failed, and — the
  important one — `test_alignment_failure_continues` proves alignment can
  fail without failing the segment.
- `test_queue.py` — list queue empty, list with job, cancel pending, cancel
  done → 409, cancel other user's job → 404, user isolation.
- `test_backends.py` — list backends, status is reflected, select unknown
  → 404, select not-installed → 503.
- `test_bookmarks.py` — add, list, update note, delete.
- `test_voices.py` — list empty, list includes builtin + user clones, delete
  own clone.
- `test_voices_sync.py` — `/voices/sync` with no engine → 503, with a mocked
  engine returns the engine's builtin list, clone with no engine → 503.
- `test_settings.py` — get empty, patch-then-get, user isolation.
- `test_sentence_splitter.py` — the simple, abbreviation, initial, decimal,
  empty, and no-punctuation cases.
- `test_startup_recovery.py` — `running` jobs reset to `pending`,
  `waiting_for_backend` jobs reset to `pending`, `done` jobs are not reset.
- `test_health.py` — `/health` returns `{status: 'ok', db: 'ok'}` with no
  active engine, and reflects the active engine name when one is set.

The mock pattern for job worker tests is worth copying. Instead of a full
httpx mock library, the tests use `AsyncMock` with a URL-routing side
effect:

```python
def _mock_httpx(tts_audio=b"RIFF" + b"\x00" * 100, align_words=None):
    if align_words is None:
        align_words = [{"word": "hello", "start": 0.0, "end": 0.5}]
    tts_resp = MagicMock()
    tts_resp.status_code = 200
    tts_resp.content = tts_audio
    tts_resp.raise_for_status = MagicMock()
    align_resp = MagicMock()
    align_resp.status_code = 200
    align_resp.json.return_value = {"words": align_words}
    align_resp.raise_for_status = MagicMock()
    mock_client = AsyncMock()

    async def route_post(url, **kwargs):
        if "/tts/generate" in url: return tts_resp
        if "/align" in url: return align_resp
        raise ValueError(f"Unexpected URL: {url}")

    mock_client.post = AsyncMock(side_effect=route_post)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    return mock_client
```

The `__aenter__`/`__aexit__` pair is what makes `async with
httpx.AsyncClient() as client:` work on the mock. Missing either one gives
you a very confusing `TypeError: object AsyncMock can't be used in 'await'`.

### Alignment server (pytest + httpx AsyncClient)

```bash
cd alignment-server && uv run pytest
```

Three tests in `alignment-server/tests/test_align.py`:

- `test_health` — `/health` returns 200 with `status: ok`.
- `test_align_returns_words` — monkeypatches `run_alignment` to avoid loading
  WhisperX, then posts a minimal valid WAV header and confirms the canned
  words come back.
- `test_align_missing_audio` and `test_align_missing_text` — FastAPI returns
  422 for missing multipart fields.

The minimal 44-byte WAV header in the tests is worth keeping in your back
pocket:

```python
wav_header = (
    b"RIFF" + (36).to_bytes(4, "little") + b"WAVE"
    b"fmt " + (16).to_bytes(4, "little")
    + (1).to_bytes(2, "little")   # PCM
    + (1).to_bytes(2, "little")   # mono
    + (24000).to_bytes(4, "little")  # sample rate
    + (48000).to_bytes(4, "little")  # byte rate
    + (2).to_bytes(2, "little")   # block align
    + (16).to_bytes(2, "little")  # bits per sample
    + b"data" + (0).to_bytes(4, "little")
)
```

## Part 9 — Gotchas and Why

The ML/Python dependency stack is the single biggest source of complexity in
Murmur. Before you ship this to anyone else, burn the following into your
memory.

**`torch.load` weights_only.** PyTorch 2.6 flipped `torch.load`'s default to
`weights_only=True`, which refuses to unpickle Python objects. Coqui TTS
stores its `XttsConfig` as a pickle. So does GPT-SoVITS's checkpoint
loader. The fix is `TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD=1` in every engine
subprocess environment (set in `engine_manager.start_engine`) plus the
belt-and-suspenders monkey-patch at the top of `xtts-server/main.py` and
`gptsovits-server/main.py`:

```python
_orig_load = torch.load
torch.load = lambda *a, **kw: _orig_load(*a, **{**kw, "weights_only": False})
```

**Coqui CPML prompt.** First time you load an XTTS or CosyVoice model,
Coqui calls `input()` asking you to agree to their non-commercial license.
Inside a headless Docker subprocess with no stdin that becomes `EOFError:
EOF when reading a line` and the engine dies. Pre-accept by setting
`COQUI_TOS_AGREED=1` in the environment. There is no mention of this env
var in the Coqui README — you have to find it by reading the source.

**Torchcodec.** The single worst offender. It is a "native CUDA audio
decoder" that recent `torchaudio>=2.6` and `transformers` ASR pipelines pull
in transitively. On a CPU-only host it fails with `OSError: libcudart.so.13:
cannot open shared object file`. The fix is three-part:

1. Pin `torchaudio<2.6` when installing engines so the older CPU audio path
   is used.
2. Install torch from the CPU index
   (`--index-url https://download.pytorch.org/whl/cpu`) on CPU-only hosts,
   detected via `shutil.which("nvidia-smi")`.
3. After `uv pip install --requirement pyproject.toml`, unconditionally
   `uv pip uninstall torchcodec` in case it got pulled in transitively.

This `uv pip uninstall torchcodec` step is now standard in
`EngineManager.install_engine`.

**CosyVoice's sys.path dance.** CosyVoice's inference code is not a PyPI
package — it is a GitHub repo. The `main.py` has to insert two paths into
`sys.path` before importing:

```python
REPO_DIR = Path(__file__).parent / "repo"
sys.path.insert(0, str(REPO_DIR))
sys.path.insert(0, str(REPO_DIR / "third_party" / "Matcha-TTS"))
from cosyvoice.cli.cosyvoice import CosyVoice2
```

The Dockerfile clones this at build time:

```dockerfile
RUN git clone --depth 1 --recurse-submodules --shallow-submodules \
    https://github.com/FunAudioLLM/CosyVoice.git \
    tts-servers/cosyvoice-server/repo
```

Originally this directory was in `.dockerignore` (next to model directories),
which meant the `COPY` would succeed but the runtime import would fail.

**post_install pipe deadlock.** When installing CosyVoice, the orchestrator
used to run `post_install.py` with `stdout=PIPE, stderr=PIPE` and then `await
proc.wait()`. ModelScope's download progress bars for a 5.8 GB model
produced enough output to fill the 64 KB OS pipe buffer. The subprocess
blocked on write, the orchestrator blocked on wait, classic deadlock. The
current `install_engine` does not capture stdout — it lets the engine's
download progress stream through to container logs:

```python
proc = await asyncio.create_subprocess_exec(
    venv_python, str(post_install),
    cwd=str(engine_dir), env=env,
    # no stdout/stderr kwargs — inherit from parent
)
await proc.wait()
```

**Lazy model downloads are a UX bug.** Every TTS library defaults to
downloading model weights on first inference. The user clicks "generate"
and waits five minutes staring at a spinner. Every engine has a
`post_install.py` that pre-downloads every artifact: model checkpoints,
vocoders, Whisper ASR, NLTK data, HuggingFace model directories. Do this.

**ffmpeg must be on PATH.** F5-TTS's auto-transcription uses the
transformers ASR pipeline, which shells out to `ffmpeg` to decode audio.
`python:3.12-slim` does not ship ffmpeg. Add `ffmpeg` to the orchestrator
Dockerfile's apt install list.

**SSE flush intervals.** Caddy buffers reverse-proxy responses by default.
SSE events delivered in 5-second batches are unusable. The Caddyfile
explicitly sets `flush_interval -1` on `/api/backends/events` and
`/api/queue/events`:

```caddy
handle /api/queue/events {
    reverse_proxy app:3000 { flush_interval -1 }
}
```

The SSE endpoints in the browser open and close on
`document.visibilitychange` to avoid browser-mandated dead connections on
backgrounded tabs. Every SSE consumer (`useGeneration`, `useQueue`,
`useBackends`) implements the same pattern.

**The orchestrator must be run from the repo root.** `orchestrator/main.py`
imports as `import orchestrator.config`. If you `cd orchestrator && uvicorn
main:app`, Python has no package root to resolve against and imports
explode. Always run:

```bash
uv --project orchestrator run uvicorn orchestrator.main:app --port 8000
```

## Part 10 — Running Everything

Put it all together. In dev mode you want four terminals.

**Terminal 1 — Orchestrator:**

```bash
uv --project orchestrator run uvicorn orchestrator.main:app --port 8000
```

The orchestrator auto-starts `pocket-tts` from `tts-servers/pocket-tts-server/`
if it finds a `.venv/bin/uvicorn` there. If not, use the engine installer UI
(or do it manually):

```bash
cd tts-servers/pocket-tts-server
uv venv
uv pip install --python .venv/bin/python fastapi "pocket-tts>=1.1.1" python-multipart uvicorn
.venv/bin/python post_install.py   # downloads the 400 MB model
```

**Terminal 2 — Alignment server (optional):**

```bash
cd alignment-server && uv run uvicorn main:app --port 8001
```

First run downloads the WhisperX alignment model (~2 GB into the HuggingFace
cache).

**Terminal 3 — Frontend dev server:**

```bash
cd frontend && npm install && npm run dev
```

The dev server listens on port 4000 (`frontend/nuxt.config.ts` has
`devServer.port: 4000`). Open <http://localhost:4000>, register, paste some
text into `/new`, and click Create.

**Terminal 4 — run the tests as you work:**

```bash
cd frontend && npm run test:watch                       # frontend watch mode
uv --project orchestrator run pytest orchestrator/tests  # orchestrator once
cd alignment-server && uv run pytest                     # alignment once
```

### Running as a standalone TTS engine

If you just want to play with a single engine without the orchestrator:

```bash
cd tts-servers/pocket-tts-server
uv run uvicorn main:app --port 8000
curl http://localhost:8000/tts/voices
curl -X POST -H 'Content-Type: application/json' \
     -d '{"text":"Hello, world.","voice":"alba"}' \
     http://localhost:8000/tts/generate -o hello.wav
```

### Running with Docker

Copy the example env file and set the two required values. `MURMUR_JWT_SECRET`
is mandatory — compose refuses to start without it:

```bash
cp .env.example .env
# Edit .env:
#   MURMUR_HOST=<your-LAN-IP>
#   MURMUR_JWT_SECRET=<paste the output of:  openssl rand -base64 48>
```

The orchestrator container runs as a non-root user (UID 1000 / GID 1000 by
default) and bind-mounts `./data` from the host. On a single-user Linux
install this usually just works. If your host UID differs (`id -u`), either
override the build args in `.env` (uncomment `UID=` / `GID=`) and rebuild, or
chown the data directory to match the container user before first run:

```bash
mkdir -p data && sudo chown 1000:1000 data
# …or, to build the image for your current host user:
UID=$(id -u) GID=$(id -g) docker compose up --build
```

Minimal production stack (Caddy + app + orchestrator):

```bash
docker compose up --build
```

Full stack (with WhisperX alignment):

```bash
docker compose --profile full up --build
```

Dev overrides (no Caddy, hot reload on frontend):

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

First-time phone setup: visit `http://<LAN_IP>` over HTTP to download
`ca.crt`, install it on the device, then open `https://<LAN_IP>` to install
the PWA. Note that the app itself must be accessed over HTTPS: a production
build marks the auth cookie `Secure`, so `http://<LAN_IP>:4000` (the
bypass-Caddy port) will appear to log in and then immediately drop the
cookie. Plain HTTP only works against `nuxi dev`.

That is Murmur from the bottom up. Five TTS engines, one orchestrator, one
alignment server, one BFF, one PWA, one Caddy reverse proxy, and all of the
tests that keep it honest. Go build it.
