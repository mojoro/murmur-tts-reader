# Regenerate Audio

Allow users to regenerate all audio for an existing read, replacing previous audio and word timings. Primary use case: re-generating after enabling the alignment server to get word-level highlighting, or switching to a different voice/engine.

## Orchestrator Changes

### `GenerateRequest` model

Add optional `regenerate: bool = False` field.

### `POST /reads/:id/generate` endpoint (`routers/reads.py`)

When `regenerate` is true:

1. Reset all segments: `UPDATE audio_segments SET audio_generated = 0, word_timings_json = NULL, generated_at = NULL WHERE read_id = ?`
2. Delete existing WAV files from disk: remove the read's audio directory (`data/audio/{read_id}/`)
3. Re-count ungenerated segments (now all of them) and proceed with normal job creation

When `regenerate` is false: existing behavior unchanged (400 if all segments already generated).

The duplicate-job guard (409 if active job exists) applies regardless of `regenerate`.

### Job worker (`job_worker.py`)

No changes needed — it already processes all `audio_generated = 0` segments.

## Frontend Changes

### `useGeneration` composable

`generate(voice, language?, regenerate?)` — forwards `regenerate` boolean in the POST body.

### `pages/read/[id].vue`

Derive `allGenerated` from `readData.segments.every(s => s.audio_generated)`. When true:

- Button label: "Regenerate" (instead of "Generate Audio")
- Button icon: `i-lucide-refresh-cw` (instead of `i-lucide-play`)
- On click: calls `generate(voice, undefined, true)`

No confirmation dialog — regeneration is fast and the user explicitly clicked.

## Files Changed

| File | Change |
|------|--------|
| `orchestrator/models.py` | Add `regenerate` field to `GenerateRequest` |
| `orchestrator/routers/reads.py` | Reset segments + delete audio when `regenerate=true` |
| `composables/useGeneration.ts` | Pass `regenerate` param in POST body |
| `pages/read/[id].vue` | Conditional button label/icon, pass `regenerate: true` |
