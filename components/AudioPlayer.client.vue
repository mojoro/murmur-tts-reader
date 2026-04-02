<template>
  <div
    v-if="segments.length > 0"
    class="fixed bottom-0 left-0 right-0 z-50 border-t border-neutral-200 dark:border-neutral-800 backdrop-blur-lg bg-white/80 dark:bg-neutral-950/80 px-4 py-3"
  >
    <div class="max-w-3xl mx-auto flex flex-col sm:flex-row items-center gap-2 sm:gap-3">
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
          {{ formatTime(currentTime) }}
        </span>
        <UProgress
          :model-value="duration > 0 ? (currentTime / duration) * 100 : 0"
          size="xs"
          class="flex-1"
        />
        <span class="text-xs text-neutral-500 tabular-nums w-10">
          {{ formatTime(duration) }}
        </span>
      </div>

      <!-- Speed control -->
      <UDropdownMenu
        :items="speedItems"
      >
        <UButton variant="ghost" color="neutral" size="sm">
          {{ playbackRate }}x
        </UButton>
      </UDropdownMenu>
    </div>

    <!-- Segment indicator -->
    <div class="max-w-3xl mx-auto mt-1">
      <p class="text-xs text-neutral-500 truncate">
        Segment {{ currentSegmentIndex + 1 }} of {{ segments.length }}
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
const {
  isPlaying,
  currentTime,
  duration,
  playbackRate,
  currentSegmentIndex,
  segments,
  togglePlayPause,
  skipPrev,
  skipNext,
  setRate,
} = useAudioPlayer()

const speeds = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0]

const speedItems = computed(() =>
  speeds.map((speed) => ({
    label: `${speed}x`,
    icon: speed === playbackRate.value ? 'i-lucide-check' : undefined,
    click: () => setRate(speed),
  })),
)

function formatTime(seconds: number): string {
  if (!seconds || !isFinite(seconds)) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}
</script>
