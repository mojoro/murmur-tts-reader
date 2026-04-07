<template>
  <UCard
    class="group cursor-pointer hover:ring-1 hover:ring-primary-500/30 transition-all overflow-hidden"
    :ui="{ body: 'p-0' }"
    @click="navigateTo(`/read/${read.id}`)"
  >
    <img
      v-if="showThumb"
      :src="`/api/thumbnails/${read.id}`"
      :alt="read.title"
      class="w-full h-32 object-cover"
      @error="showThumb = false"
    />
    <div class="flex flex-col gap-2 p-4">
      <div class="flex items-start justify-between gap-2">
        <h3 class="font-semibold text-neutral-900 dark:text-neutral-50 truncate flex-1">
          {{ read.title }}
        </h3>
        <UBadge :color="typeColor" variant="subtle" size="sm">
          {{ read.type }}
        </UBadge>
      </div>
      <p class="text-sm text-neutral-500">{{ readTimeLabel }}</p>
      <UProgress
        v-if="progressPercent > 0"
        :model-value="progressPercent"
        size="xs"
        class="mt-1"
      />
      <!-- Footer: timestamps + generation status -->
      <div class="flex flex-col gap-1 mt-1">
        <div class="flex items-center justify-between">
          <span class="text-xs text-neutral-400">Added {{ timeAgo(read.created_at) }}</span>
          <UButton
            icon="i-lucide-trash-2"
            variant="ghost"
            color="error"
            size="xs"
            class="opacity-0 group-hover:opacity-100 transition-opacity"
            @click.stop="emit('delete', read.id)"
          />
        </div>
        <!-- Generation status row -->
        <div class="flex items-center gap-1.5 text-xs">
          <span class="size-2 rounded-full shrink-0" :class="statusDotClass" />
          <span v-if="job" class="text-amber-500 truncate">
            {{ Math.round((job.progress / (job.total || 1)) * 100) }}%
            <template v-if="etaLabel"> &middot; {{ etaLabel }}</template>
          </span>
          <span v-else-if="read.generated_at" class="text-neutral-400 truncate">
            {{ timeAgo(read.generated_at) }} &middot; {{ engineLabel }}
          </span>
          <span v-else class="text-neutral-500">Not generated</span>
        </div>
      </div>
    </div>
  </UCard>
</template>

<script setup lang="ts">
import type { ReadSummary, Job } from '~/types/api'

const ENGINE_NAMES: Record<string, string> = {
  'pocket-tts': 'Pocket TTS',
  'xtts-v2': 'XTTS v2',
  'f5-tts': 'F5 TTS',
  'gpt-sovits': 'GPT-SoVITS',
  'cosyvoice2': 'CosyVoice 2',
}

const props = defineProps<{
  read: ReadSummary
  job?: Job | null
}>()

const emit = defineEmits<{
  delete: [id: number]
}>()

const showThumb = ref(true)

const readTimeLabel = computed(() => {
  const mins = Math.max(1, Math.round(props.read.segment_count * 15 / 200))
  if (mins < 60) return `~${mins} min read`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m > 0 ? `~${h} hr ${m} min read` : `~${h} hr read`
})

const progressPercent = computed(() => {
  const progress = props.read.progress_segment ?? 0
  const total = props.read.segment_count ?? 0
  if (progress <= 0 || total <= 1) return 0
  return Math.round((progress / total) * 100)
})

const typeColor = computed(() => {
  switch (props.read.type) {
    case 'url': return 'info' as const
    case 'file': return 'warning' as const
    default: return 'neutral' as const
  }
})

const engineLabel = computed(() => {
  const key = props.read.engine
  if (!key) return ''
  return ENGINE_NAMES[key] ?? key
})

const statusDotClass = computed(() => {
  if (props.job) return 'bg-amber-400'
  if (props.read.generated_at) return 'bg-emerald-500'
  return 'bg-neutral-400'
})

const etaLabel = computed(() => {
  if (!props.job?.started_at || !props.job.progress || !props.job.total) return null
  const elapsed = Date.now() - new Date(props.job.started_at).getTime()
  const remaining = (elapsed / props.job.progress) * (props.job.total - props.job.progress)
  const mins = Math.ceil(remaining / 60000)
  if (mins < 1) return '<1m left'
  if (mins < 60) return `~${mins}m left`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m > 0 ? `~${h}h ${m}m left` : `~${h}h left`
})

function timeAgo(dateStr: string): string {
  const now = Date.now()
  const ts = new Date(dateStr).getTime()
  const diff = now - ts
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(ts).toLocaleDateString()
}
</script>
