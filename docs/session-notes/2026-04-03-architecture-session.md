# Session Notes: From PWA to Server-Backed Architecture

**Date:** 2026-04-03
**Duration:** ~3 hours, single Claude Code session

## What happened

### Started with a UX audit using Playwright

Walked through the app page-by-page taking screenshots. Found a cascade of visual bugs — icons overlapping text, dropdowns broken, sidebar leaking on mobile. Traced all of them to a single root cause: **the `app.css` was missing `@import "@nuxt/ui"`**. One line fixed everything. Classic "the CSS framework wasn't actually loaded" bug that made the entire UI look subtly wrong.

Other fixes: mobile sidebar was in the wrong slot (`USlideover` default slot vs `#content`), settings page had double padding, a Vue transition warning from wrapping `<slot>` in `<Transition>`.

### Added four features back-to-back

Knocked out the "Not Yet Implemented" list:
- **Playback resume** — schema already had the columns, just needed wiring. 3 commits.
- **Mic recording for voice cloning** — MediaRecorder API → WebM → WAV conversion → existing clone pipeline. 1 commit.
- **URL ingestion** — Readability.js + CORS proxy. Added "From URL" tab to the new read page.
- **Document import** — PDF (pdf.js), EPUB (jszip), DOCX (mammoth), TXT, Markdown, HTML. PDF worker was broken (CDN URL 404'd), fixed with Vite's `?url` import.

### Hit the Vite file watcher wall

`npm run dev` was crashing with `ENOSPC: System limit for number of file watchers reached` — Vite was watching 24GB of Python `.venv` directories (torch, etc.) inside the TTS backend folders. Fix: `vite.server.watch.ignored` in nuxt.config + `.nuxtignore`. No restructuring needed.

### The architecture pivot conversation

User wanted background generation that survives browser disconnects, job queuing, and multi-device support. This forced the big question: **should we move from client-side PWA to server-backed?**

Key decision points in order:

1. **Everything server-side** — User agreed immediately. "No risk of the browser clearing data."

2. **Nuxt as full-stack vs Python orchestrator** — Initially leaned toward Nuxt doing everything (server routes handle CRUD, queue, etc.). But user revealed two things that changed the calculus:
   - This is a **portfolio piece** meant to demonstrate Nuxt proficiency
   - It will be **open source** targeting the Python/ML TTS community

   This flipped the answer: **Python orchestrator for data + queue, Nuxt as BFF for auth + SSR + UI**. Clean boundary, each side has substance, contributors work in the language they know.

3. **Justifying Nuxt** — User pushed back: "Is Nuxt overkill if the backend does everything?" Answer: No — Nuxt earns its place through server middleware (auth), BFF pattern (proxy + aggregate API calls), hybrid rendering, SSE proxying, and `useFetch`/`useAsyncData`. The BFF pattern was the key insight — the browser never talks to the orchestrator directly.

4. **Local auth** — Open registration, email + password, JWT in httpOnly cookies. Multi-user with isolated data. Inspired by OpenUI's approach.

5. **TTS engine management** — Not all engines in Docker. On-demand download from the UI. Only pocket-tts (~400MB) installed on first run. Others show size + product page link + download button. One engine runs at a time as a subprocess managed by the orchestrator.

6. **Project renamed to Murmur** — short, memorable, works as a CLI name.

### Cleaned up git history

87 commits with merge noise from worktree agents → 44 clean linear commits via `GIT_SEQUENCE_EDITOR` driven `git rebase -i --root`. Related work squashed, merge commits eliminated, messages standardized.

### Wrote the design spec

Full spec at `docs/specs/2026-04-03-server-backed-architecture.md` covering: system architecture, data model, TTS engine management (on-demand install, subprocess lifecycle), job queue with SSE, auth, Nuxt BFF features, Docker compose, offline PWA sync, export/import.

### Wrote the implementation plan

Decomposed into 7 plans. Wrote Plan 1 (Orchestrator Core) with 10 tasks, full code, test commands, commit messages, and a parallelization map showing which tasks can be dispatched as concurrent subagents.

## Quotable moments

- "What approach will make people say, 'I want to hire this guy'?" — the question that shaped the architecture
- "What impresses technical interviewers isn't complexity — it's taste."
- The one-line CSS fix that transformed the entire UI
- "The projects that get traction on GitHub share a pattern: easy to run, solves a real problem, clean architecture that invites contribution."
- Choosing Python orchestrator over Nuxt-does-everything because of the open source contributor pool

## Architecture before and after

**Before:** Browser-only PWA. SQLite in the browser (sql.js WASM). Audio in IndexedDB. TTS generation dies if you close the tab.

**After (Murmur):** Docker container running Python orchestrator (owns all data, manages TTS engines as subprocesses, background job queue) + Nuxt BFF (auth, SSR, API proxy) + alignment server. Browser is a thin client with offline sync. `docker compose up` and go.
