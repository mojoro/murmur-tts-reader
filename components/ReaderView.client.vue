<template>
  <div ref="containerRef" class="flex flex-col gap-1 max-w-prose selection:bg-primary-200 dark:selection:bg-primary-800">
    <div
      v-for="(segment, index) in segments"
      :key="segment.id"
      :ref="(el) => { if (el) segmentRefs[index] = el as HTMLElement }"
      class="py-2 px-3 rounded-lg cursor-pointer transition-all duration-200"
      :class="segmentClasses(index)"
      @click="handleClick(index)"
    >
      <WordHighlighter
        v-if="getWordTimings(segment)"
        :words="getWordTimings(segment)!"
        :is-active="index === currentSegmentIndex"
      />
      <p v-else class="text-base leading-relaxed">{{ segment.text }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { AudioSegment } from '~/types/db'
import type { WordTiming } from '~/types/tts'

const props = defineProps<{
  segments: AudioSegment[]
}>()

const { currentSegmentIndex, currentTime, playSegment, isPlaying } = useAudioPlayer()
const containerRef = ref<HTMLElement | null>(null)
const segmentRefs = ref<Record<number, HTMLElement>>({})

function segmentClasses(index: number) {
  const isActive = index === currentSegmentIndex.value
  const hasAudio = !!props.segments[index]?.audioPath

  return {
    'bg-primary-500/10 ring-1 ring-primary-500/30': isActive,
    'border-l-2 border-primary-500/50': hasAudio && !isActive,
    'border-l-2 border-transparent': !hasAudio && !isActive,
    'hover:bg-neutral-100 dark:hover:bg-neutral-900': !isActive,
  }
}

function getWordTimings(segment: AudioSegment): WordTiming[] | null {
  if (!segment.wordTimingsJson) return null
  try {
    return JSON.parse(segment.wordTimingsJson)
  } catch {
    return null
  }
}

function handleClick(index: number) {
  if (props.segments[index]?.audioPath) {
    playSegment(index)
  }
}

// Auto-scroll to active segment
watch(currentSegmentIndex, (index) => {
  const el = segmentRefs.value[index]
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
})
</script>
