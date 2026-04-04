# Murmur Server-Backed Architecture — Plan Tracker

**Full spec:** `docs/specs/2026-04-03-server-backed-architecture.md`

## Plans

| # | Name | Status | Branch | Tests | Summary |
|---|------|--------|--------|-------|---------|
| 1 | Orchestrator Foundation | DONE | merged | 28 | FastAPI app, SQLite schema, auth (JWT+bcrypt), reads CRUD, bookmarks, voices, settings, health, sentence splitter |
| 2 | Engine Management | DONE | merged | 45 total | Engine registry, subprocess lifecycle manager, backends router (list/select/SSE), voice sync/clone, health integration |
| 3 | Job Queue | DONE | merged | 74 total | Background job worker, SSE progress events, generate endpoint, queue router (list/cancel/SSE), startup recovery, auto-resume |
| 4 | Nuxt BFF | DONE | merged | 5 (JWT) | Auth middleware (JWT cookie), auth routes (register/login/logout/me), catch-all proxy with X-User-Id, orchestrator fetch utility |
| 5 | UI Migration | DONE | merged | build pass | Auth pages (login/register), auth middleware, all composables rewritten to BFF API, queue page, engine selector, SSR enabled, sql.js/drizzle removed |
| 6 | Docker Compose | DONE | merged | 4 (alignment) | Dockerfiles (Nuxt, orchestrator, alignment), docker-compose.yml, .dockerignore, .env.example, CPU-only torch, configurable port |
| 7 | PWA Offline Sync | DONE | merged | 16 | Workbox runtime caching, IndexedDB mutation queue, background sync, offline indicator, settings UI |

## Plan Details (for Plans 3-7)

### Plan 3: Job Queue (Orchestrator)

**Spec sections:** 5 (Job Queue & Background Generation), 8 (Generation + Queue endpoints)

**What to build in `orchestrator/`:**
- Background worker that processes jobs FIFO, one at a time
- For each ungenerated segment: call active TTS engine `/tts/generate`, save WAV to disk, call alignment server `/align`, update DB
- Job state machine: pending → running → done/failed/cancelled, with `waiting_for_backend` when engine is down
- On orchestrator restart: reset `running` jobs to `pending`
- SSE events: job:queued, job:started, job:progress, job:completed, job:failed, job:cancelled

**Endpoints:**
- `POST /reads/:id/generate {voice, language?}` → create job
- `GET /queue` → list user's jobs
- `DELETE /queue/:jobId` → cancel job
- `GET /queue/events` → SSE stream (user-scoped)

**Depends on:** Plan 2 (engine manager for active engine URL + health status)

### Plan 4: Nuxt BFF (Server Routes)

**Spec sections:** 6 (Auth & Multi-User), 7 (Nuxt Frontend Features — server middleware/routes)

**What to build:**
- `server/middleware/auth.ts` — validate JWT cookie, attach user to event context
- `server/api/auth/register.post.ts`, `login.post.ts`, `logout.post.ts`, `me.get.ts` — proxy to orchestrator, set/clear httpOnly JWT cookie
- `server/api/reads/[...].ts` — proxy reads CRUD to orchestrator with `X-User-Id` header
- `server/api/bookmarks/[...].ts`, `voices/[...].ts`, `settings/[...].ts`, `queue/[...].ts`, `backends/[...].ts` — same pattern
- `server/api/queue/events.get.ts` — SSE relay from orchestrator, filtered to current user
- `server/api/audio/[readId]/[segIndex].get.ts` — proxy audio files
- Re-enable SSR (`ssr: true` in nuxt.config) for login/register pages
- Environment variable: `ORCHESTRATOR_URL` (default `http://localhost:8000`)

**Depends on:** Plans 1-3 (orchestrator fully functional)

### Plan 5: UI Migration

**Spec sections:** 7 (Data fetching, hybrid rendering), 10 (Pages & UI Components)

**What to build:**
- `/login` and `/register` pages (SSR)
- `pages/queue.vue` — job list with progress bars, cancel buttons
- `components/EngineSelector.vue` — dropdown with engine states
- Refactor ALL composables to use `useFetch`/`useAsyncData` against BFF routes instead of sql.js/IndexedDB
- Delete: `composables/useDatabase.ts`, `composables/useAudioStorage.ts`, `utils/align-client.ts`, `shared/schema.ts`, `types/db.ts`
- Remove sql.js, drizzle-orm dependencies
- Client-side auth guard middleware redirecting to `/login`

**Depends on:** Plan 4 (BFF routes exist for composables to call)

### Plan 6: Docker Compose

**Spec section:** 9 (Docker Compose)

**What to build:**
- `Dockerfile` for Nuxt app (Node.js, build + serve)
- `orchestrator/Dockerfile` for orchestrator (Python, uvicorn)
- `alignment-server/Dockerfile` for WhisperX alignment
- `docker-compose.yml` with 3 services + volume
- Environment wiring (`ORCHESTRATOR_URL`, `ALIGN_SERVER_URL`, `MURMUR_JWT_SECRET`)
- First-run: orchestrator auto-installs pocket-tts engine

**Depends on:** Plans 1-5 (full app working)

### Plan 7: PWA Offline Sync

**Spec section:** 7 (PWA & Offline Sync)

**What to build:**
- Service worker caches app shell + reads/audio for offline use
- Setting to disable auto-sync (limited storage devices)
- Offline mode: reads from local cache, queues progress updates
- Online resume: syncs pending changes, pulls new data
- Conflict resolution: last-write-wins via `updated_at`

**Depends on:** Plans 1-6 (Docker environment running)

## Execution Instructions

For each TODO plan:

1. **Create feature branch:** `git checkout -b feat/<plan-name>`
2. **Write the detailed plan** using the writing-plans skill — save to `/home/john/.claude/plans/plan-N-<name>.md` following the same format as Plans 1-2
3. **Execute the plan** using subagent-driven-development (fresh subagent per task, spec review + code quality review)
4. **Playwright-verify** all new endpoints/features
5. **Merge to main:** `git checkout main && git merge feat/<plan-name>`
6. **Update this tracker:** mark the plan as DONE with test count

Repeat until all 7 plans are DONE.
