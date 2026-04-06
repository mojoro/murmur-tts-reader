# Playback Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make playback feel like a real audio app — global bar, total duration, time remaining, auto-start generation.

**Architecture:** Extend `useAudioPlayer` with read metadata and duration tracking. Move `AudioPlayer` into the layout so it persists across pages. Add auto-start logic to the reader page.

**Tech Stack:** Vue 3 composables, Nuxt UI 3, HTML5 Audio API

---

### Task 1: Add read metadata and duration tracking to useAudioPlayer

**Files:**
- Modify: `composables/useAudioPlayer.ts`

- [ ] **Step 1: Add module-level state for read context and segment durations**

Add these after the existing module-level refs (after line 17):

```typescript
const currentReadId = ref<number | null>(null)
const currentReadTitle = ref('')
const segmentDurations = new Map<number, number>()
```

- [ ] **Step 2: Update setSegments to accept read metadata and reset durations**

Replace the existing `setSegments` function:

```typescript
  function setSegments(segs: AudioSegment[], opts?: { initialSegment?: number; readId?: number; readTitle?: string }) {
    // Only reset durations if switching to a different read
    if (opts?.readId !== undefined && opts.readId !== currentReadId.value) {
      segmentDurations.clear()
    }
    segments.value = segs
    if (opts?.readId !== undefined) currentReadId.value = opts.readId
    if (opts?.readTitle !== undefined) currentReadTitle.value = opts.readTitle
    if (opts?.initialSegment !== undefined && opts.initialSegment > 0 && segs.length) {
      currentSegmentIndex.value = opts.initialSegment
    }
  }
```

- [ ] **Step 3: Track segment durations from audio element**

In the `ensureAudio` function, update the `durationchange` listener to record real durations:

```typescript
    audio.addEventListener('durationchange', () => {
      duration.value = audio!.duration
      if (audio!.duration && isFinite(audio!.duration)) {
        segmentDurations.set(currentSegmentIndex.value, audio!.duration)
      }
    })
```

- [ ] **Step 4: Add duration estimation helper**

Add this after the `ensureAudio` function (module-level, not inside `useAudioPlayer`):

```typescript
const WORDS_PER_MINUTE = 150

function estimateSegmentDuration(seg: AudioSegment): number {
  const known = segmentDurations.get(seg.segment_index)
  if (known) return known
  const wordCount = seg.text.split(/\s+/).length
  return (wordCount / WORDS_PER_MINUTE) * 60
}
```

- [ ] **Step 5: Add computed properties for total/elapsed/remaining**

Add these inside the `useAudioPlayer` function, before the return statement:

```typescript
  const hasEstimates = computed(() =>
    segments.value.some(seg => !segmentDurations.has(seg.segment_index)),
  )

  const totalDuration = computed(() =>
    segments.value.reduce((sum, seg) => sum + estimateSegmentDuration(seg), 0),
  )

  const elapsedTime = computed(() => {
    let elapsed = 0
    for (let i = 0; i < currentSegmentIndex.value; i++) {
      elapsed += estimateSegmentDuration(segments.value[i])
    }
    elapsed += currentTime.value
    return elapsed
  })

  const remainingTime = computed(() => {
    const raw = totalDuration.value - elapsedTime.value
    return Math.max(0, raw / playbackRate.value)
  })
```

- [ ] **Step 6: Export new state from the composable**

Add to the return object:

```typescript
    currentReadId: readonly(currentReadId),
    currentReadTitle: readonly(currentReadTitle),
    hasEstimates,
    totalDuration,
    elapsedTime,
    remainingTime,
```

- [ ] **Step 7: Commit**

```
git add composables/useAudioPlayer.ts
git commit -m "Add read metadata and duration tracking to useAudioPlayer"
```

---

### Task 2: Update AudioPlayer to show read title and time remaining

**Files:**
- Modify: `components/AudioPlayer.client.vue`

- [ ] **Step 1: Destructure new state from composable**

Update the destructure in `<script setup>`:

```typescript
const {
  isPlaying,
  currentTime,
  playbackRate,
  currentSegmentIndex,
  segments,
  currentReadId,
  currentReadTitle,
  hasEstimates,
  totalDuration,
  elapsedTime,
  remainingTime,
  togglePlayPause,
  skipPrev,
  skipNext,
  setRate,
} = useAudioPlayer()
```

Remove `duration` from the destructure — we now use `totalDuration` and `elapsedTime`.

- [ ] **Step 2: Add formatRemaining helper**

Add after the existing `formatTime` function:

```typescript
function formatRemaining(seconds: number): string {
  if (!seconds || !isFinite(seconds)) return ''
  const h = Math.floor(seconds / 3600)
  const m = Math.ceil((seconds % 3600) / 60)
  if (h > 0) return `${h} hr ${m} min remaining`
  return `${m} min remaining`
}
```

- [ ] **Step 3: Replace the template**

Replace the entire `<template>` with:

```vue
<template>
  <div
    v-if="segments.length > 0"
    class="fixed bottom-0 left-0 right-0 z-50 border-t border-neutral-200 dark:border-neutral-800 backdrop-blur-lg bg-white/80 dark:bg-neutral-950/80 px-4 py-3"
  >
    <div class="max-w-3xl mx-auto flex flex-col sm:flex-row items-center gap-2 sm:gap-3">
      <!-- Read title -->
      <NuxtLink
        v-if="currentReadId"
        :to="`/read/${currentReadId}`"
        class="text-xs font-medium text-neutral-700 dark:text-neutral-300 truncate max-w-[120px] sm:max-w-[180px] hover:text-primary-500"
      >
        {{ currentReadTitle }}
      </NuxtLink>

      <!-- Skip prev -->
      <UButton
        icon="i-lucide-skip-back"
        variant="ghost"
        color="neutral"
        size="sm"
        :disabled="currentSegmentIndex <= 0"
        @click="skipPrev"
      />

      <!-- Play/Pause -->
      <UButton
        :icon="isPlaying ? 'i-lucide-pause' : 'i-lucide-play'"
        variant="solid"
        color="primary"
        size="sm"
        @click="togglePlayPause"
      />

      <!-- Skip next -->
      <UButton
        icon="i-lucide-skip-forward"
        variant="ghost"
        color="neutral"
        size="sm"
        :disabled="currentSegmentIndex >= segments.length - 1"
        @click="skipNext"
      />

      <!-- Progress bar -->
      <div class="flex-1 flex items-center gap-2">
        <span class="text-xs text-neutral-500 tabular-nums w-10 text-right">
          {{ formatTime(elapsedTime) }}
        </span>
        <UProgress
          :model-value="totalDuration > 0 ? (elapsedTime / totalDuration) * 100 : 0"
          size="xs"
          class="flex-1"
        />
        <span class="text-xs text-neutral-500 tabular-nums w-10">
          {{ formatTime(totalDuration) }}
        </span>
      </div>

      <!-- Speed control -->
      <UDropdownMenu :items="speedItems">
        <UButton variant="ghost" color="neutral" size="sm">
          {{ playbackRate }}x
        </UButton>
      </UDropdownMenu>
    </div>

    <!-- Time remaining -->
    <div class="max-w-3xl mx-auto mt-1">
      <p class="text-xs text-neutral-500 truncate">
        {{ hasEstimates ? '~' : '' }}{{ formatRemaining(remainingTime) }}
      </p>
    </div>
  </div>
</template>
```

- [ ] **Step 4: Commit**

```
git add components/AudioPlayer.client.vue
git commit -m "Show read title, total progress, and time remaining in player bar"
```

---

### Task 3: Move AudioPlayer to layout and remove from reader page

**Files:**
- Modify: `layouts/default.vue`
- Modify: `pages/read/[id].vue`

- [ ] **Step 1: Add AudioPlayer to the layout**

In `layouts/default.vue`, add the import and component after `<main>`, before the closing `</div>` of the main content area. Replace lines 26-31:

```vue
    <!-- Main content area -->
    <div class="flex flex-1 flex-col overflow-hidden">
      <AppHeader @toggle-sidebar="sidebarOpen = !sidebarOpen" />
      <main class="flex-1 overflow-y-auto p-4 lg:p-8">
        <slot />
      </main>
      <AudioPlayer />
    </div>
```

- [ ] **Step 2: Remove AudioPlayer from the reader page**

In `pages/read/[id].vue`, delete line 100:

```
    <AudioPlayer />
```

- [ ] **Step 3: Update setSegments call to pass read metadata**

In `pages/read/[id].vue`, update the watch on `readData` (lines 140-146):

```typescript
watch(readData, (data) => {
  if (data) {
    const initialSegment = !initialLoadDone.value ? data.progress_segment ?? 0 : undefined
    setSegments(data.segments, { initialSegment, readId: data.id, readTitle: data.title })
    initialLoadDone.value = true
  }
}, { immediate: true })
```

- [ ] **Step 4: Commit**

```
git add layouts/default.vue pages/read/[id].vue
git commit -m "Move AudioPlayer to layout for global playback across all pages"
```

---

### Task 4: Auto-start generation on first visit

**Files:**
- Modify: `pages/read/[id].vue`
- Modify: `pages/new.vue`

- [ ] **Step 1: Pass selected voice to reader page via query param**

In `pages/new.vue`, update the `navigateTo` call in `handleCreate` (line 212):

```typescript
    await navigateTo(`/read/${result.id}?voice=${encodeURIComponent(selectedVoice.value)}`)
```

- [ ] **Step 2: Add auto-start generation in reader page**

In `pages/read/[id].vue`, add after the `initialLoadDone` ref (after line 133):

```typescript
const autoGenerateAttempted = ref(false)
```

Then add a new watch after the existing `readData` watch (after line 146):

```typescript
// Auto-start generation when arriving from /new with a voice param
watch(readData, async (data) => {
  if (!data || autoGenerateAttempted.value || generating.value) return
  const hasAudio = data.segments.some(s => s.audio_generated)
  if (hasAudio) return

  const voiceParam = useRoute().query.voice as string | undefined
  const voice = voiceParam || selectedVoice.value
  if (!voice) return

  autoGenerateAttempted.value = true
  await generate(voice)
}, { immediate: true })
```

- [ ] **Step 3: Commit**

```
git add pages/new.vue pages/read/[id].vue
git commit -m "Auto-start generation when navigating to reader from read creation"
```

---

### Task 5: Build and verify

- [ ] **Step 1: Run build**

```
npm run build
```

Expected: Build succeeds with no errors.

- [ ] **Step 2: Run tests**

```
npm run test
```

Expected: All 16 tests pass.

- [ ] **Step 3: Manual verification with dev server**

Start `npm run dev` and verify:
1. Create a new read with a voice selected → lands on reader page, generation starts automatically
2. While playing, navigate to Library → playback bar stays visible at bottom, controls work
3. Player bar shows read title (links back to reader), total elapsed/remaining time
4. Time remaining updates as playback progresses
5. Ungenerated segments show "~" prefix on remaining time
6. Speed change affects the remaining time estimate
7. Navigate back to reader → playback continues, segments highlighted correctly
