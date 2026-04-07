<template>
  <div class="max-w-4xl mx-auto flex flex-col gap-6">
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-bold text-neutral-900 dark:text-neutral-50">Library</h1>
      <UButton color="primary" icon="i-lucide-plus" to="/new">
        New Read
      </UButton>
    </div>
    <LibraryGrid :reads="reads" :loading="loading" :jobs="activeJobs" @delete="handleDelete" />
  </div>
</template>

<script setup lang="ts">
import type { Job } from '~/types/api'

const { reads, loading, refresh: refreshReads, deleteRead } = useLibrary()

// Light-weight job polling — only active while the library page is mounted,
// no SSE connection (avoids Caddy abort warnings on navigation).
const activeJobs = ref<Job[]>([])
let pollId: ReturnType<typeof setInterval> | undefined

async function pollJobs() {
  try {
    const jobs = await $fetch<Job[]>('/api/queue')
    const running = jobs.filter((j) => j.status === 'pending' || j.status === 'running')

    // If a job just finished (was running, now gone), refresh reads to pick up generated_at/engine
    if (activeJobs.value.length > 0 && running.length < activeJobs.value.length) {
      await refreshReads()
    }
    activeJobs.value = running
  } catch {
    // Offline or server error — ignore
  }
}

onMounted(() => {
  pollJobs()
  pollId = setInterval(pollJobs, 5000)
})
onUnmounted(() => {
  if (pollId) clearInterval(pollId)
})

async function handleDelete(id: number) {
  await deleteRead(id)
}
</script>
