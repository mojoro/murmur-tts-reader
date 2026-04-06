<template>
  <div
    v-if="segments.length > 0"
    class="fixed bottom-0 left-0 right-0 z-50 border-t border-neutral-200 dark:border-neutral-800 backdrop-blur-lg bg-white/80 dark:bg-neutral-950/80 px-4 py-2"
  >
    <div class="max-w-3xl mx-auto flex flex-col gap-1">
      <!-- Scrubber row -->
      <div class="flex items-center gap-2">
        <span class="text-xs text-neutral-500 tabular-nums w-10 text-right">
          {{ formatTime(elapsedTime) }}
        </span>
        <input
          type="range"
          min="0"
          :max="totalDuration"
          step="0.1"
          :value="elapsedTime"
          class="flex-1 h-1 accent-primary-500 cursor-pointer"
          @input="handleScrub"
        />
        <span class="text-xs text-neutral-500 tabular-nums w-14">
          -{{ formatTime(remainingTime) }}
        </span>
      </div>

      <!-- Controls row -->
      <div class="flex items-center justify-center gap-1">
        <!-- Read title (left-aligned, hidden on very small screens) -->
        <NuxtLink
          v-if="currentReadId"
          :to="`/read/${currentReadId}`"
          class="hidden sm:block text-xs font-medium text-neutral-700 dark:text-neutral-300 truncate max-w-[160px] hover:text-primary-500 mr-auto"
        >
          {{ currentReadTitle }}
        </NuxtLink>

        <UButton
          icon="i-lucide-skip-back"
          variant="ghost"
          color="neutral"
          size="xs"
          :disabled="currentSegmentIndex <= 0"
          @click="skipPrev"
        />

        <UButton
          :icon="isPlaying ? 'i-lucide-pause' : 'i-lucide-play'"
          variant="solid"
          color="primary"
          size="sm"
          @click="togglePlayPause"
        />

        <UButton
          icon="i-lucide-skip-forward"
          variant="ghost"
          color="neutral"
          size="xs"
          :disabled="currentSegmentIndex >= segments.length - 1"
          @click="skipNext"
        />

        <UDropdownMenu :items="speedItems">
          <UButton variant="ghost" color="neutral" size="xs" class="tabular-nums">
            {{ playbackRate }}x
          </UButton>
        </UDropdownMenu>

        <!-- Remaining time label (right-aligned) -->
        <span class="hidden sm:block text-xs text-neutral-500 ml-auto">
          {{ hasEstimates ? '~' : '' }}{{ formatRemaining(remainingTime) }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const {
  isPlaying,
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
  seekToGlobal,
  setRate,
} = useAudioPlayer()

function handleScrub(e: Event) {
  const value = parseFloat((e.target as HTMLInputElement).value)
  seekToGlobal(value)
}

const speeds = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0]

const speedItems = computed(() =>
  speeds.map((speed) => ({
    label: `${speed}x`,
    icon: speed === playbackRate.value ? 'i-lucide-check' : undefined,
    onSelect: () => setRate(speed),
  })),
)

function formatTime(seconds: number): string {
  if (!seconds || !isFinite(seconds)) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function formatRemaining(seconds: number): string {
  if (!seconds || !isFinite(seconds)) return ''
  const h = Math.floor(seconds / 3600)
  const m = Math.ceil((seconds % 3600) / 60)
  if (h > 0) return `${h} hr ${m} min remaining`
  return `${m} min remaining`
}
</script>
