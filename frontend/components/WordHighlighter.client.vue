<template>
  <p class="text-base leading-relaxed">
    <span
      v-for="(word, i) in words"
      :key="i"
      class="transition-colors duration-150"
      :class="wordClass(i)"
    >{{ word.word }}{{ ' ' }}</span>
  </p>
</template>

<script setup lang="ts">
import type { WordTiming } from '~/types/api'

const props = defineProps<{
  words: WordTiming[]
  isActive: boolean
}>()

const { currentTime } = useAudioPlayer()

const activeWordIndex = computed(() => {
  if (!props.isActive || props.words.length === 0) return -1
  const time = currentTime.value
  // Binary search for the active word
  let lo = 0
  let hi = props.words.length - 1
  let result = -1
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1
    if (props.words[mid].start <= time) {
      result = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  // Verify the word hasn't ended
  if (result >= 0 && props.words[result].end < time) {
    // Between words — still highlight the last word that ended
    return result
  }
  return result
})

function wordClass(index: number) {
  if (!props.isActive) return 'text-neutral-700 dark:text-neutral-300'
  if (index === activeWordIndex.value) return 'bg-primary-500/25 rounded px-0.5 text-neutral-900 dark:text-neutral-50'
  if (index < activeWordIndex.value) return 'text-neutral-400 dark:text-neutral-500'
  return 'text-neutral-700 dark:text-neutral-300'
}
</script>
