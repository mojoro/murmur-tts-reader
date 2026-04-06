# Playback Polish Design

## Overview

Four tightly coupled improvements to the playback experience: auto-start generation, global playback bar, total duration estimation, and time remaining display.

## 1. Auto-start generation on read creation

When a user creates a read on `/new` (voice already selected), navigating to `/read/:id` auto-starts generation if no segments have audio and a voice is selected. No new UI — removes the manual "Generate Audio" click on first visit.

**Implementation:** In `pages/read/[id].vue`, add a watch that triggers `generate(selectedVoice)` when `readData` first loads and no segments have `audio_generated === true`.

## 2. Global playback bar

Move `AudioPlayer.client.vue` from `pages/read/[id].vue` into `layouts/default.vue`. The composable already uses module-level state, so playback persists across page navigations.

**Bar contents (left to right):**
- Read title (truncated), links to `/read/:id`
- Skip prev / Play-pause / Skip next
- Progress bar (elapsed / total)
- Time remaining label
- Speed dropdown

**Conditional rendering:** Only shows when `segments.length > 0` (already the case).

**Changes needed:**
- Remove `<AudioPlayer />` from `pages/read/[id].vue`
- Add `<AudioPlayer />` to `layouts/default.vue` after `<main>`
- Add `currentReadId` and `currentReadTitle` to `useAudioPlayer` module-level state
- Update `setSegments` to accept read metadata (id, title)
- Add read title + link to the player bar

## 3. Duration estimation

Add computed properties to `useAudioPlayer`:

- `totalDuration`: sum of known durations (generated segments) + estimates (ungenerated segments at ~150 wpm, adjusted by playbackRate)
- `elapsedTime`: sum of durations for segments before `currentSegmentIndex` + `currentTime` within active segment
- `remainingTime`: `totalDuration - elapsedTime`

**Segment duration tracking:**
- Maintain a `Map<number, number>` of `segmentIndex → duration` at module level
- Populate from `durationchange` events as segments play
- For segments not yet loaded, estimate: `wordCount / 150 * 60` seconds
- When a segment's real duration is learned, the estimate auto-corrects via reactivity

**Display format:**
- Under 1 hour: "42 min remaining"
- Over 1 hour: "1 hr 12 min remaining"
- While any segments use estimates: "~35 min remaining" (tilde prefix)

## 4. Files changed

| File | Change |
|------|--------|
| `composables/useAudioPlayer.ts` | Add `currentReadId`, `currentReadTitle`, `segmentDurations` map, `totalDuration`, `elapsedTime`, `remainingTime` computeds. Update `setSegments` signature. |
| `components/AudioPlayer.client.vue` | Add read title link, replace "Segment X of Y" with time remaining, update progress bar to use elapsed/total. |
| `pages/read/[id].vue` | Remove `<AudioPlayer />`. Add auto-start generation watch. Pass read metadata to `setSegments`. |
| `layouts/default.vue` | Add `<AudioPlayer />` after `<main>`. |
| `pages/new.vue` | May need to pass selected voice via query param or state to reader page for auto-start. |
