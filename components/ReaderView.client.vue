<template>
  <div ref="containerRef" class="flex flex-col gap-1">
    <div
      v-for="(segment, index) in segments"
      :key="segment.id"
      :ref="(el) => { if (el) segmentRefs[index] = el as HTMLElement }"
      class="py-2 px-3 rounded-lg cursor-pointer transition-all duration-200"
      :class="segmentClasses(index)"
      @click="handleClick(index)"
    >
      <p class="text-base leading-relaxed">{{ segment.text }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { AudioSegment } from '~/types/db'

const props = defineProps<{
  segments: AudioSegment[]
}>()

const { currentSegmentIndex, playSegment, isPlaying } = useAudioPlayer()
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
