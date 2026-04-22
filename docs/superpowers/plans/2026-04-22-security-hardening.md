# Security Hardening + CI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the 10 security criticals found in the 2026-04-21 audit, wire CI so regressions don't ship, and document every remaining minor issue as a tracked backlog.

**Architecture:** Mostly surgical fixes to existing FastAPI routers and one Nitro endpoint. Tenant isolation is added by adding `Depends(get_current_user_id)` + an ownership query to every route that touches per-user data. Defensive defaults (fail-closed JWT secret, Secure cookies, rate limits) are added where they're missing. CI runs the full lint+typecheck+test matrix on PRs.

**Tech Stack:** FastAPI + aiosqlite (orchestrator), Nuxt 3 / Nitro (frontend BFF), GitHub Actions (CI).

---

## 0. Start here (first 10 minutes)

You are walking into this cold. Before writing any code:

1. **Read the audit context.** The previous session produced a red-flag list. The 25 findings are summarized in-line in this plan; the full audit is captured in the parent commit history and `CLAUDE.md`. Do not re-audit — trust the list below and focus on execution.
2. **Sanity-check your environment.** Run these to make sure you can execute and test:

   ```bash
   # Orchestrator
   cd /home/john/repos/murmur-tts-reader/orchestrator
   uv sync --quiet
   uv run python -m pytest tests --ignore=tests/test_engine_manager.py -q
   # Expected: 69 passed. test_engine_manager is pre-existing broken — ignore it.

   # Frontend
   cd /home/john/repos/murmur-tts-reader/frontend
   npm ci
   npx nuxi typecheck
   npm run test
   # Expected: typecheck clean, 16/16 vitest passing.
   ```

3. **Read these files before starting.** You'll touch all of them:
   - `orchestrator/main.py` (routes: `/audio/*`, `/thumbnails/*`, `/reads/*/images`, `/reads/*/thumbnail`)
   - `orchestrator/routers/voices.py` (voice clone path-traversal)
   - `orchestrator/routers/backends.py` (missing auth)
   - `orchestrator/routers/auth_router.py` (rate limit target, email logging)
   - `orchestrator/auth.py` + `orchestrator/config.py` (JWT fail-closed)
   - `orchestrator/models.py` (EmailStr + password policy)
   - `orchestrator/tests/conftest.py` (fixtures — use `client` as-is)
   - `frontend/server/utils/orchestrator.ts` (cookie Secure flag)
   - `frontend/server/api/extract-url.post.ts` (SSRF)
   - `frontend/nuxt.config.ts` (JWT fail-closed mirror)

4. **Git discipline.** Commit atomically — one logical change per commit. Match repo style: sentence-case, imperative, no prefix (look at `git log --oneline -20`). Do not add `Co-Authored-By` trailers. Do not push — just commit locally.

5. **Budget.** This plan is scoped for ~3 hours. Tasks 1-9 are the security criticals (hours 1-2). Tasks 10-11 are CI (hour 3). If you run over, stop at Task 9 and commit what you have — the criticals matter more than CI.

---

## 1. Decisions to confirm with the user before starting

**Ask these as a batched question before any code runs.** Do not guess — the user has asked to be consulted on these.

1. **Rate-limit implementation (Task 7).** Two options:
   - (a) Add `slowapi` dep — idiomatic FastAPI, ~5 LOC per route
   - (b) Hand-rolled sliding window in `orchestrator/auth.py` — no new dep, ~40 LOC
   Recommend (a); confirm or pick (b).

2. **JWT fail-closed marker (Task 3).** Two options:
   - (a) Raise on import if `MURMUR_JWT_SECRET` is unset AND `MURMUR_ALLOW_DEV_SECRET != "1"` — strictest, forces explicit dev opt-in
   - (b) Raise only if unset AND `os.environ.get("ENV") == "production"` — more permissive
   Recommend (a). Also need to mirror in `frontend/nuxt.config.ts` (the Nitro side). Confirm.

3. **Secure cookie detection (Task 4).** Two options:
   - (a) Read `NODE_ENV === 'production'` — standard Node convention
   - (b) New env var `MURMUR_SECURE_COOKIE=1` — explicit
   Recommend (a).

4. **CI provider (Task 10).** Assumed GitHub Actions — confirm. If something else, stop and ask.

5. **Pre-commit (Task 11).** Optional. Worth 15 min? Confirm yes/no.

6. **Email logging redaction (Task 9).** `routers/auth_router.py` logs `req.email` on login/register. Two options:
   - (a) Drop emails from info/warning logs entirely, keep only `user_id` where available
   - (b) Redact to `t***@e***.com`
   Recommend (a).

If the user says "your call" for any of these, default to the recommendation above and note it in the commit message.

---

## 2. File map

Files you will create:

- `.github/workflows/ci.yml` — CI workflow
- `orchestrator/tests/test_tenant_isolation.py` — new test file for the cross-tenant tests in Tasks 1-2

Files you will modify:

- `orchestrator/main.py` — add auth to `/audio/*`, `/thumbnails/*`, `/reads/*/images`, `/reads/*/thumbnail` (Tasks 1-2)
- `orchestrator/routers/voices.py` — voice name validation (Task 5)
- `orchestrator/routers/backends.py` — add auth to mutating routes (Task 6)
- `orchestrator/routers/auth_router.py` — rate limit + drop email logging (Tasks 7, 9)
- `orchestrator/auth.py` + `orchestrator/config.py` — fail-closed JWT (Task 3)
- `orchestrator/models.py` — `EmailStr` + password min-length (Task 8)
- `orchestrator/pyproject.toml` — add `email-validator` (and `slowapi` if decision 1a)
- `frontend/server/utils/orchestrator.ts` — `secure: true` when prod (Task 4)
- `frontend/server/api/extract-url.post.ts` — SSRF guard (Task 2b)
- `frontend/nuxt.config.ts` — fail-closed JWT mirror (Task 3)

Files you will delete from the index:

- `pocket-tts.db` — `git rm --cached` (Task 9b)

---

## Task 1: Tenant isolation on audio endpoints

**Why:** Today, any logged-in user can fetch any other user's audio by guessing `read_id` (auto-increment int). This is the #1 finding from the audit.

**Files:**
- Modify: `orchestrator/main.py:108-155` (`serve_audio_bundle`, `serve_audio`)
- Create: `orchestrator/tests/test_tenant_isolation.py`

- [ ] **Step 1: Write the failing tests**

Create `orchestrator/tests/test_tenant_isolation.py`:

```python
import pytest
from pathlib import Path

pytestmark = pytest.mark.anyio


async def _register(client, email: str) -> int:
    res = await client.post("/auth/register", json={"email": email, "password": "secret123"})
    assert res.status_code == 201
    return res.json()["user"]["id"]


async def _create_read(client, user_id: int, title: str = "t") -> int:
    res = await client.post(
        "/reads",
        headers={"X-User-Id": str(user_id)},
        json={"title": title, "content": "Hello world."},
    )
    assert res.status_code == 200
    return res.json()["id"]


def _write_fake_audio(config_audio_dir: Path, read_id: int, seg_index: int = 0):
    d = config_audio_dir / str(read_id)
    d.mkdir(parents=True, exist_ok=True)
    (d / f"{seg_index}.wav").write_bytes(b"RIFF...fakewav")


async def test_cannot_fetch_other_users_audio_segment(client, tmp_path):
    alice = await _register(client, "alice@example.com")
    bob = await _register(client, "bob@example.com")
    alice_read = await _create_read(client, alice, "alice-secret")
    _write_fake_audio(tmp_path / "audio", alice_read, 0)

    res = await client.get(
        f"/audio/{alice_read}/0",
        headers={"X-User-Id": str(bob)},
    )
    assert res.status_code == 404


async def test_cannot_fetch_other_users_audio_bundle(client, tmp_path):
    alice = await _register(client, "alice@example.com")
    bob = await _register(client, "bob@example.com")
    alice_read = await _create_read(client, alice, "alice-secret")
    _write_fake_audio(tmp_path / "audio", alice_read, 0)

    res = await client.get(
        f"/audio/{alice_read}/bundle",
        headers={"X-User-Id": str(bob)},
    )
    assert res.status_code == 404


async def test_owner_can_fetch_their_audio(client, tmp_path):
    alice = await _register(client, "alice@example.com")
    alice_read = await _create_read(client, alice)
    _write_fake_audio(tmp_path / "audio", alice_read, 0)

    res = await client.get(
        f"/audio/{alice_read}/0",
        headers={"X-User-Id": str(alice)},
    )
    assert res.status_code == 200
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd orchestrator
uv run python -m pytest tests/test_tenant_isolation.py -v
```

Expected: `test_cannot_fetch_other_users_*` both FAIL with status 200 (leak confirmed). `test_owner_can_fetch_their_audio` currently passes by luck — serve_audio has no auth, so bob's header is ignored and the file is served.

- [ ] **Step 3: Add ownership check to serve_audio and serve_audio_bundle**

In `orchestrator/main.py`, add these imports at the top near the existing ones:

```python
import aiosqlite
from orchestrator.auth import get_current_user_id
from orchestrator.db import get_db
```

(`Depends` is already imported via `fastapi`.) Add `Depends` to the import if it's missing.

Replace `serve_audio` (currently `orchestrator/main.py:150-155`) with:

```python
@app.get("/audio/{read_id}/{segment_index}")
async def serve_audio(
    read_id: int,
    segment_index: int,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db),
):
    rows = await db.execute_fetchall(
        "SELECT 1 FROM reads WHERE id = ? AND user_id = ?", (read_id, user_id)
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Audio not found")
    path = config.AUDIO_DIR / str(read_id) / f"{segment_index}.wav"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Audio not found")
    return FileResponse(path, media_type="audio/wav")
```

Replace `serve_audio_bundle` (currently `orchestrator/main.py:108-147`) signature and first lines with:

```python
@app.get("/audio/{read_id}/bundle")
async def serve_audio_bundle(
    read_id: int,
    segments: str | None = None,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Serve audio segments for a read as a single zip (ZIP_STORED).

    If ``segments`` is provided (comma-separated indices), only those
    segments are included.  Otherwise all generated segments are bundled.
    """
    rows = await db.execute_fetchall(
        "SELECT 1 FROM reads WHERE id = ? AND user_id = ?", (read_id, user_id)
    )
    if not rows:
        raise HTTPException(status_code=404, detail="No audio found")

    import io
    import zipfile
    # ...rest of function unchanged
```

Note: `Depends`, `FastAPI`, `HTTPException`, `Request` are already imported at the top of `main.py` (line 3). Do not re-import them.

- [ ] **Step 4: Run tests to verify they pass**

```bash
uv run python -m pytest tests/test_tenant_isolation.py -v
uv run python -m pytest tests --ignore=tests/test_engine_manager.py -q
```

Expected: the three new tests pass; total passes jumps to 72.

- [ ] **Step 5: Commit**

```bash
git add orchestrator/main.py orchestrator/tests/test_tenant_isolation.py
git commit -m "Require read ownership to fetch audio segments and bundles

Previously /audio/{read_id}/* served files based on read_id alone, so
any authenticated user could fetch any other user's generated audio by
guessing the auto-increment id. Adds a user_id ownership check before
the filesystem read."
```

---

## Task 2: Tenant isolation on thumbnail + image endpoints

**Why:** Same class of bug as Task 1, four more routes: `/reads/{read_id}/thumbnail` (POST), `/thumbnails/{read_id}` (GET), `/reads/{read_id}/images` (POST), `/images/{read_id}/{index}` (GET).

**Files:**
- Modify: `orchestrator/main.py:164-210` (thumbnail routes) and `orchestrator/main.py:262-323` (image routes)
- Modify: `orchestrator/tests/test_tenant_isolation.py`

- [ ] **Step 1: Extend the tenant-isolation tests**

Append to `orchestrator/tests/test_tenant_isolation.py`:

```python
async def test_cannot_fetch_other_users_thumbnail(client, tmp_path):
    alice = await _register(client, "alice@example.com")
    bob = await _register(client, "bob@example.com")
    alice_read = await _create_read(client, alice)
    (tmp_path / "thumbnails").mkdir(exist_ok=True)
    (tmp_path / "thumbnails" / f"{alice_read}.jpg").write_bytes(b"fakejpeg")

    res = await client.get(
        f"/thumbnails/{alice_read}",
        headers={"X-User-Id": str(bob)},
    )
    assert res.status_code == 404


async def test_cannot_overwrite_other_users_thumbnail(client):
    alice = await _register(client, "alice@example.com")
    bob = await _register(client, "bob@example.com")
    alice_read = await _create_read(client, alice)

    res = await client.post(
        f"/reads/{alice_read}/thumbnail",
        headers={"X-User-Id": str(bob), "Content-Type": "application/json"},
        json={"url": "http://example.com/x.jpg"},
    )
    assert res.status_code == 404


async def test_cannot_fetch_other_users_image(client, tmp_path):
    alice = await _register(client, "alice@example.com")
    bob = await _register(client, "bob@example.com")
    alice_read = await _create_read(client, alice)
    img_dir = tmp_path / "images" / str(alice_read)
    img_dir.mkdir(parents=True, exist_ok=True)
    (img_dir / "0.jpg").write_bytes(b"fakejpeg")

    res = await client.get(
        f"/images/{alice_read}/0",
        headers={"X-User-Id": str(bob)},
    )
    assert res.status_code == 404
```

Note on fixtures: the `client` fixture in `conftest.py:11` monkeypatches `DATA_DIR`, `DB_PATH`, `AUDIO_DIR`, and `VOICES_DIR` but **not** `THUMBNAILS_DIR` or `IMAGES_DIR`. Add these two lines inside the `client` fixture before `init_db()`:

```python
monkeypatch.setattr("orchestrator.config.THUMBNAILS_DIR", tmp_path / "thumbnails")
monkeypatch.setattr("orchestrator.config.IMAGES_DIR", tmp_path / "images")
(tmp_path / "thumbnails").mkdir()
(tmp_path / "images").mkdir()
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
uv run python -m pytest tests/test_tenant_isolation.py -v
```

Expected: three new tests fail (wrong status code — fetches succeed or return wrong error).

- [ ] **Step 3: Add ownership helper and apply to all four routes**

Add near the top of `orchestrator/main.py` (after the `_ext_from_content_type` helper, around line 218):

```python
async def _assert_read_owned(
    read_id: int,
    user_id: int,
    db: aiosqlite.Connection,
) -> None:
    """404 if read_id doesn't belong to user_id. Use before serving/writing
    any filesystem artifact scoped by read_id."""
    rows = await db.execute_fetchall(
        "SELECT 1 FROM reads WHERE id = ? AND user_id = ?", (read_id, user_id)
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Not found")
```

Then wire it into:

- `upload_thumbnail` (`main.py:164`) — add `user_id`, `db` deps and call `await _assert_read_owned(read_id, user_id, db)` first.
- `serve_thumbnail` (`main.py:204`) — same.
- `upload_read_image` (`main.py:262`) — same.
- `serve_read_image` (`main.py:316`) — same.

Each handler keeps its existing body; the ownership check goes as the very first line after any content-type branching.

Also: update `serve_audio` and `serve_audio_bundle` from Task 1 to use `_assert_read_owned` instead of the inline query — DRY.

- [ ] **Step 4: Run all tests**

```bash
uv run python -m pytest tests --ignore=tests/test_engine_manager.py -q
```

Expected: all tenant tests pass, no regressions elsewhere.

- [ ] **Step 5: Verify frontend still works**

Before committing, confirm the frontend consumers still succeed as the owner. In `frontend/`:

```bash
npm run test
npx nuxi typecheck
```

Also spot-check these call sites (just reading — no edits):
- `frontend/composables/useAudioPlayer.ts:88`
- `frontend/composables/useBackgroundSync.ts:44,58,100`
- `frontend/components/LibraryCard.vue:9`
- `frontend/pages/new.vue:213,215,223,225`
- `frontend/pages/read/[id].vue:184`

All of these call the endpoints via the Nitro BFF, which injects `X-User-Id`. They should Just Work because we're adding `Depends(get_current_user_id)` which reads that same header.

- [ ] **Step 6: Commit**

```bash
git add orchestrator/main.py orchestrator/tests/test_tenant_isolation.py orchestrator/tests/conftest.py
git commit -m "Require read ownership for thumbnail and image endpoints

Adds a shared _assert_read_owned helper and applies it to the four
remaining per-read filesystem routes. Closes the cross-tenant read/write
hole on thumbnails and inline images identified in the 2026-04-21 audit."
```

---

## Task 3: Fail-closed JWT secret

**Why:** Both orchestrator and Nitro currently default to `"dev-secret-change-in-production"` (31 bytes, also triggers `InsecureKeyLengthWarning`). A missing env var in prod silently yields forgeable tokens.

**Files:**
- Modify: `orchestrator/config.py:10`
- Modify: `frontend/nuxt.config.ts:21`

- [ ] **Step 1: Write the failing test**

Append to `orchestrator/tests/test_auth.py`:

```python
def test_config_rejects_missing_secret_in_production(monkeypatch):
    """JWT_SECRET must refuse the dev fallback unless explicitly opted in."""
    import importlib
    monkeypatch.delenv("MURMUR_JWT_SECRET", raising=False)
    monkeypatch.delenv("MURMUR_ALLOW_DEV_SECRET", raising=False)
    import orchestrator.config as cfg
    with pytest.raises(RuntimeError, match="MURMUR_JWT_SECRET"):
        importlib.reload(cfg)
    # Cleanup: restore the module with a dev opt-in so other tests don't break
    monkeypatch.setenv("MURMUR_ALLOW_DEV_SECRET", "1")
    importlib.reload(cfg)
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
uv run python -m pytest tests/test_auth.py::test_config_rejects_missing_secret_in_production -v
```

Expected: FAIL (no RuntimeError is raised).

- [ ] **Step 3: Edit `orchestrator/config.py`**

Replace the JWT section:

```python
JWT_SECRET = os.environ.get("MURMUR_JWT_SECRET")
if not JWT_SECRET:
    if os.environ.get("MURMUR_ALLOW_DEV_SECRET") == "1":
        JWT_SECRET = "dev-secret-change-in-production-ONLY-for-local-dev"
    else:
        raise RuntimeError(
            "MURMUR_JWT_SECRET is not set. Set a 32+ byte random secret "
            "(see .env.example), or set MURMUR_ALLOW_DEV_SECRET=1 for "
            "local development."
        )
if len(JWT_SECRET) < 32:
    # Don't crash on length — just warn. Some dev flows still need shorter keys.
    import logging
    logging.getLogger(__name__).warning(
        "MURMUR_JWT_SECRET is shorter than 32 bytes; this triggers "
        "jwt's InsecureKeyLengthWarning and weakens HS256."
    )
```

- [ ] **Step 4: Update the test fixture environment**

The `client` fixture and all test runs need `MURMUR_ALLOW_DEV_SECRET=1` set or a real secret. Add this to `orchestrator/pyproject.toml` under the existing `[tool.pytest.ini_options]` section (check the file first — it likely has one):

```toml
[tool.pytest.ini_options]
# ...existing settings...
env = [
    "MURMUR_ALLOW_DEV_SECRET=1",
]
```

If `pytest-env` isn't in dev deps, add it (`uv add --dev pytest-env`). Alternative if you'd rather not add a dep: `export MURMUR_ALLOW_DEV_SECRET=1` in a `conftest.py` module-level `os.environ.setdefault` call.

- [ ] **Step 5: Run all tests**

```bash
uv run python -m pytest tests --ignore=tests/test_engine_manager.py -q
```

Expected: all pass.

- [ ] **Step 6: Mirror in Nitro**

Edit `frontend/nuxt.config.ts:19-22`. Replace:

```ts
runtimeConfig: {
  orchestratorUrl: 'http://localhost:8000',
  jwtSecret: 'dev-secret-change-in-production',
},
```

with:

```ts
runtimeConfig: {
  orchestratorUrl: 'http://localhost:8000',
  jwtSecret: '',  // must be set via NUXT_JWT_SECRET env var
},
```

Then edit `frontend/server/middleware/auth.ts:29` to assert non-empty:

```ts
try {
  const config = useRuntimeConfig(event)
  if (!config.jwtSecret) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Server misconfigured: NUXT_JWT_SECRET is unset',
    })
  }
  const userId = await verifyToken(token, config.jwtSecret)
  event.context.userId = userId
} catch {
  throw createError({ statusCode: 401, statusMessage: 'Invalid token' })
}
```

Note: the catch-all `catch {}` will eat the 500 and return 401. That's actually fine for the security model (don't reveal config state). But swap to:

```ts
} catch (err: any) {
  if (err.statusCode === 500) throw err
  throw createError({ statusCode: 401, statusMessage: 'Invalid token' })
}
```

- [ ] **Step 7: Typecheck + test frontend**

```bash
cd frontend
npx nuxi typecheck
npm run test
```

Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add orchestrator/config.py orchestrator/tests/test_auth.py orchestrator/pyproject.toml frontend/nuxt.config.ts frontend/server/middleware/auth.ts
git commit -m "Fail closed when MURMUR_JWT_SECRET is unset

Previously the orchestrator and Nitro middleware both defaulted to a
31-byte literal dev secret, so a forgotten env var in production
produced forgeable tokens. Now requires an explicit
MURMUR_ALLOW_DEV_SECRET=1 opt-in for local dev."
```

---

## Task 4: Secure cookie flag in production

**Why:** `authCookieOptions()` hard-codes `secure: false`, so the auth cookie is transmitted over HTTP even behind Caddy HTTPS.

**Files:**
- Modify: `frontend/server/utils/orchestrator.ts:32-40`

- [ ] **Step 1: Edit `authCookieOptions`**

Replace the function with:

```ts
export function authCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 72 * 60 * 60, // 72 hours — matches orchestrator JWT_EXPIRY_HOURS
  }
}
```

- [ ] **Step 2: Run typecheck + tests**

```bash
cd frontend
npx nuxi typecheck
npm run test
```

- [ ] **Step 3: Commit**

```bash
git add frontend/server/utils/orchestrator.ts
git commit -m "Mark auth cookie Secure when NODE_ENV=production

Caddy terminates TLS for production deployments, so transmitting the
cookie over plain HTTP would be a downgrade leak. Dev stays on :4000
(plain http) so secure stays off there."
```

---

## Task 5: Voice name validation

**Why:** `clone_voice` writes `VOICES_DIR/{user_id}/{name}.wav` with `name` straight from form input. `name="../../../../etc/passwd"` escapes the user dir.

**Files:**
- Modify: `orchestrator/routers/voices.py:83-128`
- Modify: `orchestrator/tests/test_voices.py` (append)

- [ ] **Step 1: Write the failing test**

Append to `orchestrator/tests/test_voices.py`:

```python
async def test_voice_clone_rejects_path_traversal(client):
    reg = await client.post("/auth/register", json={"email": "t@example.com", "password": "pw12345678"})
    user_id = reg.json()["user"]["id"]

    files = {"file": ("x.wav", b"RIFF...", "audio/wav")}
    data = {"name": "../../../../etc/passwd"}
    res = await client.post(
        "/voices/clone",
        headers={"X-User-Id": str(user_id)},
        files=files,
        data=data,
    )
    assert res.status_code == 400


async def test_voice_clone_rejects_empty_name(client):
    reg = await client.post("/auth/register", json={"email": "t2@example.com", "password": "pw12345678"})
    user_id = reg.json()["user"]["id"]
    files = {"file": ("x.wav", b"RIFF...", "audio/wav")}
    res = await client.post(
        "/voices/clone",
        headers={"X-User-Id": str(user_id)},
        files=files,
        data={"name": ""},
    )
    assert res.status_code == 400
```

- [ ] **Step 2: Run to verify fail**

```bash
uv run python -m pytest tests/test_voices.py -v -k traversal
```

- [ ] **Step 3: Add validation at the top of `clone_voice`**

Near the top of `orchestrator/routers/voices.py`, add:

```python
import re

_VOICE_NAME_RE = re.compile(r"^[A-Za-z0-9 _-]{1,64}$")
```

At the very top of `clone_voice` (before the `engine_url = ...` line at `voices.py:92`):

```python
if not _VOICE_NAME_RE.fullmatch(name):
    raise HTTPException(
        status_code=400,
        detail="Voice name must be 1-64 chars, letters/digits/space/dash/underscore only",
    )
```

- [ ] **Step 4: Verify tests pass**

```bash
uv run python -m pytest tests/test_voices.py -v
```

- [ ] **Step 5: Commit**

```bash
git add orchestrator/routers/voices.py orchestrator/tests/test_voices.py
git commit -m "Validate voice name to prevent path traversal on clone

Voice clone writes VOICES_DIR/{user_id}/{name}.wav with name from form
input; a name like ../../etc/x would escape the user dir. Restrict to
letters, digits, spaces, dashes and underscores, 1-64 chars."
```

---

## Task 6: Auth on `/backends/*` mutating routes

**Why:** `select_backend`, `install_backend`, `uninstall_backend` currently have no user dependency. Any unauthenticated caller who reaches the orchestrator can start/stop engines globally.

**Files:**
- Modify: `orchestrator/routers/backends.py:34,62,91`
- Modify: `orchestrator/tests/test_backends.py`

- [ ] **Step 1: Write the failing test**

Append to `orchestrator/tests/test_backends.py`:

```python
async def test_select_backend_requires_auth(client):
    # No X-User-Id header
    res = await client.post("/backends/select", json={"name": "pocket-tts"})
    assert res.status_code == 401


async def test_install_backend_requires_auth(client):
    res = await client.post("/backends/install", json={"name": "pocket-tts"})
    assert res.status_code == 401


async def test_uninstall_backend_requires_auth(client):
    res = await client.delete("/backends/pocket-tts")
    assert res.status_code == 401
```

- [ ] **Step 2: Run to verify fail**

```bash
uv run python -m pytest tests/test_backends.py -v -k requires_auth
```

- [ ] **Step 3: Add auth dep to the three routes**

In `orchestrator/routers/backends.py`, add to the imports:

```python
from fastapi import Depends
from orchestrator.auth import get_current_user_id
```

Update the three handler signatures:

```python
@router.post("/select", response_model=BackendResponse)
async def select_backend(
    req: SelectBackendRequest,
    user_id: int = Depends(get_current_user_id),
):
    ...

@router.post("/install")
async def install_backend(
    req: SelectBackendRequest,
    user_id: int = Depends(get_current_user_id),
):
    ...

@router.delete("/{name}")
async def uninstall_backend(
    name: str,
    user_id: int = Depends(get_current_user_id),
):
    ...
```

Leave the `user_id` unused for now — it's just forcing authentication. Do not add per-user scoping to engine state; engines are global and that's fine.

**Note for the agent:** `list_backends` and `backend_events` (the GET routes) can also be auth-required — arguably should be — but they're lower-risk. The frontend calls them from authenticated pages anyway. Skip for now unless you have spare time; it's in the minor backlog.

- [ ] **Step 4: Run tests**

```bash
uv run python -m pytest tests/test_backends.py -v
```

- [ ] **Step 5: Commit**

```bash
git add orchestrator/routers/backends.py orchestrator/tests/test_backends.py
git commit -m "Require authentication on backend select/install/uninstall

These routes mutate global engine state (start/stop subprocesses,
download gigabytes of model weights). They should not be reachable
without a logged-in session."
```

---

## Task 7: Rate limit auth endpoints

**Why:** No rate limiting on `/auth/login` or `/auth/register` → unlimited bcrypt attempts for credential stuffing, and unlimited account creation for abuse.

**Depends on Decision #1.** Below is the slowapi path; if the user picks hand-rolled, ask for guidance.

**Files:**
- Modify: `orchestrator/pyproject.toml` (add `slowapi`)
- Modify: `orchestrator/main.py` (register limiter + error handler)
- Modify: `orchestrator/routers/auth_router.py` (apply decorators)
- Modify: `orchestrator/tests/test_auth.py`

- [ ] **Step 1: Add slowapi**

```bash
cd orchestrator
uv add slowapi
```

- [ ] **Step 2: Register limiter in main.py**

At the top of `orchestrator/main.py` after existing imports:

```python
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from slowapi.middleware import SlowAPIMiddleware

limiter = Limiter(key_func=get_remote_address, default_limits=[])
```

After `app = FastAPI(...)` (line 82):

```python
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, lambda r, e: Response(status_code=429))
app.add_middleware(SlowAPIMiddleware)
```

- [ ] **Step 3: Apply limits in `auth_router.py`**

At the top:

```python
from orchestrator.main import limiter
from fastapi import Request
```

**Wait** — this creates a circular import (`main` imports routers, routers would import from `main`). Instead: create `orchestrator/rate_limit.py` with just:

```python
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)
```

Then `main.py` imports `from orchestrator.rate_limit import limiter` and passes it to `app.state`; `auth_router.py` imports the same `limiter`.

Decorate the handlers:

```python
@router.post("/register", response_model=AuthResponse, status_code=201)
@limiter.limit("3/minute")
async def register(request: Request, req: RegisterRequest, db: aiosqlite.Connection = Depends(get_db)):
    ...

@router.post("/login", response_model=AuthResponse)
@limiter.limit("5/minute")
async def login(request: Request, req: LoginRequest, db: aiosqlite.Connection = Depends(get_db)):
    ...
```

Note that slowapi requires the handler's first arg to be `request: Request`. Update the signatures accordingly.

- [ ] **Step 4: Write + run rate-limit tests**

Append to `orchestrator/tests/test_auth.py`:

```python
async def test_login_rate_limited(client):
    await client.post("/auth/register", json={"email": "rl@example.com", "password": "pw12345678"})
    for _ in range(5):
        await client.post("/auth/login", json={"email": "rl@example.com", "password": "wrong"})
    res = await client.post("/auth/login", json={"email": "rl@example.com", "password": "wrong"})
    assert res.status_code == 429
```

**Potential snag:** slowapi's `get_remote_address` reads `request.client.host`; in the `ASGITransport` test client, that may be `None` or `testclient`. If the test fails because the limiter can't key, use this instead:

```python
def _test_key(request):
    return request.client.host if request.client else "test"

limiter = Limiter(key_func=_test_key)
```

```bash
uv run python -m pytest tests/test_auth.py -v
```

- [ ] **Step 5: Commit**

```bash
git add orchestrator/pyproject.toml orchestrator/uv.lock orchestrator/main.py orchestrator/rate_limit.py orchestrator/routers/auth_router.py orchestrator/tests/test_auth.py
git commit -m "Rate limit auth endpoints to 5/min login, 3/min register

Prevents credential stuffing (unlimited bcrypt attempts) and account
spam. Per-IP via slowapi."
```

---

## Task 8: Email validation + password policy

**Why:** `email: str` accepts anything. `password: str` accepts `"1"`. Cheap user-experience + security improvement.

**Files:**
- Modify: `orchestrator/pyproject.toml` (add `email-validator` — required by `EmailStr`)
- Modify: `orchestrator/models.py:5-13`
- Modify: `orchestrator/tests/test_auth.py`

- [ ] **Step 1: Add the dep**

```bash
cd orchestrator
uv add email-validator
```

- [ ] **Step 2: Edit `models.py`**

Replace the `RegisterRequest` and `LoginRequest`:

```python
from pydantic import BaseModel, EmailStr, Field


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    display_name: str | None = Field(default=None, max_length=100)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str
```

Note: login intentionally does **not** enforce min_length — legacy accounts may have shorter passwords; let the bcrypt verify fail naturally.

- [ ] **Step 3: Write + run tests**

Append to `orchestrator/tests/test_auth.py`:

```python
async def test_register_rejects_invalid_email(client):
    res = await client.post("/auth/register", json={"email": "not-an-email", "password": "pw12345678"})
    assert res.status_code == 422


async def test_register_rejects_short_password(client):
    res = await client.post("/auth/register", json={"email": "short@example.com", "password": "short"})
    assert res.status_code == 422
```

**Heads up:** existing auth tests use passwords like `"p"` and `"pass"`. You will need to update them to 8+ chars. Grep for `"password":` in `orchestrator/tests/` and bump them all to `"pw12345678"` or similar.

```bash
uv run python -m pytest tests --ignore=tests/test_engine_manager.py -q
```

- [ ] **Step 4: Commit**

```bash
git add orchestrator/models.py orchestrator/pyproject.toml orchestrator/uv.lock orchestrator/tests/
git commit -m "Validate email format and require 8-char passwords on register

EmailStr via pydantic's email-validator rejects obvious garbage; min
length 8 is a minimum-viable password policy. Login is not length-
checked so legacy accounts still work."
```

---

## Task 9: Repo hygiene — remove tracked DB, stop logging emails

Two small cleanups bundled because they're both one-liners.

**Files:**
- Delete from index: `pocket-tts.db`
- Modify: `orchestrator/routers/auth_router.py` (drop `req.email` from info/warning logs)

- [ ] **Step 1: Remove the tracked DB**

```bash
git rm --cached pocket-tts.db
git commit -m "Untrack pocket-tts.db; it's already in .gitignore"
```

- [ ] **Step 2: Drop email from auth logs**

Edit `orchestrator/routers/auth_router.py`. Replace any `logger.*` call that references `req.email` with one that uses `user_id` or omits the email. Example changes (full list: `auth_router.py:16,19,28,41,44,49,53,64`):

- Line 16: `logger.info("Register attempt")` (drop `email=%s`)
- Line 19: `logger.warning("Register failed: duplicate email")` (drop actual email; OK to keep "duplicate")
- Line 28: `logger.info("Registered user id=%d", user_id)` (drop email)
- Line 41: `logger.info("Login attempt")` (drop email)
- Line 44: `logger.warning("Login failed: unknown email")` (drop actual email)
- Line 49: `logger.warning("Login failed: wrong password for user_id=<unknown>")` — at this point we don't have a user_id, just log "wrong password"
- Line 53: `logger.info("Login success for user id=%d", user["id"])` (drop email)
- Line 64: `logger.error("User from token not found", extra={"user_id": user_id})`

- [ ] **Step 3: Verify tests still pass**

```bash
uv run python -m pytest tests --ignore=tests/test_engine_manager.py -q
```

- [ ] **Step 4: Commit**

```bash
git add orchestrator/routers/auth_router.py
git commit -m "Stop logging email addresses in auth flow

Emails are PII; logging them on every login attempt is a GDPR flag and
grows logs unnecessarily. User id is enough for tracing."
```

---

## Task 10: SSRF guard on `extract-url.post.ts`

**Why:** Nitro's URL extractor accepts any URL from the client and fetches it with `redirect: 'follow'`. No host allowlist, no private-IP check. Reaches `http://orchestrator:8000/…`, AWS IMDS (`169.254.169.254`), RFC1918.

**Files:**
- Modify: `frontend/server/api/extract-url.post.ts`
- Create: `frontend/tests/server/extract-url.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/server/extract-url.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { isPrivateOrDisallowedHost } from '~/server/api/extract-url.post'

describe('SSRF guard', () => {
  it('rejects localhost', () => {
    expect(isPrivateOrDisallowedHost('http://localhost')).toBe(true)
    expect(isPrivateOrDisallowedHost('http://127.0.0.1')).toBe(true)
    expect(isPrivateOrDisallowedHost('http://127.0.0.1:8000')).toBe(true)
  })

  it('rejects RFC1918 literals', () => {
    expect(isPrivateOrDisallowedHost('http://10.0.0.1')).toBe(true)
    expect(isPrivateOrDisallowedHost('http://192.168.1.100')).toBe(true)
    expect(isPrivateOrDisallowedHost('http://172.16.5.5')).toBe(true)
  })

  it('rejects link-local and loopback IPv6', () => {
    expect(isPrivateOrDisallowedHost('http://[::1]')).toBe(true)
    expect(isPrivateOrDisallowedHost('http://[fe80::1]')).toBe(true)
  })

  it('rejects AWS metadata service', () => {
    expect(isPrivateOrDisallowedHost('http://169.254.169.254')).toBe(true)
  })

  it('rejects non-http schemes', () => {
    expect(isPrivateOrDisallowedHost('file:///etc/passwd')).toBe(true)
    expect(isPrivateOrDisallowedHost('ftp://example.com')).toBe(true)
  })

  it('allows public URLs', () => {
    expect(isPrivateOrDisallowedHost('https://example.com')).toBe(false)
    expect(isPrivateOrDisallowedHost('https://news.ycombinator.com/item?id=1')).toBe(false)
  })
})
```

- [ ] **Step 2: Implement `isPrivateOrDisallowedHost` and apply it**

Replace `frontend/server/api/extract-url.post.ts` with:

```ts
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

const MAX_REDIRECTS = 5
const MAX_BYTES = 5 * 1024 * 1024 // 5 MB

function isPrivateIPv4(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number)
  if (a === 10) return true
  if (a === 127) return true
  if (a === 0) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  return false
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase()
  if (lower === '::1' || lower === '0:0:0:0:0:0:0:1') return true
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true // ULA
  if (lower.startsWith('fe80')) return true // link-local
  return false
}

export function isPrivateOrDisallowedHost(rawUrl: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return true
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return true
  const host = parsed.hostname.replace(/^\[|\]$/g, '')
  if (!host || host === 'localhost') return true

  const ipKind = isIP(host)
  if (ipKind === 4) return isPrivateIPv4(host)
  if (ipKind === 6) return isPrivateIPv6(host)
  return false // hostname — resolve later
}

async function resolveIsPrivate(hostname: string): Promise<boolean> {
  const result = await lookup(hostname, { all: true })
  for (const { address, family } of result) {
    if (family === 4 && isPrivateIPv4(address)) return true
    if (family === 6 && isPrivateIPv6(address)) return true
  }
  return false
}

export default defineEventHandler(async (event) => {
  const { url } = await readBody<{ url: string }>(event)
  if (!url || typeof url !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'URL is required' })
  }

  let current = url
  let redirects = 0
  let finalResponse: Response | null = null

  while (redirects <= MAX_REDIRECTS) {
    if (isPrivateOrDisallowedHost(current)) {
      throw createError({ statusCode: 400, statusMessage: 'URL is private or disallowed' })
    }
    const parsed = new URL(current)
    if (isIP(parsed.hostname) === 0) {
      // hostname — resolve DNS and re-check
      if (await resolveIsPrivate(parsed.hostname)) {
        throw createError({ statusCode: 400, statusMessage: 'URL resolves to a private address' })
      }
    }

    const resp = await fetch(current, {
      redirect: 'manual',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Murmur/1.0)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(15_000),
    })

    if (resp.status >= 300 && resp.status < 400) {
      const location = resp.headers.get('location')
      if (!location) break
      current = new URL(location, current).href
      redirects++
      continue
    }

    finalResponse = resp
    break
  }

  if (!finalResponse) {
    throw createError({ statusCode: 502, statusMessage: 'Too many redirects' })
  }
  if (!finalResponse.ok) {
    throw createError({ statusCode: finalResponse.status, statusMessage: `Upstream returned ${finalResponse.status}` })
  }
  const ct = finalResponse.headers.get('content-type') || ''
  if (!ct.toLowerCase().startsWith('text/html')) {
    throw createError({ statusCode: 415, statusMessage: 'Only text/html URLs are supported' })
  }

  const buf = await finalResponse.arrayBuffer()
  if (buf.byteLength > MAX_BYTES) {
    throw createError({ statusCode: 413, statusMessage: 'Response too large' })
  }
  const html = new TextDecoder().decode(buf)

  let thumbnailUrl: string | null = null
  const ogMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)
  if (ogMatch?.[1]) {
    try {
      thumbnailUrl = new URL(ogMatch[1], current).href
    } catch {}
  }

  return { html, thumbnailUrl }
})
```

- [ ] **Step 3: Verify tests + typecheck**

```bash
cd frontend
npx nuxi typecheck
npm run test
```

- [ ] **Step 4: Commit**

```bash
git add frontend/server/api/extract-url.post.ts frontend/tests/server/extract-url.test.ts
git commit -m "Block SSRF in extract-url endpoint

Validates URLs against a loopback/RFC1918/AWS-metadata blocklist before
each request, follows redirects manually so every hop is re-checked,
caps response size, and rejects non-text/html content. Closes the
clearest SSRF vector in the BFF."
```

---

## Task 11: CI

**Why:** Every regression shipped in this audit would have been caught by a 60-second CI run. Target: lint + typecheck + test on every push and PR.

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: ci

on:
  push:
    branches: [main]
  pull_request:

jobs:
  frontend:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: frontend
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
          cache-dependency-path: frontend/package-lock.json
      - run: npm ci
      - run: npx nuxi typecheck
      - run: npm run test

  orchestrator:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: orchestrator
    env:
      MURMUR_ALLOW_DEV_SECRET: "1"
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v3
        with:
          enable-cache: true
      - run: uv sync --frozen
      - run: uvx ruff check .
      - run: uv run python -m pytest tests --ignore=tests/test_engine_manager.py -q

  alignment:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: alignment-server
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v3
        with:
          enable-cache: true
      - run: uv sync --frozen
      - run: uvx ruff check .
      - run: uv run python -m pytest tests -q
```

Note: the alignment server has heavy WhisperX deps — expect the `uv sync` step to be slow on first run. If it takes >5 min on CI, split alignment tests into a separate `scheduled` workflow and run only lint on PRs. Leave the full workflow in place for now and monitor.

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "Add GitHub Actions CI for frontend, orchestrator, and alignment server

Runs typecheck + vitest for Nuxt, ruff + pytest for both Python
services. test_engine_manager is ignored for now (pre-existing
failure tracked in the minor backlog)."
```

- [ ] **Step 3: Push and confirm CI is green**

Do **not** push without the user's say-so. Ask first. If they say push: `git push`. If any job fails, read the logs, fix, push again.

---

## Task 12 (optional): Pre-commit

Depends on Decision #5. If the user said no, skip entirely.

- [ ] **Step 1: Add `.pre-commit-config.yaml`**

```yaml
repos:
  - repo: https://github.com/astral-sh/ruff-pre-commit
    rev: v0.6.9
    hooks:
      - id: ruff
        args: [--fix]
      - id: ruff-format
  - repo: local
    hooks:
      - id: frontend-typecheck
        name: nuxi typecheck
        entry: bash -c 'cd frontend && npx nuxi typecheck'
        language: system
        pass_filenames: false
        files: ^frontend/
```

- [ ] **Step 2: Install + commit**

```bash
pre-commit install
git add .pre-commit-config.yaml
git commit -m "Add pre-commit hooks for ruff and nuxi typecheck"
```

---

## Minor issues backlog (documented, not fixed)

The items below were identified in the audit but are out of scope for today's 3-hour budget. Log them as TODOs and move on. Do not start any of these; the user's intent is to ship the criticals + CI and revisit.

### Architecture (medium-term)

- **BFF↔orchestrator trust is implicit.** The orchestrator blindly trusts `X-User-Id`. If the orchestrator port is ever exposed (misconfigured firewall, dev-by-accident), the whole auth model collapses. Fix: HMAC a per-request signature with a shared secret, or run mTLS. (~1-2 days for the properly-done version.)
- **No RLS.** Per-user isolation is enforced by hand-written `WHERE user_id = ?` in every query. One forgotten clause = a leak (Tasks 1-2 fixed the known ones). Postgres with row-level security or an internal "authorized_db" wrapper would make this impossible to forget.
- **SQLite + async FastAPI** has no `busy_timeout`, no `synchronous` tuning, no write-serialization. Fine for single-user; will misbehave under load.
- **Module-level singletons** (`engine_manager`, `job_worker`, `job_event_bus`). Tests monkeypatch around them in `conftest.py:25-45`. Prevents running multiple orchestrator replicas and makes tests fragile.
- **Job worker polls every 2s and opens a fresh DB connection per segment** (`job_worker.py:42, 111, 121, 157`). Event-driven scheduling with a connection pool would be saner.

### Code quality

- **`test_engine_manager.py::test_check_installed_detects_engines` fails on main.** The test creates a `main.py` file but no `.venv`; `engine_manager.check_installed` now requires a venv before promoting AVAILABLE→INSTALLED (`engine_manager.py:59-61`). Either the test or the behavior is wrong. Requires a decision about semantics before fixing. Ignored by CI as of Task 11.
- **`asyncio.create_task` with no reference** at `backends.py:79`. Can be GC'd mid-run. Keep a reference in a module-level set, or `await` it.
- **Request-scoped `import io` and `import zipfile`** inside `serve_audio_bundle` in `main.py:115-116`. Harmless but lazy.
- **`reads.py:193`** (`import re` inside `_process_segment`). Same thing.
- **Frontend has no ESLint config.** `npm install -D eslint @nuxt/eslint` and configure via `@nuxt/eslint` module. Expect ~half-day to fix existing violations.
- **Stale Drizzle migration artifacts** at `frontend/server/db/migrations/`. We deleted `drizzle.config.ts` on 2026-04-21 but the SQL files and snapshot JSON remain tracked.
- **Pytest warnings**: `InsecureKeyLengthWarning` (will be auto-fixed by Task 3 if dev opt-in uses a 32+ byte value — update the string), `coroutine 'AsyncMockMixin._execute_mock_call' was never awaited` in `test_job_worker.py` (mock isn't `AsyncMock` where one was needed).
- **Password hashing** has no upgrade path. No rehash-on-login when cost bumps, no pepper.

### Ops

- **Orchestrator Dockerfile runs as root by default** — no `USER` line. Docker Compose bandaids with `user: ${UID:-1000}:${GID:-1000}` but the image alone is unsafe.
- **No healthcheck directives** in `docker-compose.yml`. Caddy starts before `app` is ready → first-request flakes.
- **`.env.example:7`** has a specific LAN IP (`MURMUR_HOST=192.168.0.29`). Replace with `192.168.1.100` or a placeholder.
- **No structured logs, no request IDs, no metrics, no error tracking.** Trivial to add `structlog` + a FastAPI middleware that stamps `X-Request-ID`; punt on metrics/Sentry for now.
- **CORS `allow_origins=["*"]`** on orchestrator and every TTS server. Fine in practice because the orchestrator isn't externally exposed, but the pattern is wrong. Should be driven by `MURMUR_HOST`.
- **Default binding `host: 0.0.0.0`** in Dockerfile and dev runs. Intended (Docker needs it), but worth pairing with host-level firewalling in docs.
- **`list_backends` / `/backends/events` remain unauthenticated** after Task 6. Low risk — they don't mutate, and the data they return isn't sensitive — but they should get `Depends(get_current_user_id)` on the next pass.

### Documentation / DX

- **`docs/superpowers/plans/`** is committed to the repo. If the repo goes public this is fine, but note it for when that happens.
- **`CLAUDE.md`** describes the architecture faithfully but hasn't been updated since before the audit. After today's work, add a "Security posture" section summarizing what's defended and what's known-weak.

---

## Final verification

Before declaring done:

- [ ] `cd orchestrator && uv run python -m pytest tests --ignore=tests/test_engine_manager.py -q` → all pass
- [ ] `cd orchestrator && uvx ruff check .` → clean
- [ ] `cd frontend && npx nuxi typecheck` → clean
- [ ] `cd frontend && npm run test` → all pass
- [ ] `git log --oneline -15` shows one atomic commit per task, sentence-case titles, no Co-Authored-By
- [ ] `.github/workflows/ci.yml` exists and passes locally (simulate by running each step manually)
- [ ] `pocket-tts.db` is gone from `git ls-files`

---

## If you run short on time

Priority order for what to keep:

1. **Tasks 1-2 (tenant isolation)** — these are the data-breach fixes. Must ship.
2. **Task 3 (JWT fail-closed)** — one-paragraph change, huge payoff.
3. **Task 5 (voice name validation)** — 10 min.
4. **Task 6 (auth on backends)** — 10 min.
5. **Task 4 (Secure cookie)** — 5 min.
6. **Task 10 (SSRF)** — 20 min, high value.
7. **Task 8 (EmailStr + password)** — 10 min.
8. **Task 9 (hygiene)** — 10 min.
9. **Task 7 (rate limit)** — 30 min, can slip.
10. **Task 11 (CI)** — slip if needed; the manual commands in Section 0 will catch regressions for now.
11. **Task 12 (pre-commit)** — always skippable.

If something blocks you (e.g., slowapi doesn't play nicely with the test fixture), leave a TODO in the code and move on. Don't rathole.

---

## After all tasks are done

Post-run, ask the user:
1. "Want me to push now, or do you want to review first?"
2. "Ready to tackle the minor backlog, or call it?"
3. "Want an updated CLAUDE.md security section?"
