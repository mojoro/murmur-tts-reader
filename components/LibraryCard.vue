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
        <UBadge
          :color="typeColor"
          variant="subtle"
          size="sm"
        >
          {{ read.type }}
        </UBadge>
      </div>
      <p class="text-sm text-neutral-500 line-clamp-2">{{ read.content }}</p>
      <UProgress
        v-if="progressPercent > 0"
        :model-value="progressPercent"
        size="xs"
        class="mt-1"
      />
      <div class="flex items-center justify-between mt-1">
        <span class="text-xs text-neutral-400">{{ timeAgo(read.createdAt) }}</span>
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
import type { Read } from '~/types/db'

const props = defineProps<{
  read: Read
}>()

const emit = defineEmits<{
  delete: [id: number]
}>()

const totalSegments = computed(() => splitSentences(props.read.content).length)
const progressPercent = computed(() => {
  const progress = props.read.progressSegment ?? 0
  if (progress <= 0 || totalSegments.value <= 1) return 0
  return Math.round((progress / totalSegments.value) * 100)
})

const typeColor = computed(() => {
  switch (props.read.type) {
    case 'url': return 'info' as const
    case 'file': return 'warning' as const
    default: return 'neutral' as const
  }
})

function timeAgo(date: Date | number): string {
  const now = Date.now()
  const ts = date instanceof Date ? date.getTime() : date
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
