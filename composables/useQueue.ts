import type { Job } from '~/types/api'

export function useQueue() {
  const { data: jobs, status, refresh } = useFetch<Job[]>('/api/queue', {
    default: () => [],
  })

  let eventSource: EventSource | null = null

  function connectSSE() {
    if (!import.meta.client) return
    eventSource = new EventSource('/api/queue/events')

    const events = ['job:queued', 'job:started', 'job:progress', 'job:completed', 'job:failed', 'job:cancelled']
    for (const event of events) {
      eventSource.addEventListener(event, () => refresh())
    }
  }

  async function cancelJob(jobId: number) {
    await $fetch(`/api/queue/${jobId}`, { method: 'DELETE' })
    await refresh()
  }

  onMounted(connectSSE)
  onUnmounted(() => {
    eventSource?.close()
    eventSource = null
  })

  return {
    jobs,
    loading: computed(() => status.value === 'pending'),
    refresh,
    cancelJob,
  }
}
