<template>
  <div class="max-w-3xl mx-auto flex flex-col gap-6">
    <h1 class="text-2xl font-bold text-neutral-900 dark:text-neutral-50">Queue</h1>

    <div v-if="loading && jobs.length === 0" class="flex flex-col gap-3">
      <USkeleton v-for="i in 3" :key="i" class="h-20 w-full rounded-lg" />
    </div>

    <div
      v-else-if="jobs.length === 0"
      class="flex flex-col items-center justify-center py-16 gap-4 text-neutral-500"
    >
      <UIcon name="i-lucide-list" class="size-12" />
      <p class="text-lg">No jobs in queue</p>
      <p class="text-sm">Generate audio from a read to see jobs here</p>
    </div>

    <div v-else class="flex flex-col gap-3">
      <UCard v-for="job in jobs" :key="job.id">
        <div class="flex items-center gap-4">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <NuxtLink
                :to="`/read/${job.read_id}`"
                class="font-medium text-neutral-900 dark:text-neutral-50 hover:underline truncate"
              >
                Job #{{ job.id }}
              </NuxtLink>
              <UBadge :color="statusColor(job.status)" variant="subtle" size="sm">
                {{ job.status }}
              </UBadge>
            </div>
            <div class="text-xs text-neutral-500 mt-1">
              {{ job.voice }} · {{ job.engine }}
            </div>
          </div>

          <div v-if="job.status === 'running' || job.status === 'pending'" class="flex items-center gap-3">
            <div class="flex items-center gap-2 w-32">
              <UProgress
                :model-value="job.total > 0 ? (job.progress / job.total) * 100 : 0"
                size="xs"
                class="flex-1"
              />
              <span class="text-xs text-neutral-500 tabular-nums">
                {{ job.progress }}/{{ job.total }}
              </span>
            </div>
            <UButton
              icon="i-lucide-x"
              variant="ghost"
              color="error"
              size="xs"
              @click="cancelJob(job.id)"
            />
          </div>

          <div v-else-if="job.status === 'failed'" class="text-xs text-red-500 max-w-48 truncate">
            {{ job.error }}
          </div>
        </div>
      </UCard>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { JobStatus } from '~/types/api'

const { jobs, loading, cancelJob } = useQueue()

function statusColor(status: JobStatus) {
  switch (status) {
    case 'running': return 'primary' as const
    case 'pending': return 'neutral' as const
    case 'done': return 'success' as const
    case 'failed': return 'error' as const
    case 'cancelled': return 'warning' as const
    case 'waiting_for_backend': return 'info' as const
    default: return 'neutral' as const
  }
}
</script>
