<template>
  <div v-if="!readData" class="max-w-3xl mx-auto flex flex-col gap-4">
    <USkeleton class="h-8 w-64" />
    <USkeleton v-for="i in 5" :key="i" class="h-16 w-full rounded-lg" />
  </div>

  <div v-else class="max-w-3xl mx-auto flex flex-col gap-6 pb-28">
    <!-- Header -->
    <div class="flex items-start justify-between gap-4">
      <div>
        <h1 class="text-2xl font-bold text-neutral-900 dark:text-neutral-50">
          {{ readData.read.title }}
        </h1>
        <div class="flex items-center gap-2 mt-1">
          <UBadge :color="typeColor" variant="subtle" size="sm">
            {{ readData.read.type }}
          </UBadge>
          <span class="text-xs text-neutral-400">
            {{ readData.segments.length }} segments
          </span>
        </div>
      </div>
      <UButton
        icon="i-lucide-arrow-left"
        variant="ghost"
        color="neutral"
        to="/"
      />
    </div>

    <!-- Action bar -->
    <div class="flex items-center gap-3 p-3 rounded-lg bg-neutral-50 dark:bg-neutral-900">
      <VoiceSelector class="flex-1" />
      <UButton
        v-if="!generating"
        color="primary"
        icon="i-lucide-play"
        :disabled="!selectedVoice"
        @click="handleGenerate"
      >
        Generate Audio
      </UButton>
      <template v-else>
        <div class="flex items-center gap-2">
          <UProgress :model-value="total > 0 ? (progress / total) * 100 : 0" size="xs" class="w-24" />
          <span class="text-xs text-neutral-500">{{ progress }}/{{ total }}</span>
        </div>
        <UButton
          color="error"
          variant="outline"
          icon="i-lucide-square"
          size="sm"
          @click="abort"
        >
          Stop
        </UButton>
      </template>
    </div>

    <!-- Error alert -->
    <UAlert
      v-if="ttsError"
      color="error"
      :title="ttsError"
      icon="i-lucide-alert-circle"
    />

    <!-- Reader view -->
    <ReaderView :segments="readData.segments" />

    <!-- Audio player (fixed bottom bar, only renders when segments loaded) -->
    <AudioPlayer />
  </div>
</template>

<script setup lang="ts">
import type { Read, AudioSegment } from '~/types/db'

const route = useRoute()
const id = computed(() => Number(route.params.id))

const { getRead } = useLibrary()
const { selectedVoice } = useVoices()
const { generating, progress, total, error: ttsError, generate, abort } = useTTS()
const { setSegments } = useAudioPlayer()

const readData = ref<{ read: Read; segments: AudioSegment[] } | null>(null)

async function loadRead() {
  readData.value = await getRead(id.value)
  if (readData.value) {
    setSegments(readData.value.segments)
  }
}

async function handleGenerate() {
  if (!readData.value || !selectedVoice.value) return
  await generate(id.value, readData.value.segments, selectedVoice.value)
  // Reload to get updated segments with audio paths
  await loadRead()
}

onMounted(() => {
  loadRead()
})

const typeColor = computed(() => {
  switch (readData.value?.read.type) {
    case 'url': return 'info' as const
    case 'file': return 'warning' as const
    default: return 'neutral' as const
  }
})
</script>
