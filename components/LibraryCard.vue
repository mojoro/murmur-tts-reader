<template>
  <UCard
    class="group cursor-pointer hover:ring-1 hover:ring-primary-500/30 transition-all"
    @click="navigateTo(`/read/${read.id}`)"
  >
    <div class="flex flex-col gap-2">
      <div class="flex items-start justify-between gap-2">
        <h3 class="font-semibold text-neutral-900 dark:text-neutral-50 truncate flex-1">
          {{ read.title }}
        </h3>
        <UBadge :color="typeColor" variant="subtle" size="sm">
          {{ read.type }}
        </UBadge>
      </div>
      <p class="text-sm text-neutral-500">{{ read.segment_count }} segments</p>
      <UProgress
        v-if="progressPercent > 0"
        :model-value="progressPercent"
        size="xs"
        class="mt-1"
      />
      <div class="flex items-center justify-between mt-1">
        <span class="text-xs text-neutral-400">{{ timeAgo(read.created_at) }}</span>
        <UButton
          icon="i-lucide-trash-2"
          variant="ghost"
          color="error"
          size="xs"
          class="opacity-0 group-hover:opacity-100 transition-opacity"
          @click.stop="emit('delete', read.id)"
        />
      </div>
    </div>
  </UCard>
</template>

<script setup lang="ts">
import type { ReadSummary } from '~/types/api'

const props = defineProps<{
  read: ReadSummary
}>()

const emit = defineEmits<{
  delete: [id: number]
}>()

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
