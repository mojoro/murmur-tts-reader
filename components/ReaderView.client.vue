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
      <img
        v-if="getImageIndex(segment) !== null"
        :src="`/api/images/${segment.read_id}/${getImageIndex(segment)}`"
        class="max-w-full rounded-lg my-2"
        loading="lazy"
      />
      <WordHighlighter
        v-else-if="getWordTimings(segment)"
        :words="getWordTimings(segment)!"
        :is-active="index === currentSegmentIndex"
      />
      <p v-else class="text-base leading-relaxed">{{ segment.text }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { AudioSegment, WordTiming } from '~/types/api'

const props = defineProps<{
  segments: AudioSegment[]
}>()

const { currentSegmentIndex, playSegment } = useAudioPlayer()
const containerRef = ref<HTMLElement | null>(null)
const segmentRefs = ref<Record<number, HTMLElement>>({})

function segmentClasses(index: number) {
  const isActive = index === currentSegmentIndex.value
  const hasAudio = !!props.segments[index]?.audio_generated

  return {
    'bg-primary-500/10 ring-1 ring-primary-500/30': isActive,
    'border-l-2 border-primary-500/50': hasAudio && !isActive,
    'border-l-2 border-transparent': !hasAudio && !isActive,
    'hover:bg-neutral-100 dark:hover:bg-neutral-900': !isActive,
  }
}

const IMAGE_MARKER_RE = /^\[image:(\d+)\]$/

function getImageIndex(segment: AudioSegment): number | null {
  const match = segment.text.match(IMAGE_MARKER_RE)
  return match ? parseInt(match[1]) : null
}

function getWordTimings(segment: AudioSegment): WordTiming[] | null {
  if (!segment.word_timings_json) return null
  try {
    return JSON.parse(segment.word_timings_json)
  } catch {
    return null
  }
}

function handleClick(index: number) {
  if (props.segments[index]?.audio_generated) {
    playSegment(index)
  }
}

watch(currentSegmentIndex, (index) => {
  const el = segmentRefs.value[index]
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
})
</script>
